import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        summary: "Liveness check",
        response: { 200: z.object({ status: z.literal("ok") }) },
      },
    },
    async () => {
      return { status: "ok" as const };
    },
  );
};
