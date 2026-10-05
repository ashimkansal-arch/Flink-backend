import { haversineKm } from "../lib/geo";
import {
  dayOfWeekOf,
  formatHhmm12,
  indiaClock,
  indiaDateTime,
  jobFitsHours,
  latestJobStart,
  timeToMinutes,
  utcTimeHhmm,
} from "../lib/job-hours";
import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { assignmentRepository } from "../repositories/assignment-repository";
import { bookingRepository, bookingServiceIds } from "../repositories/booking-repository";
import { serviceCategoryRepository } from "../repositories/service-category-repository";
import type { Prisma } from "../generated/prisma/client";
import type { BookingType } from "../generated/prisma/enums";
import { notificationService } from "./notification-service";

/** Minimum gap between two jobs of the same worker — no back-to-back assignments. */
// Temporary: rest gap is off (one worker / no 30-min limit). Restore when cron/hours are live.
const WORKER_REST_MINUTES = 0;
// const WORKER_REST_MINUTES = 30;
const DEFAULT_JOB_MINUTES = 60;
const MINUTE_MS = 60_000;

export type BookingUnavailableCode =
  | "ZONE_NOT_SERVICEABLE"
  | "OUTSIDE_JOB_HOURS"
  | "NO_WORKER_IN_ZONE"
  | "NO_WORKER_AVAILABLE";

/** A booking that can't be taken for this address/time; `publicMessage` is safe to show the customer. */
export class BookingUnavailableError extends Error {
  constructor(
    readonly code: BookingUnavailableCode,
    readonly publicMessage: string,
  ) {
    super(code);
  }
}

/** When the job runs, as IST wall-clock (what the customer picked and what admin job hours use). */
export type JobSlot = {
  bookingDate: string;
  bookingTime: string;
  durationMinutes: number;
  instant: boolean;
};

type TimeWindow = { start: number; end: number; bookingId?: string; status?: string };
/** A booked service and the category it belongs to (a top-level category is its own category). */
export type BookedService = { id: string; slug: string; category: { id: string; slug: string } };

/** Everything the worker search needs, the same for booking and the availability check. */
export type WorkerSearch = {
  /** Active coverage zones containing the booking address. */
  zoneIds: string[];
  slot: JobSlot;
  jobHours: { jobHoursStart: string; jobHoursEnd: string };
  services: BookedService[];
  latitude: number;
  longitude: number;
};
/** A worker's booked job windows plus when they last finished a job. */
type Timeline = { windows: TimeWindow[]; lastCompletedAt?: Date };
type DispatchCandidate = Awaited<ReturnType<typeof serviceProviderRepository.listDispatchCandidates>>[number];
type Commitment = Awaited<ReturnType<typeof serviceProviderRepository.listCommitments>>[number];

