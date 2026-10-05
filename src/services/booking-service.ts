import { randomInt } from "node:crypto";
import { db } from "../lib/prisma";
import { paise } from "../lib/money";
import { addressRepository } from "../repositories/address-repository";
import { coverageZoneRepository } from "../repositories/coverage-zone-repository";
import { namedFromRows, serviceCategoryRepository } from "../repositories/service-category-repository";
import { servicePlanRepository } from "../repositories/service-plan-repository";
import {
  bookingRepository,
  bookingServiceIds,
  type CustomerBookingFilter,
} from "../repositories/booking-repository";
import { paymentRepository } from "../repositories/payment-repository";
import { walletRepository } from "../repositories/wallet-repository";
import { reviewRepository } from "../repositories/review-repository";
import { couponRepository } from "../repositories/coupon-repository";
import { SESSION_PUSH_TEMPLATE_KEY } from "../lib/notification-templates";
import { notificationService } from "./notification-service";
import {
  BookingUnavailableError,
  bookingAssignmentService,
  bookingJobNames,
  bookingSlot,
  slotWindow,
  type BookedService,
  type JobSlot,
  type WorkerSearch,
} from "./booking-assignment-service";
import { platformConfigService } from "./platform-config-service";
import { customerCouponService } from "./customer-coupon-service";
import { indiaClock, utcTimeHhmm } from "../lib/job-hours";
import { hashOtpCode } from "../lib/auth/otp";
import { BookingType, PaymentMethod, SessionCompletionOutcome } from "../generated/prisma/enums";
import { resolveProfilePhotoDisplayUrl } from "../lib/profile-photo";
import { sessionDurationMinutes, sessionFromBooking } from "../lib/booking-session";
import { paginatedResult, paginationSkip, type PaginationQuery } from "../lib/pagination";

function packageRef(plan: { id: string; name: string; durationMinutes: number } | null | undefined) {
  return plan ? { id: plan.id, name: plan.name, durationMinutes: plan.durationMinutes } : null;
}

const PLATFORM_FEE_BPS = 2000n;

/** What is being booked, where and when — shared by booking and the availability check. */
export interface BookingRequest {
  packageId?: string;
  serviceIds?: string[];
  /** The services' category; when sent, every selected service must belong to it. */
  categoryId?: string;
  addressId: string;
  bookingType: BookingType;
  scheduledDate?: Date;
  scheduledStartTime?: Date;
}

export interface CreateBookingInput extends BookingRequest {
  paymentMethod: PaymentMethod;
  couponCode?: string;
  totalPricePaise?: number;
}

type BookableService = Awaited<ReturnType<typeof serviceCategoryRepository.findManyByIds>>[number];

function splitPlatformFee(totalPricePaise: bigint) {
  const platformFeePaise = (totalPricePaise * PLATFORM_FEE_BPS) / 10_000n;
  return { platformFeePaise, providerPayoutPaise: totalPricePaise - platformFeePaise };
}

function generateSessionOtp() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

function orderedServices(ids: string[], rows: BookableService[]) {
  const map = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.map((id) => map.get(id));
  if (ordered.some((row) => !row)) throw new Error("INVALID_SERVICE");
  return ordered as BookableService[];
}

/** Each booked service with its category: its parent, or itself when it is a top-level category. */
function bookedServices(services: BookableService[]): BookedService[] {
  return services.map((service) => ({
    id: service.id,
    slug: service.slug,
    category: service.parent ? { id: service.parent.id, slug: service.parent.slug } : { id: service.id, slug: service.slug },
  }));
}

/**
 * The category the app sent must cover every selected service: the service is that category
 * (packages can link a whole category) or sits directly under it.
 */
function assertCategory(categoryId: string | undefined, services: BookableService[]) {
  if (categoryId && services.some((service) => service.id !== categoryId && service.parentId !== categoryId)) {
    throw new Error("CATEGORY_MISMATCH");
  }
}

