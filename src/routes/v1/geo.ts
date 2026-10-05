import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses } from "../../lib/auth/schemas";
import { geoRepository } from "../../repositories/geo-repository";

const countrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
});

const stateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
});

const citySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const statesQuerySchema = z.object({
  countryId: z.string().uuid().optional().describe("Defaults to India when omitted"),
});

const citiesQuerySchema = z.object({
  stateId: z.string().uuid(),
});

export const geoRoutes: FastifyPluginAsyncZod = async (app) => {
  const staffAuth = requireAuth(["admin", "supervisor"]);

  app.get(
    "/geo/countries",
    {
      preHandler: staffAuth,
      schema: {
        tags: ["Geo"],
        summary: "List active countries",
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(countrySchema), ...authedErrorResponses },
      },
    },
    async () => geoRepository.listCountries(),
  );

  app.get(
    "/geo/states",
    {
      preHandler: staffAuth,
      schema: {
        tags: ["Geo"],
        summary: "List states for a country",
        description: "Defaults to India when countryId is omitted.",
        security: [{ bearerAuth: [] }],
        querystring: statesQuerySchema,
        response: { 200: z.array(stateSchema), ...authedErrorResponses },
      },
    },
    async (request) => geoRepository.listStates(request.query.countryId),
  );

  app.get(
    "/geo/cities",
    {
      preHandler: staffAuth,
      schema: {
        tags: ["Geo"],
        summary: "List cities for a state",
        security: [{ bearerAuth: [] }],
        querystring: citiesQuerySchema,
        response: { 200: z.array(citySchema), ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        return await geoRepository.listCitiesForState(request.query.stateId);
      } catch (err) {
        if (err instanceof Error && err.message === "STATE_NOT_FOUND") {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};
