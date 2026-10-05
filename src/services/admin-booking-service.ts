import type { BookingStatus } from "../generated/prisma/client";
import { db } from "../lib/prisma";
import { paise } from "../lib/money";
import { paginatedResult, paginationSkip } from "../lib/pagination";
import { bookingRepository, bookingServiceIds, storedServiceIds } from "../repositories/booking-repository";
import { assignmentRepository } from "../repositories/assignment-repository";
import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { namedFromRows, serviceCategoryRepository } from "../repositories/service-category-repository";
import { notificationService } from "./notification-service";
import { bookingAssignmentService, bookingJobNames, bookingSlot } from "./booking-assignment-service";

const ASSIGNABLE_STATUSES: BookingStatus[] = ["confirmed", "searching", "assigned"];

type AdminBookingRow = NonNullable<Awaited<ReturnType<typeof bookingRepository.findByIdForAdmin>>>;

function acceptedAssignment(booking: { assignments: AdminBookingRow["assignments"] }) {
  return booking.assignments.find((a) => a.status === "accepted") ?? null;
}

async function requireBooking(bookingId: string) {
  const booking = await bookingRepository.findByIdForAdmin(bookingId);
  if (!booking) throw new Error("BOOKING_NOT_FOUND");
  return booking;
}

async function toAdminBookingDto(booking: AdminBookingRow) {
  const accepted = acceptedAssignment(booking);
  const serviceIds = bookingServiceIds(booking);

  return {
    id: booking.id,
    status: booking.status,
    bookingType: booking.bookingType,
    scheduledDate: booking.scheduledDate,
    scheduledStartTime: booking.scheduledStartTime,
    basePricePaise: paise(booking.basePricePaise),
    totalPricePaise: paise(booking.totalPricePaise),
    overtimeRatePaise: booking.overtimeRatePaise,
    overtimeMinutes: booking.overtimeMinutes,
    cancellationFeePaise:
      booking.cancellationFeePaise == null ? null : paise(booking.cancellationFeePaise),
    cancelledBy: booking.cancelledBy,
    cancellationReason: booking.cancellationReason,
    startedAt: booking.startedAt,
    completedAt: booking.completedAt,
    slaDeadlineAt: booking.slaDeadlineAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    customer: booking.customer,
    address: booking.address,
    category: booking.category,
    services: await serviceCategoryRepository.namedInOrder(serviceIds),
    plan: booking.plan
      ? {
          id: booking.plan.id,
          name: booking.plan.name,
          durationMinutes: booking.plan.durationMinutes,
          pricePaise: paise(booking.plan.pricePaise),
        }
      : null,
    assignedProvider: accepted
      ? {
          assignmentId: accepted.id,
          status: accepted.status,
          offeredAt: accepted.offeredAt,
          respondedAt: accepted.respondedAt,
          provider: accepted.provider,
        }
      : null,
    assignments: booking.assignments.map((a) => ({
      id: a.id,
      status: a.status,
      offerSequence: a.offerSequence,
      offeredAt: a.offeredAt,
      respondedAt: a.respondedAt,
      expiresAt: a.expiresAt,
      provider: a.provider,
    })),
    payments: booking.payments.map((p) => ({
      id: p.id,
      amountPaise: paise(p.amountPaise),
      status: p.status,
      paymentMethod: p.paymentMethod,
      capturedAt: p.capturedAt,
      createdAt: p.createdAt,
    })),
    review: booking.review,
  };
}

function toAdminBookingListItem(
  booking: Awaited<ReturnType<typeof bookingRepository.listForAdmin>>[0][number],
  services: Array<{ id: string; name: string }>,
) {
  const accepted = booking.assignments[0] ?? null;
  const latestPayment = booking.payments[0] ?? null;

  return {
    id: booking.id,
    status: booking.status,
    bookingType: booking.bookingType,
    scheduledDate: booking.scheduledDate,
    totalPricePaise: paise(booking.totalPricePaise),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    customer: booking.customer,
    city: booking.address.city,
    category: booking.category,
    services,
    plan: booking.plan,
    assignedProvider: accepted
      ? {
          assignmentId: accepted.id,
          provider: accepted.provider,
        }
      : null,
    paymentStatus: latestPayment?.status ?? null,
    paymentMethod: latestPayment?.paymentMethod ?? null,
  };
}

