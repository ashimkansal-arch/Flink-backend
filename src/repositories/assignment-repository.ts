import type { Prisma } from "../generated/prisma/client";
import { db, readDb } from "../lib/prisma";

export const assignmentProviderSelect = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  status: true,
  isAvailable: true,
  profilePhotoUrl: true,
} as const;

export const assignmentRepository = {
  // At most one `accepted` assignment per booking (see the partial unique index noted in
  // schema.prisma) — this is "who ended up doing the job," used once a booking reaches
  // completed/review, not during the offer-fallback search itself.
  findAcceptedForBooking(bookingId: string, tx: Prisma.TransactionClient | typeof readDb = readDb) {
    return tx.assignment.findFirst({ where: { bookingId, status: "accepted" } });
  },

  findActiveJobForProvider(providerId: string) {
    return readDb.assignment.findFirst({
      where: {
        providerId,
        status: "accepted",
        booking: { status: { in: ["assigned", "en_route", "in_progress"] } },
      },
      include: {
        booking: {
          select: {
            id: true,
            customerId: true,
            status: true,
            address: { select: { latitude: true, longitude: true } },
            trackingEvents: {
              where: { eventType: "arrived" },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
  },

  nextOfferSequence(bookingId: string, tx: Prisma.TransactionClient = db) {
    return tx.assignment
      .aggregate({ where: { bookingId }, _max: { offerSequence: true } })
      .then((row) => (row._max.offerSequence ?? 0) + 1);
  },

  cancelAccepted(bookingId: string, tx: Prisma.TransactionClient = db) {
    return tx.assignment.updateMany({
      where: { bookingId, status: "accepted" },
      data: { status: "cancelled", respondedAt: new Date() },
    });
  },

  cancelOpen(bookingId: string, tx: Prisma.TransactionClient = db) {
    return tx.assignment.updateMany({
      where: { bookingId, status: { in: ["accepted", "offered"] } },
      data: { status: "cancelled", respondedAt: new Date() },
    });
  },

  createManualAssignment(
    data: { bookingId: string; providerId: string; offerSequence: number },
    tx: Prisma.TransactionClient = db,
  ) {
    const now = new Date();
    return tx.assignment.create({
      data: {
        bookingId: data.bookingId,
        providerId: data.providerId,
        offerSequence: data.offerSequence,
        status: "accepted",
        offeredAt: now,
        respondedAt: now,
        // Manual CRM assign is immediately accepted — expiry is informational only.
        expiresAt: now,
      },
      include: { provider: { select: assignmentProviderSelect } },
    });
  },
};
