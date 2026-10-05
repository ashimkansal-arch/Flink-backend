import { db, readDb } from "../lib/prisma";
import { ActorType, BookingStatus, BookingType, SessionCompletionOutcome } from "../generated/prisma/enums";
import { assignmentProviderSelect } from "./assignment-repository";
import type { Prisma } from "../generated/prisma/client";
import { addDays, indiaDateTime } from "../lib/job-hours";

export function storedServiceIds(serviceIds: string[], fallbackId: string) {
  return serviceIds.length ? serviceIds : [fallbackId];
}

export function bookingServiceIds(booking: { serviceIds: string[]; categoryId: string }) {
  return storedServiceIds(booking.serviceIds, booking.categoryId);
}

export interface CreateBookingInput {
  customerId: string;
  addressId: string;
  categoryId: string;
  planId?: string | null;
  serviceIds: string[];
  bookingType: BookingType;
  scheduledDate?: Date;
  scheduledStartTime?: Date;
  basePricePaise: bigint;
  totalPricePaise: bigint;
  couponCode?: string;
  discountPaise?: bigint;
  sessionOtp?: string;
  sessionOtpHash?: string;
  sessionMinutes?: number;
  status: BookingStatus;
}

const SCHEDULED_CUSTOMER: BookingStatus[] = ["draft", "confirmed", "searching", "assigned", "en_route"];
const SCHEDULED_WORKER: BookingStatus[] = ["assigned", "en_route"];
const IN_PROGRESS: BookingStatus[] = ["in_progress"];
const COMPLETED: BookingStatus[] = ["completed", "paid"];
const CANCELLED: BookingStatus[] = ["cancelled", "no_provider", "disputed"];
/** A worker's jobs that are still on or already done — everything but cancelled. */
const WORKER_JOB_STATUSES: BookingStatus[] = [...SCHEDULED_WORKER, ...IN_PROGRESS, ...COMPLETED];

export const CUSTOMER_BOOKING_FILTERS = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "upcoming",
  "past",
  "all",
] as const;
export type CustomerBookingFilter = (typeof CUSTOMER_BOOKING_FILTERS)[number];

export const PROVIDER_BOOKING_FILTERS = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "all",
  "upcoming",
  "missed",
  "done",
] as const;
export type ProviderBookingFilter = (typeof PROVIDER_BOOKING_FILTERS)[number];

function statusesForFilter(
  filter: CustomerBookingFilter | ProviderBookingFilter,
  scheduled: BookingStatus[],
): BookingStatus[] | null {
  switch (filter) {
    case "scheduled":
      return scheduled;
    case "in_progress":
      return IN_PROGRESS;
    case "completed":
    case "done":
      return COMPLETED;
    case "cancelled":
    case "missed":
      return CANCELLED;
    case "upcoming":
      return [...scheduled, ...IN_PROGRESS];
    case "past":
      return [...COMPLETED, ...CANCELLED];
    case "all":
      return null;
  }
}

const addressSelect = {
  id: true,
  label: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  pincode: true,
  formattedAddress: true,
  latitude: true,
  longitude: true,
} as const;

const providerCustomerSelect = {
  id: true,
  fullName: true,
  phoneNumber: true,
  profileImageUrl: true,
  isPhoneVerified: true,
  homeProfile: { select: { floorNumber: true } },
} as const;

const providerBookingSelect = {
  id: true,
  status: true,
  bookingType: true,
  scheduledDate: true,
  scheduledStartTime: true,
  totalPricePaise: true,
  categoryId: true,
  serviceIds: true,
  createdAt: true,
  customer: { select: providerCustomerSelect },
  address: { select: addressSelect },
  category: { select: { id: true, name: true, iconUrl: true } },
  plan: { select: { id: true, name: true, durationMinutes: true } },
  payments: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { status: true, paymentMethod: true, providerPayoutPaise: true },
  },
} as const;

/** A job card (calendar, home): the list fields plus what places the job in time. */
const providerJobCardSelect = { ...providerBookingSelect, startedAt: true, sessionMinutes: true } as const;