/**
 * The services being booked (they decide which workers match) and, for a package, the package
 * (saved on the booking; sets price and duration). A package booking sends its services too —
 * they must all be in the package; a package sent alone means all of its services.
 */
async function resolveBookingSelection(input: BookingRequest) {
  const serviceIds = [...new Set(input.serviceIds ?? [])];
  if (!input.packageId && serviceIds.length === 0) throw new Error("SERVICES_REQUIRED");

  if (input.packageId) {
    const plan = await servicePlanRepository.findById(input.packageId);
    const packageServiceIds = [...new Set(plan?.services.map((link) => link.category.id) ?? [])];
    if (!plan || !plan.isActive || packageServiceIds.length === 0) throw new Error("INVALID_PACKAGE");
    const chosenIds = serviceIds.length ? serviceIds : packageServiceIds;
    if (chosenIds.some((id) => !packageServiceIds.includes(id))) throw new Error("PACKAGE_SERVICE_MISMATCH");
    const rows = await serviceCategoryRepository.findManyByIds(chosenIds);
    if (rows.length !== chosenIds.length || rows.some((row) => !row.isActive)) {
      throw new Error("INVALID_PACKAGE");
    }
    return { plan, services: orderedServices(chosenIds, rows), basePricePaise: plan.pricePaise };
  }

  const rows = await serviceCategoryRepository.findManyByIds(serviceIds);
  const services = orderedServices(serviceIds, rows);
  if (services.some((row) => !row.isActive || !row.parentId || row._count.children > 0 || row.pricePaise == null)) {
    throw new Error("INVALID_SERVICE");
  }
  return {
    plan: null,
    services,
    basePricePaise: services.reduce((sum, row) => sum + row.pricePaise!, 0n),
  };
}

/**
 * Validates a booking request (address, services/package, category, schedule — throws for bad
 * input) and builds the worker search both APIs run: the zones containing the address, the slot
 * (now for instant, the chosen date + time for scheduled), the admin job hours, and the booked
 * services with their categories.
 */
async function prepareBooking(customerId: string, input: BookingRequest) {
  // All booking times are IST wall-clock: scheduled date/time as the customer picked them,
  // instant bookings start "now" in IST — never the server's timezone.
  const clock = indiaClock();
  const instant = input.bookingType !== "scheduled";
  const bookingDate = instant ? clock.date : input.scheduledDate?.toISOString().slice(0, 10);
  const bookingTime = instant ? clock.time : utcTimeHhmm(input.scheduledStartTime);

  if (!bookingDate || !bookingTime) throw new Error("SCHEDULE_REQUIRED");
  if (!instant) {
    if (bookingDate < clock.date) throw new Error("SCHEDULE_IN_PAST");
    if (bookingDate === clock.date && bookingTime < clock.time) throw new Error("SCHEDULE_IN_PAST");
  }

  const [address, selection, config] = await Promise.all([
    addressRepository.findOwned(input.addressId, customerId),
    resolveBookingSelection(input),
    platformConfigService.get(),
  ]);
  if (!address) throw new Error("ADDRESS_NOT_FOUND");
  assertCategory(input.categoryId, selection.services);

  const zoneIds = await coverageZoneRepository.findCoveringZoneIds(address.latitude, address.longitude);
  const sessionMinutes = sessionDurationMinutes({
    planDurationMinutes: selection.plan?.durationMinutes,
    serviceSessionMinutes: selection.services.map((service) => service.sessionMinutes),
  });
  const slot: JobSlot = { bookingDate, bookingTime, durationMinutes: sessionMinutes, instant };
  const workerSearch: WorkerSearch = {
    zoneIds,
    slot,
    jobHours: config,
    services: bookedServices(selection.services),
    latitude: address.latitude,
    longitude: address.longitude,
  };
  return { address, selection, sessionMinutes, slot, workerSearch };
}

