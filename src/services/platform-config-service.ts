import { platformConfigRepository } from "../repositories/platform-config-repository";
import { formatHhmm12, normalizeHhmm } from "../lib/job-hours";

function parseJobHour(value: string | undefined, field: "JOB_HOURS_START" | "JOB_HOURS_END") {
  if (value === undefined) return undefined;
  const normalized = normalizeHhmm(value);
  if (!normalized) throw new Error(`INVALID_${field}`);
  return normalized;
}

function toDto(row: Awaited<ReturnType<typeof platformConfigRepository.getOrCreate>>) {
  return {
    providerKycUploadEnabled: row.providerKycUploadEnabled,
    jobHoursStart: row.jobHoursStart,
    jobHoursEnd: row.jobHoursEnd,
    updatedAt: row.updatedAt,
  };
}

export const platformConfigService = {
  async get() {
    return toDto(await platformConfigRepository.getOrCreate());
  },

  async update(
    input: {
      providerKycUploadEnabled?: boolean;
      jobHoursStart?: string;
      jobHoursEnd?: string;
    },
    adminId?: string,
  ) {
    return toDto(
      await platformConfigRepository.update({
        providerKycUploadEnabled: input.providerKycUploadEnabled,
        jobHoursStart: parseJobHour(input.jobHoursStart, "JOB_HOURS_START"),
        jobHoursEnd: parseJobHour(input.jobHoursEnd, "JOB_HOURS_END"),
        updatedByAdminId: adminId ?? null,
      }),
    );
  },

  /** Worker job hours set by admin, for the apps: IST `HH:mm` plus ready-to-show text. */
  async jobHours() {
    const { jobHoursStart: start, jobHoursEnd: end } = await platformConfigRepository.getOrCreate();
    return {
      start,
      end,
      timezone: "Asia/Kolkata" as const,
      allDay: start === end,
      displayText: start === end ? "Open 24 hours" : `${formatHhmm12(start)} – ${formatHhmm12(end)}`,
    };
  },

  async isProviderKycUploadEnabled() {
    const config = await platformConfigRepository.getOrCreate();
    return config.providerKycUploadEnabled;
  },
};
