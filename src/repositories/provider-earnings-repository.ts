import { Prisma } from "../generated/prisma/client";
import { readDb } from "../lib/prisma";

/** Inclusive IST calendar dates (`YYYY-MM-DD`); either side may be open. */
export type EarningsDateRange = { from?: string; to?: string };

/**
 * One row per finished (completed/paid) job of the worker: the IST day of the job — its scheduled
 * date, or the day an instant booking was made — and the worker's share of its captured payments.
 * Every earnings number is derived from this, so totals and daily rows always add up.
 */
function finishedJobs(providerId: string, range: EarningsDateRange) {
  const filters = [Prisma.sql`TRUE`];
  if (range.from) filters.push(Prisma.sql`day >= ${range.from}::date`);
  if (range.to) filters.push(Prisma.sql`day <= ${range.to}::date`);
  return Prisma.sql`
    SELECT day, earned FROM (
      SELECT
        COALESCE(b.scheduled_date, ((b.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date) AS day,
        COALESCE(
          (SELECT SUM(p.provider_payout_paise) FROM payments p
           WHERE p.booking_id = b.booking_id AND p.status = 'captured'),
          0
        ) AS earned
      FROM bookings b
      WHERE b.status IN ('completed', 'paid')
        AND EXISTS (
          SELECT 1 FROM assignments a
          WHERE a.booking_id = b.booking_id AND a.provider_id = ${providerId}::uuid AND a.status = 'accepted'
        )
    ) jobs
    WHERE ${Prisma.join(filters, " AND ")}`;
}

export const providerEarningsRepository = {
  async totals(providerId: string, range: EarningsDateRange = {}) {
    const [row] = await readDb.$queryRaw<Array<{ jobsCompleted: number; earnedPaise: bigint }>>`
      SELECT COUNT(*)::int AS "jobsCompleted", COALESCE(SUM(earned), 0)::bigint AS "earnedPaise"
      FROM (${finishedJobs(providerId, range)}) f`;
    return { jobsCompleted: row.jobsCompleted, earnedPaise: BigInt(row.earnedPaise) };
  },

  /** Days with at least one finished job, newest first. */
  async daily(providerId: string, range: EarningsDateRange, page: { skip: number; take: number }) {
    const jobs = finishedJobs(providerId, range);
    const [rows, [count]] = await Promise.all([
      readDb.$queryRaw<Array<{ date: string; jobsCompleted: number; earnedPaise: bigint }>>`
        SELECT to_char(day, 'YYYY-MM-DD') AS date, COUNT(*)::int AS "jobsCompleted", SUM(earned)::bigint AS "earnedPaise"
        FROM (${jobs}) f
        GROUP BY day
        ORDER BY day DESC
        LIMIT ${page.take} OFFSET ${page.skip}`,
      readDb.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(DISTINCT day)::int AS total FROM (${jobs}) f`,
    ]);
    return {
      days: rows.map((row) => ({ ...row, earnedPaise: BigInt(row.earnedPaise) })),
      totalDays: count.total,
    };
  },
};
