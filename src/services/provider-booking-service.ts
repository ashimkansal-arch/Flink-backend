import { db } from "../lib/prisma";
import { paise } from "../lib/money";
import { indiaClock, utcTimeHhmm } from "../lib/job-hours";
import { haversineKm } from "../lib/geo";
import type { LatLng } from "../lib/coverage-zone";
import { verifyOtpCode } from "../lib/auth/otp";
import { resolveProfilePhotoDisplayUrl } from "../lib/profile-photo";
import { resolveCatalogIconDisplayUrl } from "../lib/catalog-icon";
import {
  namedFromRows,
  rowsInOrder,
  serviceCategoryRepository,
} from "../repositories/service-category-repository";
import {
  bookingRepository,
  bookingServiceIds,
  type ProviderBookingFilter,
} from "../repositories/booking-repository";
import { SESSION_PUSH_TEMPLATE_KEY } from "../lib/notification-templates";
import { notificationService } from "./notification-service";
import { bookingSlot, slotWindow } from "./booking-assignment-service";
import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { reviewRepository } from "../repositories/review-repository";
import {
  parseChecklist,
  seedChecklist,
  sessionDurationMinutes,
  sessionFromBooking,
  setChecklistItemDone,
} from "../lib/booking-session";
import { completionPhotoObjectKey, resolveCompletionPhotoDisplayUrl } from "../lib/completion-photo";
import { extensionFromFilename, normalizeImageUpload, validateFileUpload } from "../lib/file-upload";
import { optimizeReviewImage, REVIEW_IMAGE_UPLOAD } from "../lib/review-image";
import { privateS3 } from "../lib/s3";
import { paginatedResult, paginationSkip, type PaginationQuery } from "../lib/pagination";

const STARTABLE_STATUSES = new Set(["assigned", "en_route"]);

type SessionPushEvent = "otp_verified" | "checklist_updated" | "job_completed";

function notifyCustomerSession(
  customerId: string,
  bookingId: string,
  event: SessionPushEvent,
  extra?: Record<string, unknown>,
) {
  const completed = event === "job_completed";
  notificationService.notify({
    recipientType: "customer",
    recipientId: customerId,
    templateKey: SESSION_PUSH_TEMPLATE_KEY,
    payload: {
      bookingId,
      event,
      screen: completed ? "job_completed" : "session_active",
      deepLink: completed ? `/bookings/${bookingId}` : `/bookings/${bookingId}/session`,
      refreshPath: completed
        ? `/v1/customer/bookings/${bookingId}`
        : `/v1/customer/bookings/${bookingId}/session`,
      ...extra,
    },
  });
}

type CompletionUpload = { filename: string; mimetype: string; buffer: Buffer };

async function storeCompletionImage(bookingId: string, kind: "selfie" | "photo", file: CompletionUpload) {
  const normalized = normalizeImageUpload(file);
  validateFileUpload(
    normalized.mimetype,
    extensionFromFilename(normalized.filename),
    normalized.buffer.length,
    REVIEW_IMAGE_UPLOAD,
  );
  const optimized = await optimizeReviewImage(normalized.buffer);
  const key = completionPhotoObjectKey(bookingId, kind, privateS3.newFileId());
  await privateS3.upload(key, optimized.buffer, optimized.contentType);
  return key;
}

type ProviderBookingListRow = Awaited<ReturnType<typeof bookingRepository.listForProvider>>[0][number];
type ProviderBookingRow = NonNullable<Awaited<ReturnType<typeof bookingRepository.findByIdForProvider>>>;
type CatalogService = Awaited<ReturnType<typeof serviceCategoryRepository.findManySessionByIds>>[number];

function scheduledEndTime(start: Date | null, durationMinutes: number | null) {
  if (!start || durationMinutes == null) return null;
  return utcTimeHhmm(new Date(start.getTime() + durationMinutes * 60_000));
}

async function hydrate(booking: ProviderBookingListRow, services: Array<{ id: string; name: string }>) {
  const durationMinutes = booking.plan?.durationMinutes ?? null;
  const latestPayment = booking.payments[0] ?? null;
  const [profilePhotoUrl, categoryIconUrl] = await Promise.all([
    resolveProfilePhotoDisplayUrl(booking.customer.profileImageUrl),
    resolveCatalogIconDisplayUrl(booking.category.iconUrl),
  ]);

  return {
    id: booking.id,
    status: booking.status,
    bookingType: booking.bookingType,
    scheduledDate: booking.scheduledDate?.toISOString() ?? null,
    scheduledStartTime: utcTimeHhmm(booking.scheduledStartTime),
    scheduledEndTime: scheduledEndTime(booking.scheduledStartTime, durationMinutes),
    durationMinutes,
    totalPricePaise: paise(booking.totalPricePaise),
    services,
    package: booking.plan,
    category: { id: booking.category.id, name: booking.category.name, iconUrl: categoryIconUrl },
    customer: {
      id: booking.customer.id,
      fullName: booking.customer.fullName,
      phoneNumber: booking.customer.phoneNumber,
      profilePhotoUrl,
      verified: booking.customer.isPhoneVerified,
      floorNumber: booking.customer.homeProfile?.floorNumber ?? null,
    },
    address: booking.address,
    payment: {
      status: latestPayment?.status ?? null,
      method: latestPayment?.paymentMethod ?? null,
      prepaid: latestPayment?.status === "captured",
    },
    createdAt: booking.createdAt.toISOString(),
  };
}