function jobDoneFields(overtimeMinutes: number, completedBy: ActorType) {
  return {
    status: "completed" as const,
    completedAt: new Date(),
    overtimeMinutes,
    completedBy,
  };
}

function assignedToProvider(providerId: string): Prisma.BookingWhereInput {
  return {
    assignments: { some: { providerId, status: "accepted" } },
  };
}

/**
 * Bookings whose job falls on IST calendar days [fromDate, toDate): the scheduled date, or the
 * IST day an instant booking (no scheduled date) was made.
 */
function jobDateWhere(fromDate: string, toDate: string): Prisma.BookingWhereInput {
  return {
    OR: [
      { scheduledDate: { gte: new Date(`${fromDate}T00:00:00Z`), lt: new Date(`${toDate}T00:00:00Z`) } },
      {
        scheduledDate: null,
        createdAt: { gte: indiaDateTime(fromDate, "00:00"), lt: indiaDateTime(toDate, "00:00") },
      },
    ],
  };
}

const adminAddressSelect = {
  ...addressSelect,
  isDefault: true,
  isServiceable: true,
} as const;

export const bookingRepository = {
  create(data: CreateBookingInput, tx: Prisma.TransactionClient = db) {
    return tx.booking.create({ data });
  },

  findByIdForCustomer(bookingId: string, customerId: string) {
    return readDb.booking.findFirst({
      where: { id: bookingId, customerId },
      include: {
        category: true,
        plan: true,
        address: true,
        payments: true,
        review: true,
        assignments: {
          where: { status: "accepted" },
          take: 1,
          include: {
            provider: {
              select: {
                id: true,
                fullName: true,
                phoneNumber: true,
                profilePhotoUrl: true,
                avgRating: true,
                totalJobsCompleted: true,
              },
            },
          },
        },
      },
    });
  },

  /** One page of the customer's bookings, newest first, plus the total matching the filter. */
  listForCustomer(customerId: string, filter: CustomerBookingFilter, page: { skip: number; take: number }) {
    const statuses = statusesForFilter(filter, SCHEDULED_CUSTOMER);
    const where: Prisma.BookingWhereInput = { customerId, ...(statuses ? { status: { in: statuses } } : {}) };
    return Promise.all([
      readDb.booking.findMany({
        where,
        include: { category: true, plan: true },
        // id breaks ties so rows never repeat or go missing across pages.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...page,
      }),
      readDb.booking.count({ where }),
    ]);
  },

  updateStatus(id: string, status: BookingStatus, tx: Prisma.TransactionClient = db) {
    return tx.booking.update({ where: { id }, data: { status } });
  },

  startSession(
    id: string,
    data: { sessionMinutes: number; sessionChecklist: Prisma.InputJsonValue },
    tx: Prisma.TransactionClient = db,
  ) {
    return tx.booking.update({
      where: { id },
      data: {
        status: "in_progress",
        startedAt: new Date(),
        sessionMinutes: data.sessionMinutes,
        sessionChecklist: data.sessionChecklist,
      },
    });
  },

  /** One page of the worker's jobs, plus the total matching the filter. */
  listForProvider(providerId: string, filter: ProviderBookingFilter, page: { skip: number; take: number }) {
    const statuses = statusesForFilter(filter, SCHEDULED_WORKER);
    const where: Prisma.BookingWhereInput = {
      ...assignedToProvider(providerId),
      ...(statuses ? { status: { in: statuses } } : {}),
    };
    return Promise.all([
      readDb.booking.findMany({
        where,
        orderBy: [
          { scheduledDate: { sort: "asc", nulls: "first" } },
          { scheduledStartTime: { sort: "asc", nulls: "first" } },
          { createdAt: "desc" },
          // id breaks ties so rows never repeat or go missing across pages.
          { id: "desc" },
        ],
        select: providerBookingSelect,
        ...page,
      }),
      readDb.booking.count({ where }),
    ]);
  },

  /** The worker's jobs on one IST calendar day: upcoming, in progress, completed and cancelled. */
  listForProviderOnDate(providerId: string, date: string) {
    return readDb.booking.findMany({
      where: {
        AND: [
          assignedToProvider(providerId),
          jobDateWhere(date, addDays(date, 1)),
          { status: { in: [...WORKER_JOB_STATUSES, "cancelled"] } },
        ],
      },
      select: providerJobCardSelect,
    });
  },

  /** The worker's jobs not finished yet (assigned, on the way, in progress), soonest scheduled first. */
  listOpenForProvider(providerId: string) {
    return readDb.booking.findMany({
      where: {
        ...assignedToProvider(providerId),
        status: { in: [...SCHEDULED_WORKER, ...IN_PROGRESS] },
      },
      orderBy: [
        { scheduledDate: { sort: "asc", nulls: "first" } },
        { scheduledStartTime: { sort: "asc", nulls: "first" } },
        { createdAt: "asc" },
      ],
      select: providerJobCardSelect,
      take: 50,
    });
  },

  findByIdForProvider(bookingId: string, providerId: string) {
    return readDb.booking.findFirst({
      where: { id: bookingId, ...assignedToProvider(providerId) },
      select: {
        ...providerBookingSelect,
        startedAt: true,
        completedAt: true,
        basePricePaise: true,
        sessionOtpHash: true,
        sessionMinutes: true,
        sessionChecklist: true,
        overtimeRatePaise: true,
        completionSelfieUrl: true,
        plan: { select: { id: true, name: true, durationMinutes: true, includedTasks: true } },
      },
    });
  },

  findByIdForAdmin(bookingId: string) {
    return readDb.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
            email: true,
            status: true,
          },
        },
        address: { select: adminAddressSelect },
        category: { select: { id: true, name: true } },
        plan: {
          select: {
            id: true,
            name: true,
            durationMinutes: true,
            pricePaise: true,
          },
        },
        assignments: {
          orderBy: [{ offeredAt: "desc" }],
          include: { provider: { select: assignmentProviderSelect } },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            amountPaise: true,
            status: true,
            paymentMethod: true,
            capturedAt: true,
            createdAt: true,
          },
        },
        review: {
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
          },
        },
      },
    });
  },

  adminListWhere(filters?: { q?: string; status?: BookingStatus[] }): Prisma.BookingWhereInput {
    const where: Prisma.BookingWhereInput = {};

    if (filters?.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters?.q?.trim()) {
      const term = filters.q.trim();
      const phoneDigits = term.replace(/\D/g, "");
      const uuidLike =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(term);

      where.OR = [
        ...(uuidLike ? [{ id: term }] : []),
        { customer: { fullName: { contains: term, mode: "insensitive" as const } } },
        { customer: { email: { contains: term, mode: "insensitive" as const } } },
        {
          customer: {
            phoneNumber: { contains: phoneDigits || term },
          },
        },
        { category: { name: { contains: term, mode: "insensitive" as const } } },
        {
          assignments: {
            some: {
              status: "accepted" as const,
              provider: {
                OR: [
                  { fullName: { contains: term, mode: "insensitive" as const } },
                  { phoneNumber: { contains: phoneDigits || term } },
                ],
              },
            },
          },
        },
      ];
    }

    return where;
  },

  listForAdmin(
    page: { skip: number; take: number },
    filters?: { q?: string; status?: BookingStatus[] },
  ) {
    const where = this.adminListWhere(filters);

    return Promise.all([
      readDb.booking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          status: true,
          bookingType: true,
          scheduledDate: true,
          totalPricePaise: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              fullName: true,
              phoneNumber: true,
            },
          },
          address: { select: { city: true } },
          category: { select: { id: true, name: true } },
          plan: { select: { id: true, name: true } },
          serviceIds: true,
          assignments: {
            where: { status: "accepted" },
            take: 1,
            orderBy: { offeredAt: "desc" },
            select: {
              id: true,
              provider: {
                select: {
                  id: true,
                  fullName: true,
                  phoneNumber: true,
                },
              },
            },
          },
          payments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { status: true, paymentMethod: true },
          },
        },
      }),
      readDb.booking.count({ where }),
    ]);
  },

  listAdminMapPoints(filters?: { q?: string; status?: BookingStatus[] }) {
    return readDb.booking.findMany({
      where: this.adminListWhere(filters),
      select: {
        id: true,
        status: true,
        customer: { select: { fullName: true, phoneNumber: true } },
        address: { select: { latitude: true, longitude: true } },
      },
      take: 1000,
    });
  },

  /** The worker's scheduled / in-progress / completed job counts for a range of IST job days. */
  async providerJobCounts(providerId: string, days: { startDate: string; nextStartDate: string }) {
    const groups = await readDb.booking.groupBy({
      by: ["status"],
      where: {
        AND: [
          assignedToProvider(providerId),
          jobDateWhere(days.startDate, days.nextStartDate),
          { status: { in: WORKER_JOB_STATUSES } },
        ],
      },
      _count: { _all: true },
    });
    const countIn = (statuses: BookingStatus[]) =>
      groups.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
    return {
      scheduled: countIn(SCHEDULED_WORKER),
      inProgress: countIn(IN_PROGRESS),
      completed: countIn(COMPLETED),
    };
  },

  async countAdminStats() {
    const groups = await readDb.booking.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const countFor = (status: BookingStatus) =>
      groups.find((row) => row.status === status)?._count._all ?? 0;
    return {
      total: groups.reduce((sum, row) => sum + row._count._all, 0),
      assigned: countFor("assigned"),
      inProgress: countFor("in_progress"),
      completed: countFor("completed"),
      cancelled: countFor("cancelled"),
    };
  },

  updateChecklist(
    id: string,
    sessionChecklist: Prisma.InputJsonValue,
    tx: Prisma.TransactionClient = db,
  ) {
    return tx.booking.update({
      where: { id },
      data: { sessionChecklist },
    });
  },

  markJobFinished(bookingId: string, providerId: string | undefined, tx: Prisma.TransactionClient) {
    return Promise.all([
      tx.bookingTrackingEvent.create({
        data: { bookingId, providerId: providerId ?? null, eventType: "completed" },
      }),
      providerId
        ? tx.serviceProvider.update({
            where: { id: providerId },
            data: { totalJobsCompleted: { increment: 1 } },
          })
        : Promise.resolve(),
    ]);
  },

  completeSession(
    id: string,
    data: {
      completionSelfieUrl: string;
      completionPhotoUrl?: string | null;
      overtimeMinutes: number;
      alreadyCompleted?: boolean;
    },
    tx: Prisma.TransactionClient = db,
  ) {
    return tx.booking.update({
      where: { id },
      data: {
        completionSelfieUrl: data.completionSelfieUrl,
        completionPhotoUrl: data.completionPhotoUrl ?? null,
        ...(data.alreadyCompleted ? {} : jobDoneFields(data.overtimeMinutes, "provider")),
      },
    });
  },

  completeByCustomer(
    id: string,
    data: {
      outcome: SessionCompletionOutcome;
      overtimeMinutes: number;
      markJobDone: boolean;
    },
    tx: Prisma.TransactionClient = db,
  ) {
    return tx.booking.update({
      where: { id },
      data: {
        customerCompletedAt: new Date(),
        customerCompletionOutcome: data.outcome,
        ...(data.markJobDone ? jobDoneFields(data.overtimeMinutes, "customer") : {}),
      },
    });
  },

  cancel(
    id: string,
    data: { cancelledBy: ActorType; cancellationReason?: string; cancellationFeePaise: bigint },
    tx: Prisma.TransactionClient = db,
  ) {
    return tx.booking.update({
      where: { id },
      data: {
        status: "cancelled",
        cancelledBy: data.cancelledBy,
        cancellationReason: data.cancellationReason,
        cancellationFeePaise: data.cancellationFeePaise,
      },
    });
  },
};
