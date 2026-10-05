import { readDb } from "../lib/prisma";
import { paise } from "../lib/money";

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export const adminWalletRepository = {
  async getOverview() {
    const today = startOfToday();
    const [todayPayments, pending, escrow] = await Promise.all([
      readDb.payment.findMany({
        where: { status: "captured", capturedAt: { gte: today } },
        select: {
          providerPayoutPaise: true,
          booking: {
            select: {
              assignments: {
                where: { status: "accepted" },
                take: 1,
                select: {
                  provider: {
                    select: {
                      id: true,
                      fullName: true,
                      phoneNumber: true,
                      coverageZone: { select: { city: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      readDb.payment.aggregate({
        where: { status: "pending" },
        _sum: { providerPayoutPaise: true },
      }),
      readDb.payment.aggregate({
        where: {
          status: "captured",
          booking: { status: { in: ["assigned", "en_route", "in_progress", "disputed"] } },
        },
        _sum: { providerPayoutPaise: true },
      }),
    ]);

    const byProvider = new Map<
      string,
      { id: string; name: string; city: string; jobs: number; earningsPaise: number }
    >();
    let todayEarningsPaise = 0;

    for (const payment of todayPayments) {
      const payout = paise(payment.providerPayoutPaise);
      todayEarningsPaise += payout;
      const provider = payment.booking.assignments[0]?.provider;
      if (!provider) continue;
      const current = byProvider.get(provider.id) ?? {
        id: provider.id,
        name: provider.fullName?.trim() || provider.phoneNumber,
        city: provider.coverageZone?.city?.trim() || "—",
        jobs: 0,
        earningsPaise: 0,
      };
      current.jobs += 1;
      current.earningsPaise += payout;
      byProvider.set(provider.id, current);
    }

    return {
      todayEarningsPaise,
      payoutsPendingPaise: paise(pending._sum.providerPayoutPaise ?? 0n),
      escrowPaise: paise(escrow._sum.providerPayoutPaise ?? 0n),
      topEarners: [...byProvider.values()]
        .sort((a, b) => b.earningsPaise - a.earningsPaise || a.name.localeCompare(b.name))
        .slice(0, 10),
    };
  },
};