async function catalogFor(booking: { serviceIds: string[]; categoryId: string }) {
  const ids = bookingServiceIds(booking);
  return rowsInOrder(ids, await serviceCategoryRepository.findManySessionByIds(ids));
}

async function workerSession(booking: ProviderBookingRow, catalog?: CatalogService[]) {
  const services = catalog ?? (await catalogFor(booking));
  const session = sessionFromBooking(booking, services);
  if (!session) throw new Error("SESSION_NOT_STARTED");
  return {
    ...(await hydrate(booking, namedFromRows(bookingServiceIds(booking), services))),
    ...session,
  };
}

/**
 * The worker's share of a job, in paise — same rule as the earnings screens: only a captured
 * payment pays out (refunded/failed → 0). Null when the booking has no payment at all.
 */
function workerEarningsPaise(payment: { status: string; providerPayoutPaise: bigint } | undefined) {
  if (!payment) return null;
  return payment.status === "captured" ? paise(payment.providerPayoutPaise) : 0;
}

type CalendarStatus = "upcoming" | "en_route" | "in_progress" | "completed" | "cancelled";
type CalendarRow = Awaited<ReturnType<typeof bookingRepository.listForProviderOnDate>>[number];

/** How late a worker can start before the job counts as late. */
const ON_TIME_GRACE_MINUTES = 10;

function calendarStatus(status: CalendarRow["status"]): CalendarStatus {
  if (status === "cancelled") return "cancelled";
  if (status === "in_progress") return "in_progress";
  if (status === "completed" || status === "paid") return "completed";
  return status === "en_route" ? "en_route" : "upcoming";
}

/** Started (or, if not started yet, still able to start) within the grace period of the booked time. */
function timing(row: CalendarRow, startsAt: Date, now: number): "on_time" | "late" | null {
  const deadline = startsAt.getTime() + ON_TIME_GRACE_MINUTES * 60_000;
  if (row.startedAt) return row.startedAt.getTime() <= deadline ? "on_time" : "late";
  if (row.status === "completed" || row.status === "paid" || row.status === "cancelled") return null;
  if (now > deadline) return "late";
  return row.status === "en_route" ? "on_time" : null;
}

async function calendarJob(
  row: CalendarRow,
  services: Array<{ id: string; name: string }>,
  origin: LatLng | null,
  now: number,
) {
  const slot = bookingSlot(row);
  const window = slotWindow(slot);
  const startsAt = new Date(window.start);
  const endsAt = new Date(window.end);
  const { address } = row;
  return {
    ...(await hydrate(row, services)),
    calendarStatus: calendarStatus(row.status),
    timing: timing(row, startsAt, now),
    title: row.plan?.name ?? (services.map((service) => service.name).join(", ") || row.category.name),
    startTime: slot.bookingTime,
    endTime: indiaClock(endsAt).time,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    durationMinutes: slot.durationMinutes,
    shortAddress: [address.line2?.trim() || address.line1, address.city].filter(Boolean).join(", "),
    distanceKm: origin
      ? Math.round(haversineKm(origin.lat, origin.lng, address.latitude, address.longitude) * 10) / 10
      : null,
    earningsPaise: workerEarningsPaise(row.payments[0]),
  };
}

/** Distance origin: the app's live location if sent, else the worker's last reported one. */
async function distanceOrigin(providerId: string, from?: LatLng): Promise<LatLng | null> {
  if (from) return from;
  const provider = await serviceProviderRepository.findById(providerId);
  return provider?.currentLatitude != null && provider.currentLongitude != null
    ? { lat: provider.currentLatitude, lng: provider.currentLongitude }
    : null;
}

