import { db, readDb } from "../lib/prisma";

const CONFIG_ID = "default";

export const platformConfigRepository = {
  async get() {
    return readDb.platformConfig.findUnique({ where: { id: CONFIG_ID } });
  },

  async getOrCreate() {
    const existing = await this.get();
    if (existing) return existing;
    return db.platformConfig.create({
      data: {
        id: CONFIG_ID,
        providerKycUploadEnabled: true,
        jobHoursStart: "09:00",
        jobHoursEnd: "20:00",
      },
    });
  },

  async update(
    data: {
      providerKycUploadEnabled?: boolean;
      jobHoursStart?: string;
      jobHoursEnd?: string;
      updatedByAdminId?: string | null;
    },
  ) {
    await this.getOrCreate();
    return db.platformConfig.update({
      where: { id: CONFIG_ID },
      data,
    });
  },
};
