import { readDb } from "../lib/prisma";
import { createdSinceFilter, type DashboardPeriod, dashboardPeriodStart } from "../lib/dashboard-period";
import { paise } from "../lib/money";
import { defaultAddressOrder } from "./address-repository";

const adminAddressStateSelect = {
  address: { select: { state: true } },
} as const;

const supervisorStateLinksSelect = {
  assignedToAdmin: { select: adminAddressStateSelect },
  createdByAdmin: { select: adminAddressStateSelect },
} as const;

function periodContext(period: DashboardPeriod) {
  const since = createdSinceFilter(dashboardPeriodStart(period));
  return {
    activeAdminWhere: {
      status: "active" as const,
      role: { roleName: { not: "super_admin" } },
      ...since,
    },
    activeSupervisorWhere: { status: "active" as const, ...since },
    activeProviderWhere: { status: "active" as const, ...since },
    activeCustomerWhere: {
      role: "customer" as const,
      status: "active" as const,
      ...since,
    },
  };
}

function labeledState(state: string | null | undefined) {
  return state?.trim() || "Unknown";
}

function stateFromAdminLinks(
  assigned: { address: { state: string | null } | null } | null | undefined,
  created: { address: { state: string | null } | null } | null | undefined,
) {
  return labeledState(assigned?.address?.state ?? created?.address?.state);
}

function countByState(states: Iterable<string>) {
  const counts = new Map<string, number>();
  for (const state of states) {
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count);
}

async function countActiveProviderAvailability() {
  const groups = await readDb.serviceProvider.groupBy({
    by: ["isAvailable"],
    where: { status: "active" },
    _count: { _all: true },
  });

  let providersOnline = 0;
  let providersOffline = 0;
  for (const group of groups) {
    if (group.isAvailable) providersOnline = group._count._all;
    else providersOffline = group._count._all;
  }
  return { providersOnline, providersOffline };
}

export const dashboardRepository = {
  async getDashboard(period: DashboardPeriod) {
    const { activeAdminWhere, activeSupervisorWhere, activeProviderWhere, activeCustomerWhere } =
      periodContext(period);

    const [
      admins,
      supervisors,
      providers,
      customers,
      availability,
      offlineRequestsPending,
      supervisorRows,
      providerRows,
      customerRows,
    ] = await Promise.all([
      readDb.adminUser.count({ where: activeAdminWhere }),
      readDb.supervisor.count({ where: activeSupervisorWhere }),
      readDb.serviceProvider.count({ where: activeProviderWhere }),
      readDb.user.count({ where: activeCustomerWhere }),
      countActiveProviderAvailability(),
      readDb.providerOfflineRequest.count({ where: { status: "pending" } }),
      readDb.supervisor.findMany({
        where: activeSupervisorWhere,
        select: supervisorStateLinksSelect,
      }),
      readDb.serviceProvider.findMany({
        where: activeProviderWhere,
        select: { registeredBySupervisor: { select: supervisorStateLinksSelect } },
      }),
      readDb.user.findMany({
        where: activeCustomerWhere,
        select: {
          addresses: {
            orderBy: defaultAddressOrder,
            take: 1,
            select: { state: true },
          },
        },
      }),
    ]);

    return {
      period,
      counts: {
        admins,
        supervisors,
        providers,
        customers,
        ...availability,
        offlineRequestsPending,
      },
      graphs: {
        supervisorsByState: countByState(
          supervisorRows.map((row) => stateFromAdminLinks(row.assignedToAdmin, row.createdByAdmin)),
        ),
        providersByState: countByState(
          providerRows.map((row) =>
            stateFromAdminLinks(
              row.registeredBySupervisor?.assignedToAdmin,
              row.registeredBySupervisor?.createdByAdmin,
            ),
          ),
        ),
        customersByState: countByState(customerRows.map((row) => labeledState(row.addresses[0]?.state))),
      },
    };
  },

  async getCityStats() {
    const [zones, providers, payments] = await Promise.all([
      readDb.coverageZone.findMany({
        select: { id: true, city: true },
      }),
      readDb.serviceProvider.findMany({
        where: { status: { not: "deleted" } },
        select: { id: true, coverageZoneId: true },
      }),
      readDb.payment.findMany({
        where: { status: "captured" },
        select: {
          amountPaise: true,
          booking: {
            select: {
              assignments: {
                where: { status: "accepted" },
                take: 1,
                select: { providerId: true },
              },
            },
          },
        },
      }),
    ]);

    const cityName = (city: string | null | undefined) => city?.trim() || "Unassigned";
    const zoneCity = new Map(zones.map((zone) => [zone.id, cityName(zone.city)]));
    const totals = new Map<string, { providerCount: number; revenuePaise: number }>();

    const ensure = (city: string) => {
      const current = totals.get(city) ?? { providerCount: 0, revenuePaise: 0 };
      totals.set(city, current);
      return current;
    };

    for (const zone of zones) ensure(cityName(zone.city));

    const providerCity = new Map<string, string>();
    for (const provider of providers) {
      const city = provider.coverageZoneId
        ? (zoneCity.get(provider.coverageZoneId) ?? "Unassigned")
        : "Unassigned";
      providerCity.set(provider.id, city);
      ensure(city).providerCount += 1;
    }

    for (const payment of payments) {
      const providerId = payment.booking.assignments[0]?.providerId;
      if (!providerId) continue;
      const city = providerCity.get(providerId);
      if (!city) continue;
      ensure(city).revenuePaise += paise(payment.amountPaise);
    }

    const items = [...totals.entries()]
      .filter(([city, row]) => city !== "Unassigned" || row.providerCount > 0 || row.revenuePaise > 0)
      .map(([city, row]) => ({
        city,
        providerCount: row.providerCount,
        revenuePaise: row.revenuePaise,
      }))
      .sort(
        (a, b) =>
          b.providerCount - a.providerCount ||
          b.revenuePaise - a.revenuePaise ||
          a.city.localeCompare(b.city),
      );

    return { items };
  },
};
