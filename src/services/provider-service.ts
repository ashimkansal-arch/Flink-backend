import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { providerKycDocumentRepository } from "../repositories/provider-kyc-document-repository";
import { geo, haversineKm } from "../lib/geo";
import {
  availabilityStatusFrom,
  computeKycStatus,
} from "./provider-kyc-service";
import { notificationService } from "./notification-service";
import { assignmentRepository } from "../repositories/assignment-repository";
import { bookingRepository } from "../repositories/booking-repository";
import { providerEarningsRepository } from "../repositories/provider-earnings-repository";
import { db } from "../lib/prisma";
import { paise } from "../lib/money";
import { indiaWeek } from "../lib/job-hours";

const ARRIVAL_RADIUS_KM = 0.2;
const PROVIDERS_GEO_INDEX = "providers";

export type ProviderAvailabilityStatus = "online" | "offline";

async function requireActiveProvider(providerId: string) {
  const provider = await serviceProviderRepository.findById(providerId);
  if (!provider || provider.status === "deleted") throw new Error("PROVIDER_NOT_FOUND");
  if (provider.status !== "active") throw new Error("ACCOUNT_INACTIVE");
  return provider;
}

async function maybeNotifyArrival(
  providerId: string,
  lat: number,
  lng: number,
  job: Awaited<ReturnType<typeof assignmentRepository.findActiveJobForProvider>>,
) {
  if (!job) return;
  const distanceKm = haversineKm(lat, lng, job.booking.address.latitude, job.booking.address.longitude);
  if (distanceKm > ARRIVAL_RADIUS_KM) return;
  if (job.booking.trackingEvents.length > 0) return;

  await db.bookingTrackingEvent.create({
    data: {
      bookingId: job.booking.id,
      providerId,
      eventType: "arrived",
      latitude: lat,
      longitude: lng,
    },
  });
  if (job.booking.status === "assigned") {
    await bookingRepository.updateStatus(job.booking.id, "en_route");
  }
  notificationService.notify({
    recipientType: "customer",
    recipientId: job.booking.customerId,
    templateKey: "booking.provider_nearby",
    payload: { bookingId: job.booking.id },
  });
}

export const providerService = {
  async getProfile(providerId: string) {
    const provider = await serviceProviderRepository.findProfileById(providerId);
    if (!provider) throw new Error("PROVIDER_NOT_FOUND");

    const kyc = computeKycStatus(await providerKycDocumentRepository.listByProviderId(providerId));
    const { avgRating, acceptanceRate, registeredBySupervisor, isAvailable, ...rest } = provider;

    return {
      ...rest,
      isAvailable,
      avgRating: Number(avgRating),
      acceptanceRate: Number(acceptanceRate),
      supervisor: registeredBySupervisor,
      availabilityStatus: availabilityStatusFrom(isAvailable),
      ...kyc,
      kycVerified: kyc.kycStatus === "approved",
    };
  },

  async getStats(providerId: string) {
    const week = indiaWeek();
    const [allTime, weekEarnings, weekJobs] = await Promise.all([
      providerEarningsRepository.totals(providerId),
      providerEarningsRepository.totals(providerId, { from: week.startDate, to: week.endDate }),
      bookingRepository.providerJobCounts(providerId, week),
    ]);
    return {
      totalJobsCompleted: allTime.jobsCompleted,
      totalEarnedPaise: paise(allTime.earnedPaise),
      thisWeek: {
        startDate: week.startDate,
        endDate: week.endDate,
        ...weekJobs,
        earnedPaise: paise(weekEarnings.earnedPaise),
      },
    };
  },

  async updateStatus(
    providerId: string,
    input: { status: ProviderAvailabilityStatus; lat: number; long: number },
    opts?: { allowOffline?: boolean; silent?: boolean },
  ) {
    await requireActiveProvider(providerId);

    if (input.status === "offline" && !opts?.allowOffline) {
      throw new Error("OFFLINE_REQUEST_REQUIRED");
    }

    const activeJob = await assignmentRepository.findActiveJobForProvider(providerId);
    // Online/offline is the worker's own toggle. Being on a job doesn't take them offline —
    // dispatch works out who is busy from their booked time slots.
    const isAvailable = input.status === "online";
    const updated = await serviceProviderRepository.updateLocationAndAvailability(
      providerId,
      input.lat,
      input.long,
      isAvailable,
    );

    if (isAvailable) {
      await geo.add(PROVIDERS_GEO_INDEX, providerId, input.long, input.lat);
    } else {
      await geo.remove(PROVIDERS_GEO_INDEX, providerId);
    }

    await maybeNotifyArrival(providerId, input.lat, input.long, activeJob).catch(() => undefined);

    if (!isAvailable && !opts?.silent) {
      notificationService.notifyProvider(providerId, "provider.offline", {
        lat: input.lat,
        long: input.long,
      });
    }

    return {
      status: input.status,
      lat: updated.currentLatitude!,
      long: updated.currentLongitude!,
      isAvailable: updated.isAvailable,
      locationUpdatedAt: updated.locationUpdatedAt!,
    };
  },
};