function durationText(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** Exact start/end instants (epoch ms) of a slot. */
export function slotWindow(slot: JobSlot): TimeWindow {
  const start = indiaDateTime(slot.bookingDate, slot.bookingTime).getTime();
  return { start, end: start + slot.durationMinutes * MINUTE_MS };
}

function noWorkerAvailable(slot: JobSlot) {
  return new BookingUnavailableError(
    "NO_WORKER_AVAILABLE",
    slot.instant
      ? "All our professionals in your area are busy right now. Please schedule your booking for a later time or for tomorrow."
      : "All our professionals in your area are booked for this time. Please choose a different time slot or another day.",
  );
}

/** Where an existing job sits in time. Jobs already underway occupy the worker until they actually finish. */
function commitmentWindow(booking: Commitment["booking"], now: number): TimeWindow {
  const planned = slotWindow(bookingSlot(booking));
  const start = booking.startedAt?.getTime() ?? planned.start;
  const end = start + (planned.end - planned.start);
  const underway = booking.status === "en_route" || booking.status === "in_progress";
  return {
    start,
    end: underway ? Math.max(end, now) : end,
    bookingId: booking.id,
    status: booking.status,
  };
}

function isOnShift(rows: DispatchCandidate["availability"], slot: JobSlot) {
  if (rows.length === 0) return true;
  if (rows.some((row) => row.isBlocked && row.blockedDate?.toISOString().slice(0, 10) === slot.bookingDate)) {
    return false;
  }
  const dayOfWeek = dayOfWeekOf(slot.bookingDate);
  const windows = rows.filter((row) => row.dayOfWeek === dayOfWeek && !row.isBlocked);
  if (windows.length === 0) return true;
  return windows.some((row) =>
    jobFitsHours(slot.bookingTime, slot.durationMinutes, utcTimeHhmm(row.startTime)!, utcTimeHhmm(row.endTime)!),
  );
}

/** Busy during the slot, or (with a rest gap) not rested enough before/after it. */
function hasConflict({ windows, lastCompletedAt }: Timeline, slot: TimeWindow, restMinutes: number) {
  const rest = restMinutes * MINUTE_MS;
  // Temporary: ignore last-finished rest. Only an overlapping booked window blocks the worker.
  void lastCompletedAt;
  // if (lastCompletedAt && lastCompletedAt.getTime() > slot.start - rest) return true;
  return windows.some((window) => window.start < slot.end + rest && slot.start - rest < window.end);
}

/** When the worker last finished something before this slot (null = never worked). */
function freeSince({ windows, lastCompletedAt }: Timeline, slot: TimeWindow) {
  const ends = windows.filter((window) => window.end <= slot.start).map((window) => window.end);
  if (lastCompletedAt) ends.push(lastCompletedAt.getTime());
  return ends.length ? Math.max(...ends) : null;
}

async function loadTimelines(providerIds: string[], tx?: Prisma.TransactionClient) {
  const [commitments, lastCompleted] = await Promise.all([
    serviceProviderRepository.listCommitments(providerIds, tx),
    serviceProviderRepository.listLastCompletedAt(providerIds, tx),
  ]);
  const now = Date.now();
  const timelines = new Map<string, Timeline>(
    providerIds.map((id) => [id, { windows: [], lastCompletedAt: lastCompleted.get(id) }]),
  );
  for (const row of commitments) timelines.get(row.providerId)?.windows.push(commitmentWindow(row.booking, now));
  return timelines;
}

/** The slot of a stored booking: scheduled date/time, or the IST moment an instant booking was made. */
export function bookingSlot(booking: {
  bookingType: BookingType;
  scheduledDate: Date | null;
  scheduledStartTime: Date | null;
  createdAt: Date;
  sessionMinutes: number | null;
  plan?: { durationMinutes: number } | null;
}): JobSlot {
  const scheduledTime = utcTimeHhmm(booking.scheduledStartTime);
  const created = indiaClock(booking.createdAt);
  const scheduled = booking.bookingType === "scheduled" && booking.scheduledDate && scheduledTime;
  return {
    bookingDate: scheduled ? booking.scheduledDate!.toISOString().slice(0, 10) : created.date,
    bookingTime: scheduled ? scheduledTime! : created.time,
    durationMinutes: booking.sessionMinutes ?? booking.plan?.durationMinutes ?? DEFAULT_JOB_MINUTES,
    instant: !scheduled,
  };
}

/** Service names of a stored booking, for worker-facing messages. */
export async function bookingJobNames(booking: { serviceIds: string[]; categoryId: string; category: { name: string } }) {
  const named = await serviceCategoryRepository.namedInOrder(bookingServiceIds(booking));
  return named.length ? named.map((service) => service.name) : [booking.category.name];
}

function slotPushFields(slot: JobSlot) {
  const { start, end } = slotWindow(slot);
  return {
    scheduledDate: slot.bookingDate,
    scheduledStartTime: slot.bookingTime,
    timezone: "Asia/Kolkata",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    durationMinutes: slot.durationMinutes,
  };
}

function slotText(slot: JobSlot) {
  const [year, month, day] = slot.bookingDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${date}, ${formatHhmm12(slot.bookingTime)}`;
}

/**
 * How many of the booking's categories the worker covers. Workers' serviceCategories hold
 * category (or service) ids or slugs — admins may store either.
 */
function categoriesCovered(workerServices: string[], services: BookedService[]) {
  const offered = new Set(workerServices);
  const categories = new Map<string, boolean>();
  for (const service of services) {
    const covers =
      offered.has(service.category.id) ||
      offered.has(service.category.slug) ||
      offered.has(service.id) ||
      offered.has(service.slug);
    categories.set(service.category.id, (categories.get(service.category.id) ?? false) || covers);
  }
  return [...categories.values()].filter(Boolean).length;
}

export const bookingAssignmentService = {
  /**
   * Tells a worker a job they were given is no longer theirs (moved to someone else, or the
   * customer cancelled), so they don't travel to it. `bookingId` lets the app drop the job card.
   */
  notifyWorkerRemoved(input: {
    providerId: string;
    bookingId: string;
    reason: "reassigned" | "cancelled";
    cancelledBy?: "customer" | "admin";
    slot: JobSlot;
    serviceNames: string[];
  }) {
    notificationService.notifyProvider(input.providerId, "booking.job_removed", {
      event: "job_removed",
      reason: input.reason,
      cancelledBy: input.cancelledBy,
      bookingId: input.bookingId,
      categoryName: input.serviceNames.join(", "),
      whenText: slotText(input.slot),
      ...slotPushFields(input.slot),
      screen: "bookings",
      deepLink: "/provider/bookings",
      refreshPath: "/v1/provider/bookings",
    });
  },

  /**
   * Push + inbox entry telling the worker about a job they were just given. The data carries
   * enough to render the job card and open the job screen without another fetch.
   */
  notifyWorkerAssigned(input: {
    providerId: string;
    bookingId: string;
    slot: JobSlot;
    serviceNames: string[];
    packageName?: string | null;
    address: {
      formattedAddress: string | null;
      line1: string;
      line2: string | null;
      city: string | null;
      pincode: string | null;
      latitude: number;
      longitude: number;
    };
    reassigned?: boolean;
  }) {
    const { slot, address } = input;
    notificationService.notifyProvider(input.providerId, "booking.new_job", {
      event: "job_assigned",
      bookingId: input.bookingId,
      bookingType: slot.instant ? "instant" : "scheduled",
      reassigned: input.reassigned ?? false,
      categoryName: input.serviceNames.join(", "),
      services: input.serviceNames,
      packageName: input.packageName ?? null,
      ...slotPushFields(slot),
      address:
        address.formattedAddress?.trim() ||
        [address.line1, address.line2, address.city, address.pincode].filter(Boolean).join(", "),
      city: address.city,
      latitude: address.latitude,
      longitude: address.longitude,
      screen: "job_detail",
      deepLink: `/provider/bookings/${input.bookingId}`,
      refreshPath: `/v1/provider/bookings/${input.bookingId}`,
    });
  },

  /** Rejects slots that don't start and finish inside the admin-defined job hours (IST). */
  assertWithinJobHours(slot: JobSlot, jobHours: { jobHoursStart: string; jobHoursEnd: string }) {
    const { jobHoursStart: start, jobHoursEnd: end } = jobHours;
    if (jobFitsHours(slot.bookingTime, slot.durationMinutes, start, end)) return;

    const hours = `${formatHhmm12(start)} and ${formatHhmm12(end)}`;
    const length = durationText(slot.durationMinutes);
    if (slot.instant) {
      throw new BookingUnavailableError(
        "OUTSIDE_JOB_HOURS",
        `Instant booking isn't available right now. Our professionals work between ${hours}, and this service takes about ${length}. Please schedule it for a later time or for tomorrow.`,
      );
    }
    const openMinutes = (timeToMinutes(end) - timeToMinutes(start) + 24 * 60) % (24 * 60);
    if (openMinutes > 0 && slot.durationMinutes > openMinutes) {
      throw new BookingUnavailableError(
        "OUTSIDE_JOB_HOURS",
        `This service takes about ${length}, which is longer than our working hours (${hours}). Please contact support to book it.`,
      );
    }
    throw new BookingUnavailableError(
      "OUTSIDE_JOB_HOURS",
      `Our professionals work between ${hours}. This service takes about ${length}, so please pick a start time between ${formatHhmm12(start)} and ${formatHhmm12(latestJobStart(slot.durationMinutes, end))}, or choose another day.`,
    );
  },

  /**
   * The one worker search behind booking and the availability check, in this order:
   *  1. workers assigned to a zone containing the address (none → ZONE_NOT_SERVICEABLE);
   *  2. the whole job fits the admin job hours (→ OUTSIDE_JOB_HOURS);
   *  3. workers offering the services' category — or the service itself (→ NO_WORKER_IN_ZONE);
   *  4. workers free for the whole slot with a rest gap around it; when nobody is, the gap is
   *     dropped and any worker without an overlapping job qualifies (→ NO_WORKER_AVAILABLE).
   * Returns the free workers best first: covering the most of the booking's categories, then
   * free the longest, then nearest. Throws the customer-facing reason when there are none.
   */
  async findWorkers(search: WorkerSearch) {
    console.log("[availability] findWorkers search", {
      zoneIds: search.zoneIds,
      latitude: search.latitude,
      longitude: search.longitude,
      slot: search.slot,
      jobHours: search.jobHours,
      services: search.services,
    });

    const inZone = await serviceProviderRepository.listDispatchCandidates(search.zoneIds);
    console.log("[availability] inZone", {
      count: inZone.length,
      workers: inZone.map((worker) => ({
        id: worker.id,
        serviceCategories: worker.serviceCategories,
      })),
    });
    if (inZone.length === 0) {
      console.log("[availability] fail ZONE_NOT_SERVICEABLE", {
        reason:
          search.zoneIds.length === 0
            ? "address not inside any active zone"
            : "no active+online+KYC worker on those zones",
        zoneIds: search.zoneIds,
      });
      throw new BookingUnavailableError("ZONE_NOT_SERVICEABLE", "This address is outside our service area.");
    }

    const fitsHours = jobFitsHours(
      search.slot.bookingTime,
      search.slot.durationMinutes,
      search.jobHours.jobHoursStart,
      search.jobHours.jobHoursEnd,
    );
    console.log("[availability] job hours", {
      start: search.slot.bookingTime,
      durationMinutes: search.slot.durationMinutes,
      jobHoursStart: search.jobHours.jobHoursStart,
      jobHoursEnd: search.jobHours.jobHoursEnd,
      latestStart: latestJobStart(search.slot.durationMinutes, search.jobHours.jobHoursEnd),
      fitsHours,
    });
    this.assertWithinJobHours(search.slot, search.jobHours);

    const matching = inZone.flatMap((worker) => {
      const covered = categoriesCovered(worker.serviceCategories, search.services);
      const onShift = isOnShift(worker.availability, search.slot);
      console.log("[availability] worker match", {
        id: worker.id,
        serviceCategories: worker.serviceCategories,
        covered,
        onShift,
      });
      return covered > 0 && onShift ? [{ ...worker, covered }] : [];
    });
    console.log("[availability] matching", {
      count: matching.length,
      ids: matching.map((worker) => worker.id),
    });
    if (matching.length === 0) {
      console.log("[availability] fail NO_WORKER_IN_ZONE");
      throw new BookingUnavailableError(
        "NO_WORKER_IN_ZONE",
        "We don't have a professional available for this service in your area right now. Please try again later.",
      );
    }

    const timelines = await loadTimelines(matching.map((worker) => worker.id));
    const slot = slotWindow(search.slot);
    const freeWith = (restMinutes: number) =>
      matching.filter((worker) => !hasConflict(timelines.get(worker.id)!, slot, restMinutes));
    const restMinutes = WORKER_REST_MINUTES;
    const free = freeWith(restMinutes);
    console.log("[availability] free", {
      restMinutes,
      count: free.length,
      ids: free.map((worker) => worker.id),
      timelines: matching.map((worker) => {
        const timeline = timelines.get(worker.id)!;
        return {
          id: worker.id,
          lastCompletedAt: timeline.lastCompletedAt?.toISOString() ?? null,
          windows: timeline.windows.map((window) => ({
            bookingId: window.bookingId,
            status: window.status,
            start: new Date(window.start).toISOString(),
            end: new Date(window.end).toISOString(),
          })),
        };
      }),
    });
    if (free.length === 0) {
      console.log("[availability] fail NO_WORKER_AVAILABLE");
      throw noWorkerAvailable(search.slot);
    }

    const ranked = free.map((worker) => {
      const lat = worker.currentLatitude;
      const lng = worker.currentLongitude;
      return {
        id: worker.id,
        covered: worker.covered,
        freeSince: freeSince(timelines.get(worker.id)!, slot),
        distanceKm: lat != null && lng != null ? haversineKm(search.latitude, search.longitude, lat, lng) : null,
      };
    });
    ranked.sort((a, b) => {
      if (a.covered !== b.covered) return b.covered - a.covered;
      if (a.freeSince !== b.freeSince) {
        if (a.freeSince == null) return -1;
        if (b.freeSince == null) return 1;
        return a.freeSince - b.freeSince;
      }
      if (a.distanceKm !== b.distanceKm) {
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      }
      return a.id.localeCompare(b.id);
    });
    return { rankedProviderIds: ranked.map((worker) => worker.id), restMinutes };
  },

  /**
   * Assigns the first ranked worker who is still free once row-locked inside the booking
   * transaction (with the same rest gap the search used), so concurrent bookings can never
   * double-book a worker. Throws (rolling back the booking and its payment) when every ranked
   * worker got taken in the meantime.
   */
  async claimWorker(
    tx: Prisma.TransactionClient,
    input: { bookingId: string; rankedProviderIds: string[]; restMinutes: number; slot: JobSlot },
  ) {
    const slot = slotWindow(input.slot);
    for (const providerId of input.rankedProviderIds) {
      if (!(await serviceProviderRepository.lockForDispatch(providerId, tx))) continue;
      const timeline = (await loadTimelines([providerId], tx)).get(providerId)!;
      if (hasConflict(timeline, slot, input.restMinutes)) continue;

      const offerSequence = await assignmentRepository.nextOfferSequence(input.bookingId, tx);
      const assignment = await assignmentRepository.createManualAssignment(
        { bookingId: input.bookingId, providerId, offerSequence },
        tx,
      );
      await bookingRepository.updateStatus(input.bookingId, "assigned", tx);
      return assignment;
    }
    throw noWorkerAvailable(input.slot);
  },
};
