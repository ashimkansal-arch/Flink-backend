import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { legalSupportPublicSchema } from "../../lib/api-schemas";
import { legalSupportService } from "../../services/legal-support-service";
import { platformConfigService } from "../../services/platform-config-service";

export const legalSupportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/legal-support",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["Legal & Support"],
        summary: "Public Terms, Privacy, Refund, Cancellation, Pricing, FAQs, contact details and job hours",
        description:
          "Unauthenticated. Used by customer and provider apps on the login screen. No bearer token. " +
          "`jobHours` are the worker job timings set by admin (Admin Settings), in IST; bookings must start and finish inside them.",
        response: { 200: legalSupportPublicSchema },
      },
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "public, max-age=60");
      const [content, jobHours] = await Promise.all([legalSupportService.get(), platformConfigService.jobHours()]);
      return { ...content, jobHours };
    },
  );
};
