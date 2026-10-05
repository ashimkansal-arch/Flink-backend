import { readDb } from "../lib/prisma";

export const referralRepository = {
  listByReferrer(userId: string) {
    return readDb.referral.findMany({
      where: { referrerUserId: userId },
      include: { referred: { select: { id: true, fullName: true, phoneNumber: true } } },
      orderBy: { createdAt: "desc" },
    });
  },
};
