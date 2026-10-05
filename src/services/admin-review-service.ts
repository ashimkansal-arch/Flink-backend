import { reviewRepository } from "../repositories/review-repository";
import { paginatedResult, paginationSkip, type SearchQuery } from "../lib/pagination";
import { resolveReviewImageDisplayUrl } from "../lib/review-image";

type ReviewRow = Awaited<ReturnType<typeof reviewRepository.list>>[0][number];

async function toReviewDto(row: ReviewRow) {
  let imageUrl: string | null = null;
  try {
    imageUrl = await resolveReviewImageDisplayUrl(row.imageUrl);
  } catch {
    imageUrl = row.imageUrl;
  }
  return {
    id: row.id,
    bookingId: row.bookingId,
    rating: row.rating,
    comment: row.comment,
    imageUrl,
    createdAt: row.createdAt,
    customer: row.customer,
    worker: row.provider,
  };
}

export const adminReviewService = {
  async list(query: SearchQuery) {
    const [rows, total, agg] = await reviewRepository.list(paginationSkip(query), query.q);
    const items = await Promise.all(rows.map(toReviewDto));
    return {
      ...paginatedResult(items, total, query),
      stats: {
        total,
        avgRating: Number(agg._avg.rating ?? 0),
      },
    };
  },
};
