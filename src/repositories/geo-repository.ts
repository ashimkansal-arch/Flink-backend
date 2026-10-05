import { readDb } from "../lib/prisma";

const INDIA_COUNTRY_ID = "00000000-0000-4000-8000-000000000001";

export const geoRepository = {
  listCountries() {
    return readDb.country.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    });
  },

  listStates(countryId?: string) {
    return readDb.state.findMany({
      where: {
        isActive: true,
        countryId: countryId ?? INDIA_COUNTRY_ID,
        country: { isActive: true },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    });
  },

  listCities(stateId: string) {
    return readDb.city.findMany({
      where: { stateId, isActive: true, state: { isActive: true } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  },

  async listCitiesForState(stateId: string) {
    const state = await readDb.state.findFirst({
      where: { id: stateId, isActive: true },
      select: { id: true },
    });
    if (!state) throw new Error("STATE_NOT_FOUND");
    return this.listCities(stateId);
  },
};
