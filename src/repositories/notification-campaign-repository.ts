import { db, readDb } from "../lib/prisma";

export const notificationCampaignRepository = {
  create(data: {
    title: string;
    body: string;
    category: string;
    tone: string;
    audience: string;
    recipientCount: number;
    createdByAdminId: string;
  }) {
    return db.notificationCampaign.create({ data });
  },

  list(includeArchived = false) {
    return readDb.notificationCampaign.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  },

  findById(id: string) {
    return readDb.notificationCampaign.findUnique({ where: { id } });
  },

  update(
    id: string,
    data: { readAt?: Date | null; archivedAt?: Date | null },
  ) {
    return db.notificationCampaign.update({ where: { id }, data });
  },
};