function slotDto(slot: JobSlot) {
  const { start, end } = slotWindow(slot);
  return {
    date: slot.bookingDate,
    startTime: slot.bookingTime,
    endTime: indiaClock(new Date(end)).time,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    durationMinutes: slot.durationMinutes,
  };
}

export const bookingService = {
  /**
   * Whether a booking with these details could get a worker right now: the same checks as
   * creating one (zone, job hours, a matching worker free for the whole slot), nothing reserved.
   */
  async checkAvailability(customerId: string, input: BookingRequest) {
    const prepared = await prepareBooking(customerId, input);
    const slot = slotDto(prepared.slot);
    try {
      const found = await bookingAssignmentService.findWorkers(prepared.workerSearch);
      const count = found.rankedProviderIds.length;
      return {
        available: true,
        availableWorkers: count,
        code: null,
        message: `${count} ${count === 1 ? "professional is" : "professionals are"} available for this time.`,
        slot,
      };
    } catch (err) {
      if (!(err instanceof BookingUnavailableError)) throw err;
      return { available: false, availableWorkers: 0, code: err.code, message: err.publicMessage, slot };
    }
  },

  async createBooking(customerId: string, input: CreateBookingInput) {
    const { address, selection, sessionMinutes, slot, workerSearch } = await prepareBooking(customerId, input);

    const serviceIds = selection.services.map((service) => service.id);
    const basePricePaise = selection.basePricePaise;
    let discountPaise = 0n;
    let coupon:
      | {
          id: string;
          code: string;
          maxUses: number;
        }
      | undefined;

    if (input.couponCode) {
      const quote = await customerCouponService.quote(
        input.couponCode,
        Number(basePricePaise),
      );
      discountPaise = BigInt(quote.discountPaise);
      coupon = { id: quote.coupon.id, code: quote.coupon.code, maxUses: quote.coupon.maxUses };
    }

    const totalPricePaise = basePricePaise - discountPaise;
    if (input.totalPricePaise !== undefined && input.totalPricePaise !== Number(totalPricePaise)) {
      throw new Error("PRICE_MISMATCH");
    }

    const payFromWallet = input.paymentMethod === "wallet";
    if (totalPricePaise > 0n && !payFromWallet) {
      throw new Error("PAYMENT_GATEWAY_UNAVAILABLE");
    }

    // Pick workers before charging anything: no free worker means no booking.
    const { rankedProviderIds, restMinutes } = await bookingAssignmentService.findWorkers(workerSearch);

    const { platformFeePaise, providerPayoutPaise } = splitPlatformFee(totalPricePaise);
    const sessionOtp = generateSessionOtp();

    const { booking, assignment } = await db.$transaction(async (tx) => {
      const booking = await bookingRepository.create(
        {
          customerId,
          addressId: input.addressId,
          categoryId: serviceIds[0],
          planId: selection.plan?.id ?? null,
          serviceIds,
          bookingType: input.bookingType,
          scheduledDate: input.scheduledDate,
          scheduledStartTime: input.scheduledStartTime,
          basePricePaise,
          discountPaise,
          couponCode: coupon?.code,
          sessionOtp,
          sessionOtpHash: hashOtpCode(sessionOtp),
          sessionMinutes,
          totalPricePaise,
          status: "confirmed",
        },
        tx,
      );

      if (payFromWallet && totalPricePaise > 0n) {
        await walletRepository.debit(customerId, totalPricePaise, "booking_payment", booking.id, tx);
      }

      if (coupon) {
        const consumed = await couponRepository.consumeUse(coupon.id, coupon.maxUses, tx);
        if (consumed.count === 0) throw new Error("COUPON_EXHAUSTED");
      }

      await paymentRepository.create(
        {
          bookingId: booking.id,
          customerId,
          amountPaise: totalPricePaise,
          platformFeePaise,
          providerPayoutPaise,
          paymentMethod: "wallet",
          status: "captured",
          capturedAt: new Date(),
        },
        tx,
      );

      const assignment = await bookingAssignmentService.claimWorker(tx, {
        bookingId: booking.id,
        rankedProviderIds,
        restMinutes,
        slot,
      });
      return { booking, assignment };
    });

    const assignedProvider = {
      id: assignment.provider.id,
      fullName: assignment.provider.fullName,
      phoneNumber: assignment.provider.phoneNumber,
      profilePhotoUrl: assignment.provider.profilePhotoUrl ?? null,
    };

    notificationService.notify({
      recipientType: "customer",
      recipientId: customerId,
      templateKey: "booking.provider_assigned",
      payload: {
        bookingId: booking.id,
        sessionOtp,
        providerName: assignedProvider.fullName,
        paid: true,
      },
    });
    bookingAssignmentService.notifyWorkerAssigned({
      providerId: assignment.provider.id,
      bookingId: booking.id,
      slot,
      serviceNames: selection.services.map((service) => service.name),
      packageName: selection.plan?.name,
      address,
    });

    return {
      bookingId: booking.id,
      status: "assigned",
      totalPricePaise,
      discountPaise,
      chargedFromWallet: payFromWallet && totalPricePaise > 0n,
      clientSecret: null,
      sessionOtp,
      assignedProvider,
    };
  },

  async getBooking(customerId: string, bookingId: string) {
    const booking = await bookingRepository.findByIdForCustomer(bookingId, customerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    const catalog = await serviceCategoryRepository.findManyByIds(bookingServiceIds(booking));
    return {
      ...booking,
      services: namedFromRows(bookingServiceIds(booking), catalog),
      session: sessionFromBooking(booking),
    };
  },

  async getSession(customerId: string, bookingId: string) {
    const booking = await this.getBooking(customerId, bookingId);
    if (!booking.session) throw new Error("SESSION_NOT_STARTED");
    const assigned = booking.assignments[0]?.provider;
    return {
      id: booking.id,
      status: booking.status,
      services: booking.services,
      package: packageRef(booking.plan),
      provider: assigned
        ? {
            id: assigned.id,
            fullName: assigned.fullName,
            phoneNumber: assigned.phoneNumber,
            profilePhotoUrl: await resolveProfilePhotoDisplayUrl(assigned.profilePhotoUrl),
          }
        : null,
      canComplete: booking.status === "in_progress" && !booking.customerCompletedAt,
      canRate: booking.status === "completed" && !booking.review,
      completionOutcome: booking.customerCompletionOutcome,
      ...booking.session,
    };
  },

  async listBookings(customerId: string, filter: CustomerBookingFilter, page: PaginationQuery) {
    const [bookings, total] = await bookingRepository.listForCustomer(customerId, filter, paginationSkip(page));
    const ids = bookings.flatMap(bookingServiceIds);
    const rows = await serviceCategoryRepository.findManyByIds([...new Set(ids)]);
    return paginatedResult(
      bookings.map((booking) => ({
        ...booking,
        services: namedFromRows(bookingServiceIds(booking), rows),
      })),
      total,
      page,
    );
  },

  async cancelBooking(customerId: string, bookingId: string, reason?: string) {
    const booking = await bookingRepository.findByIdForCustomer(bookingId, customerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    const nonCancellable = ["in_progress", "completed", "disputed", "paid", "cancelled"];
    if (nonCancellable.includes(booking.status)) {
      throw new Error("BOOKING_NOT_CANCELLABLE");
    }

    const feeApplies = booking.status === "en_route";
    const cancellationFeePaise = feeApplies ? booking.totalPricePaise / 10n : 0n;

    const cancelled = await db.$transaction(async (tx) => {
      if (cancellationFeePaise > 0n) {
        await walletRepository.debit(customerId, cancellationFeePaise, "booking_payment", booking.id, tx).catch(() => {
          // Insufficient wallet balance for the fee doesn't block the cancellation itself.
        });
      }
      return bookingRepository.cancel(bookingId, { cancelledBy: "customer", cancellationReason: reason, cancellationFeePaise }, tx);
    });

    const provider = booking.assignments[0]?.provider;
    if (provider) {
      bookingAssignmentService.notifyWorkerRemoved({
        providerId: provider.id,
        bookingId: booking.id,
        reason: "cancelled",
        slot: bookingSlot(booking),
        serviceNames: await bookingJobNames(booking),
      });
    }
    return cancelled;
  },

  async completeSession(customerId: string, bookingId: string, outcome: SessionCompletionOutcome) {
    const booking = await bookingRepository.findByIdForCustomer(bookingId, customerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    if (!booking.startedAt) throw new Error("SESSION_NOT_STARTED");
    if (booking.customerCompletedAt) throw new Error("SESSION_ALREADY_COMPLETED");
    if (booking.status !== "in_progress" && booking.status !== "completed") {
      throw new Error("SESSION_NOT_ACTIVE");
    }

    const markJobDone = booking.status !== "completed";
    const overtimeMinutes = Math.floor((sessionFromBooking(booking)?.timer.overtimeSeconds ?? 0) / 60);
    const provider = booking.assignments[0]?.provider;

    const updated = await db.$transaction(async (tx) => {
      const completed = await bookingRepository.completeByCustomer(
        booking.id,
        { outcome, overtimeMinutes, markJobDone },
        tx,
      );
      if (markJobDone) {
        await bookingRepository.markJobFinished(booking.id, provider?.id, tx);
      }
      return completed;
    });

    if (provider) {
      notificationService.notifyProvider(provider.id, SESSION_PUSH_TEMPLATE_KEY, {
        bookingId: booking.id,
        event: outcome === "ended_early" ? "session_ended_early" : "job_completed",
        endedBy: "customer",
        screen: "job_completed",
        deepLink: `/provider/bookings/${booking.id}`,
        refreshPath: `/v1/provider/bookings/${booking.id}`,
        categoryName: booking.category.name,
      });
    }

    const session = sessionFromBooking({ ...booking, ...updated });
    const serviceIds = bookingServiceIds(booking);
    return {
      id: booking.id,
      status: updated.status,
      outcome,
      canRate: !booking.review,
      startedAt: booking.startedAt.toISOString(),
      completedAt: (updated.completedAt ?? new Date()).toISOString(),
      durationMinutes: session?.timer.durationMinutes ?? 0,
      elapsedSeconds: session?.timer.elapsedSeconds ?? 0,
      services: namedFromRows(serviceIds, await serviceCategoryRepository.findManyByIds(serviceIds)),
      package: packageRef(booking.plan),
      category: { id: booking.category.id, name: booking.category.name },
      address: booking.address,
      scheduledDate: booking.scheduledDate?.toISOString() ?? null,
      scheduledStartTime: utcTimeHhmm(booking.scheduledStartTime),
      totalPricePaise: paise(booking.totalPricePaise),
      provider: provider
        ? {
            id: provider.id,
            fullName: provider.fullName,
            phoneNumber: provider.phoneNumber,
            profilePhotoUrl: await resolveProfilePhotoDisplayUrl(provider.profilePhotoUrl),
            avgRating: Number(provider.avgRating),
            totalJobsCompleted: provider.totalJobsCompleted,
          }
        : null,
    };
  },

  async addReview(
    customerId: string,
    bookingId: string,
    input: { rating: number; description?: string; tags?: string[]; imageUrl?: string },
  ) {
    const booking = await bookingRepository.findByIdForCustomer(bookingId, customerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    if (booking.status !== "completed") throw new Error("BOOKING_NOT_COMPLETED");
    if (booking.review) throw new Error("ALREADY_REVIEWED");

    const providerId = booking.assignments[0]?.provider.id;
    if (!providerId) throw new Error("NO_PROVIDER_ASSIGNED");

    return reviewRepository.create({
      bookingId,
      customerId,
      providerId,
      rating: input.rating,
      comment: input.description,
      tags: input.tags,
      imageUrl: input.imageUrl,
    });
  },
};