/** Job cards in start-time order. */
async function calendarJobs(bookings: CalendarRow[], origin: LatLng | null, now: number) {
  const rows = await serviceCategoryRepository.findManyByIds([...new Set(bookings.flatMap(bookingServiceIds))]);
  const jobs = await Promise.all(
    bookings.map((booking) => calendarJob(booking, namedFromRows(bookingServiceIds(booking), rows), origin, now)),
  );
  return jobs.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

type CalendarJob = Awaited<ReturnType<typeof calendarJobs>>[number];

const HOME_SCHEDULE_SIZE = 3;
/** Workers need at least this average rating to keep receiving jobs. */
const MIN_RATING = 4;

/**
 * Up to 3 of today's jobs around the current time: the latest one that already started, then
 * the next ones; when the day is nearly over, the last 3.
 */
function scheduleAroundNow(jobs: CalendarJob[], now: number) {
  const next = jobs.findIndex((job) => Date.parse(job.startsAt) >= now);
  const firstUpcoming = next === -1 ? jobs.length : next;
  const start = Math.max(0, Math.min(firstUpcoming - 1, jobs.length - HOME_SCHEDULE_SIZE));
  return jobs.slice(start, start + HOME_SCHEDULE_SIZE);
}

export const providerBookingService = {
  /**
   * The worker's jobs on one IST day, in start-time order. Distance is measured from `from`
   * (the app's live location) or else the worker's last reported location.
   */
  async calendar(providerId: string, date: string, from?: LatLng) {
    const [bookings, origin] = await Promise.all([
      bookingRepository.listForProviderOnDate(providerId, date),
      distanceOrigin(providerId, from),
    ]);
    const jobs = await calendarJobs(bookings, origin, Date.now());

    const count = (status: CalendarStatus) => jobs.filter((job) => job.calendarStatus === status).length;
    return {
      date,
      summary: {
        total: jobs.length,
        upcoming: count("upcoming") + count("en_route"),
        inProgress: count("in_progress"),
        completed: count("completed"),
        cancelled: count("cancelled"),
      },
      jobs,
    };
  },

  /**
   * Worker home screen: the job to go to next, their rating, and up to 3 of today's jobs around
   * the current time. "View all" is the calendar for `todaySchedule.date` (the same jobs).
   */
  async home(providerId: string, from?: LatLng) {
    const now = Date.now();
    const today = indiaClock(new Date(now)).date;
    const [todayRows, openRows, origin, rating] = await Promise.all([
      bookingRepository.listForProviderOnDate(providerId, today),
      bookingRepository.listOpenForProvider(providerId),
      distanceOrigin(providerId, from),
      reviewRepository.summaryForProvider(providerId),
    ]);
    const [todayJobs, openJobs] = await Promise.all([
      calendarJobs(todayRows, origin, now),
      calendarJobs(openRows, origin, now),
    ]);

    // A job already underway comes first; otherwise the soonest one that hasn't ended yet.
    const nextJob =
      openJobs.find((job) => job.calendarStatus === "in_progress") ??
      openJobs.find((job) => Date.parse(job.endsAt) >= now) ??
      null;
    const average = rating.average == null ? null : Math.round(rating.average * 10) / 10;

    return {
      nextJob,
      rating: {
        average,
        reviewCount: rating.reviewCount,
        minimumRequired: MIN_RATING,
        meetsMinimum: average == null ? null : average >= MIN_RATING,
      },
      todaySchedule: {
        date: today,
        total: todayJobs.length,
        jobs: scheduleAroundNow(todayJobs, now),
      },
    };
  },

  async list(providerId: string, filter: ProviderBookingFilter, page: PaginationQuery) {
    const [bookings, total] = await bookingRepository.listForProvider(providerId, filter, paginationSkip(page));
    const rows = await serviceCategoryRepository.findManyByIds([
      ...new Set(bookings.flatMap(bookingServiceIds)),
    ]);
    const items = await Promise.all(
      bookings.map((booking) => hydrate(booking, namedFromRows(bookingServiceIds(booking), rows))),
    );
    return paginatedResult(items, total, page);
  },

  async getById(providerId: string, bookingId: string) {
    const booking = await bookingRepository.findByIdForProvider(bookingId, providerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    const catalog = await catalogFor(booking);
    return {
      ...(await hydrate(booking, namedFromRows(bookingServiceIds(booking), catalog))),
      basePricePaise: paise(booking.basePricePaise),
      startedAt: booking.startedAt?.toISOString() ?? null,
      canStartSession: STARTABLE_STATUSES.has(booking.status),
      session: sessionFromBooking(booking, catalog),
    };
  },

  async getSession(providerId: string, bookingId: string) {
    const booking = await bookingRepository.findByIdForProvider(bookingId, providerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    return workerSession(booking);
  },

  async startSession(providerId: string, bookingId: string, otp: string) {
    const booking = await bookingRepository.findByIdForProvider(bookingId, providerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    if (!STARTABLE_STATUSES.has(booking.status)) throw new Error("BOOKING_NOT_STARTABLE");
    if (!booking.sessionOtpHash) throw new Error("SESSION_OTP_MISSING");
    if (!verifyOtpCode(otp, booking.sessionOtpHash)) throw new Error("INVALID_SESSION_OTP");

    const catalog = await catalogFor(booking);
    const planTasks = booking.plan?.includedTasks ?? [];
    const updated = await db.$transaction(async (tx) => {
      const started = await bookingRepository.startSession(
        booking.id,
        {
          sessionMinutes: sessionDurationMinutes({
            planDurationMinutes: booking.plan?.durationMinutes,
            serviceSessionMinutes: catalog.map((service) => service.sessionMinutes),
          }),
          sessionChecklist: seedChecklist(
            planTasks.some((label) => label.trim())
              ? planTasks
              : catalog.flatMap((service) => service.includedTasks),
          ),
        },
        tx,
      );
      await tx.bookingTrackingEvent.create({
        data: { bookingId: booking.id, providerId, eventType: "started" },
      });
      return started;
    });

    notifyCustomerSession(booking.customer.id, booking.id, "otp_verified");

    return workerSession({ ...booking, ...updated }, catalog);
  },

  async updateChecklist(providerId: string, bookingId: string, itemId: string, done: boolean) {
    const booking = await bookingRepository.findByIdForProvider(bookingId, providerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    if (booking.status !== "in_progress" || !booking.startedAt) throw new Error("SESSION_NOT_ACTIVE");

    const updated = await bookingRepository.updateChecklist(
      booking.id,
      setChecklistItemDone(parseChecklist(booking.sessionChecklist), itemId, done),
    );
    notifyCustomerSession(booking.customer.id, booking.id, "checklist_updated", { itemId, done });
    return workerSession({ ...booking, sessionChecklist: updated.sessionChecklist });
  },

  async completeSession(
    providerId: string,
    bookingId: string,
    files: { selfie?: CompletionUpload; completionPhoto?: CompletionUpload },
  ) {
    const booking = await bookingRepository.findByIdForProvider(bookingId, providerId);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    const alreadyCompleted = booking.status === "completed" && Boolean(booking.completedAt);
    if (alreadyCompleted && booking.completionSelfieUrl) throw new Error("SESSION_ALREADY_COMPLETED");
    if (!alreadyCompleted && (booking.status !== "in_progress" || !booking.startedAt)) {
      throw new Error("SESSION_NOT_ACTIVE");
    }
    if (!booking.startedAt) throw new Error("SESSION_NOT_ACTIVE");
    if (!files.selfie?.buffer.length) throw new Error("INVALID_UPLOAD");

    const [selfieKey, photoKey] = await Promise.all([
      storeCompletionImage(booking.id, "selfie", files.selfie),
      files.completionPhoto?.buffer.length
        ? storeCompletionImage(booking.id, "photo", files.completionPhoto)
        : Promise.resolve(null),
    ]);

    const overtimeMinutes = Math.floor(
      (sessionFromBooking(booking)?.timer.overtimeSeconds ?? 0) / 60,
    );

    const updated = await db.$transaction(async (tx) => {
      const completed = await bookingRepository.completeSession(
        booking.id,
        {
          completionSelfieUrl: selfieKey,
          completionPhotoUrl: photoKey,
          overtimeMinutes,
          alreadyCompleted,
        },
        tx,
      );
      if (!alreadyCompleted) {
        await bookingRepository.markJobFinished(booking.id, providerId, tx);
      }
      return completed;
    });

    const session = sessionFromBooking({ ...booking, ...updated });
    const durationMinutes = session?.timer.durationMinutes ?? 0;
    const [selfieUrl, completionPhotoUrl, summary] = await Promise.all([
      resolveCompletionPhotoDisplayUrl(updated.completionSelfieUrl),
      resolveCompletionPhotoDisplayUrl(updated.completionPhotoUrl),
      hydrate(booking, namedFromRows(bookingServiceIds(booking), await catalogFor(booking))),
    ]);

    notifyCustomerSession(booking.customer.id, booking.id, "job_completed", {
      durationMinutes,
      categoryName: booking.category.name,
    });

    return {
      id: summary.id,
      status: updated.status,
      startedAt: booking.startedAt.toISOString(),
      completedAt: (updated.completedAt ?? new Date()).toISOString(),
      job: {
        services: summary.services,
        package: summary.package,
        category: summary.category,
        address: summary.address,
      },
      customer: {
        id: summary.customer.id,
        fullName: summary.customer.fullName,
        phoneNumber: summary.customer.phoneNumber,
        profilePhotoUrl: summary.customer.profilePhotoUrl,
      },
      durationMinutes,
      elapsedSeconds: session?.timer.elapsedSeconds ?? 0,
      overtimeMinutes,
      earningsPaise: workerEarningsPaise(booking.payments[0]) ?? 0,
      selfieUrl,
      completionPhotoUrl,
    };
  },
};
