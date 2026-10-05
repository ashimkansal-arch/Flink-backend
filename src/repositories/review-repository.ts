import { db, readDb } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";
import { nameEmailPhoneSearchOr, searchTerm } from "../lib/search";

const reviewPersonSelect = {
  id: true,
  fullName: true,
  phoneNumber: true,
} as const;

const adminReviewSelect = {
  id: true,
  bookingId: true,
  rating: true,
  comment: true,
  imageUrl: true,
  createdAt: true,
  customer: { select: reviewPersonSelect },
  provider: { select: reviewPersonSelect },
} as const;

function listWhere(q?: string): Prisma.ReviewRatingWhereInput {
  const term = searchTerm(q);
  if (!term) return {};
  const personOr = nameEmailPhoneSearchOr(term);
  return {
    OR: [
      { comment: { contains: term, mode: "insensitive" } },
      { customer: { OR: personOr } },
      { provider: { OR: personOr } },
    ],
  };
}

export const reviewRepository = {
  /** Live average and count of a worker's reviews. */
  async summaryForProvider(providerId: string) {
    const agg = await readDb.reviewRating.aggregate({
      where: { providerId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return { average: agg._avg.rating, reviewCount: agg._count._all };
  },

  create(data: {
    bookingId: string;
    customerId: string;
    providerId: string;
    rating: number;
    comment?: string;
    tags?: string[];
    imageUrl?: string;
  }) {
    return db.$transaction(async (tx) => {
      const review = await tx.reviewRating.create({ data });
      const agg = await tx.reviewRating.aggregate({
        where: { providerId: data.providerId },
        _avg: { rating: true },
      });
      await tx.serviceProvider.update({
        where: { id: data.providerId },
        data: { avgRating: agg._avg.rating ?? 0 },
      });
      return review;
    });
  },

  list(page: { skip: number; take: number }, q?: string) {
    const where = listWhere(q);
    return Promise.all([
      readDb.reviewRating.findMany({
        where,
        select: adminReviewSelect,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      readDb.reviewRating.count({ where }),
      readDb.reviewRating.aggregate({
        where,
        _avg: { rating: true },
      }),
    ]);
  },
};
