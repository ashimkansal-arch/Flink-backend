import { db, readDb } from "../lib/prisma";
import { HomeSize, HomeType, PetType } from "../generated/prisma/enums";

export interface UpsertHomeProfileInput {
  homeType: HomeType;
  homeSize: HomeSize;
  floorNumber?: number;
  adultsCount: number;
  childrenCount: number;
  seniorsCount: number;
  hasFemaleMember: boolean;
  liveSelfieUrl?: string;
  hasPets: boolean;
  petType?: PetType;
  petCount?: number;
}

export const homeProfileRepository = {
  findByUser(userId: string) {
    return readDb.homeProfile.findUnique({ where: { userId } });
  },

  upsert(userId: string, data: UpsertHomeProfileInput) {
    return db.homeProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  },
};
