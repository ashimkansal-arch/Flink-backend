import { z } from "zod";

export const dashboardPeriodSchema = z
  .enum(["last_30_days", "3_months", "9_months", "1_year", "all"])
  .default("all");

export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;

const PERIOD_DAYS: Record<Exclude<DashboardPeriod, "all">, number> = {
  last_30_days: 30,
  "3_months": 90,
  "9_months": 270,
  "1_year": 365,
};

export function dashboardPeriodStart(period: DashboardPeriod): Date | null {
  if (period === "all") return null;
  const ms = PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

export function createdSinceFilter(start: Date | null) {
  return start ? { createdAt: { gte: start } } : {};
}