export const adminBookingService = {
  async list(query: { page: number; limit: number; q?: string; status?: BookingStatus[] }) {
    const filters = { q: query.q, status: query.status };
    const [[rows, total], stats, mapRows] = await Promise.all([
      bookingRepository.listForAdmin(paginationSkip(query), filters),
      bookingRepository.countAdminStats(),
      bookingRepository.listAdminMapPoints(filters),
    ]);
    const serviceIds = rows.flatMap((row) => storedServiceIds(row.serviceIds, row.category.id));
    const named = await serviceCategoryRepository.findManyByIds([...new Set(serviceIds)]);
    return {
      ...paginatedResult(
        rows.map((row) => {
          const ids = storedServiceIds(row.serviceIds, row.category.id);
          return toAdminBookingListItem(row, namedFromRows(ids, named));
        }),
        total,
        query,
      ),
      stats,
      mapPoints: mapRows.flatMap((row) => {
        const { latitude, longitude } = row.address;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
        return [
          {
            id: row.id,
            lat: latitude,
            lng: longitude,
            status: row.status,
            label: row.customer.fullName?.trim() || row.customer.phoneNumber,
          },
        ];
      }),
    };
  },

  async getById(bookingId: string) {
    return toAdminBookingDto(await requireBooking(bookingId));
  },

  async assignProvider(bookingId: string, providerId: string) {
    const booking = await requireBooking(bookingId);

    if (!ASSIGNABLE_STATUSES.includes(booking.status)) {
      throw new Error("BOOKING_NOT_ASSIGNABLE");
    }

    const provider = await serviceProviderRepository.findById(providerId);
    if (!provider || provider.status === "deleted") throw new Error("PROVIDER_NOT_FOUND");
    if (provider.status !== "active") throw new Error("PROVIDER_INACTIVE");

    const currentAccepted = acceptedAssignment(booking);
    const isReassign = Boolean(currentAccepted);

    if (currentAccepted?.providerId === providerId) {
      throw new Error("PROVIDER_ALREADY_ASSIGNED");
    }

    const assignment = await db.$transaction(async (tx) => {
      if (currentAccepted) {
        await assignmentRepository.cancelAccepted(bookingId, tx);
      }
      const offerSequence = await assignmentRepository.nextOfferSequence(bookingId, tx);
      const created = await assignmentRepository.createManualAssignment(
        { bookingId, providerId, offerSequence },
        tx,
      );
      if (booking.status !== "assigned") {
        await bookingRepository.updateStatus(bookingId, "assigned", tx);
      }
      return created;
    });

    const slot = bookingSlot(booking);
    const jobNames = await bookingJobNames(booking);
    if (currentAccepted) {
      bookingAssignmentService.notifyWorkerRemoved({
        providerId: currentAccepted.providerId,
        bookingId,
        reason: "reassigned",
        slot,
        serviceNames: jobNames,
      });
    }
    bookingAssignmentService.notifyWorkerAssigned({
      providerId: assignment.provider.id,
      bookingId,
      slot,
      serviceNames: jobNames,
      packageName: booking.plan?.name,
      address: booking.address,
      reassigned: isReassign,
    });

    const providerName = assignment.provider.fullName?.trim() || assignment.provider.phoneNumber;
    notificationService.notify({
      recipientType: "customer",
      recipientId: booking.customerId,
      templateKey: isReassign ? "booking.provider_reassigned" : "booking.provider_assigned",
      payload: {
        bookingId,
        providerId: assignment.provider.id,
        providerName,
        reassigned: isReassign,
      },
    });

    return this.getById(bookingId);
  },

  async cancel(bookingId: string, reason?: string) {
    const booking = await requireBooking(bookingId);
    const closed = ["completed", "paid", "cancelled", "disputed"];
    if (closed.includes(booking.status)) throw new Error("BOOKING_NOT_CANCELLABLE");

    const workers = booking.assignments.filter(
      (assignment) => assignment.status === "accepted" || assignment.status === "offered",
    );

    await db.$transaction(async (tx) => {
      await assignmentRepository.cancelOpen(bookingId, tx);
      await bookingRepository.cancel(
        bookingId,
        { cancelledBy: "admin", cancellationReason: reason, cancellationFeePaise: 0n },
        tx,
      );
    });

    const slot = bookingSlot(booking);
    const serviceNames = await bookingJobNames(booking);
    for (const assignment of workers) {
      bookingAssignmentService.notifyWorkerRemoved({
        providerId: assignment.provider.id,
        bookingId,
        reason: "cancelled",
        cancelledBy: "admin",
        slot,
        serviceNames,
      });
    }

    notificationService.notify({
      recipientType: "customer",
      recipientId: booking.customerId,
      templateKey: "booking.cancelled",
      payload: {
        bookingId,
        event: "cancelled",
        cancelledBy: "admin",
        reason: reason?.trim() || null,
        screen: "booking_detail",
        deepLink: `/bookings/${bookingId}`,
        refreshPath: `/v1/customer/bookings/${bookingId}`,
      },
    });

    return this.getById(bookingId);
  },
};
