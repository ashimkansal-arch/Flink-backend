import { paise } from "../lib/money";
import { addDays, indiaDateTime, indiaWeek } from "../lib/job-hours";
import { paginatedResult, paginationSkip, type PaginationQuery } from "../lib/pagination";
import {
  providerEarningsRepository,
  type EarningsDateRange,
} from "../repositories/provider-earnings-repository";

type EarningsPeriod = "week" | "month";

const RECENT_DAYS = 3;

/** The Monday–Sunday week or calendar month (IST) containing `date`. */
function periodRange(period: EarningsPeriod, date: string) {
  if (period === "week") {
    const week = indiaWeek(indiaDateTime(date, "12:00"));
    return { startDate: week.startDate, endDate: week.endDate };
  }
  const startDate = `${date.slice(0, 7)}-01`;
  const nextMonth = addDays(startDate, 32).slice(0, 7);
  return { startDate, endDate: addDays(`${nextMonth}-01`, -1) };
}

function toDto(row: { jobsCompleted: number; earnedPaise: bigint }) {
  return { jobsCompleted: row.jobsCompleted, earnedPaise: paise(row.earnedPaise) };
}

async function dailyPage(providerId: string, range: EarningsDateRange, page: PaginationQuery) {
  const { days, totalDays } = await providerEarningsRepository.daily(providerId, range, paginationSkip(page));
  return paginatedResult(
    days.map((day) => ({ date: day.date, ...toDto(day) })),
    totalDays,
    page,
  );
}

export const providerEarningsService = {
  async summary(providerId: string, period: EarningsPeriod, date: string) {
    const range = periodRange(period, date);
    const [allTime, inPeriod, recent] = await Promise.all([
      providerEarningsRepository.totals(providerId),
      providerEarningsRepository.totals(providerId, { from: range.startDate, to: range.endDate }),
      dailyPage(providerId, { from: range.startDate, to: range.endDate }, { page: 1, limit: RECENT_DAYS }),
    ]);
    return {
      total: toDto(allTime),
      period: { type: period, ...range, ...toDto(inPeriod) },
      recentDays: recent.items,
      hasMoreDays: recent.total > recent.items.length,
    };
  },

  async daily(providerId: string, range: EarningsDateRange, page: PaginationQuery) {
    const [result, inRange] = await Promise.all([
      dailyPage(providerId, range, page),
      providerEarningsRepository.totals(providerId, range),
    ]);
    return { ...result, range: { from: range.from ?? null, to: range.to ?? null, ...toDto(inRange) } };
  },
};
