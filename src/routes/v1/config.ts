import { createHash } from "node:crypto";
import { FastifyRequest } from "fastify";
import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../lib/auth/require-auth";
import { authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { googleApiKey } from "../../lib/google-api-key";

const googleApiKeyResponseSchema = z.object({
  googleApiKey: z.string().min(1),
});

// Hash the bearer token so rate-limit keys never store a raw JWT. Unauthenticated
// probes fall back to IP so this route cannot be scraped without a session.
function googleApiKeyRateLimitKey(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ") && header.length > "Bearer ".length) {
    const digest = createHash("sha256").update(header.slice("Bearer ".length)).digest("hex").slice(0, 32);
    return `google-api-key:${digest}`;
  }
  return `google-api-key:ip:${request.ip}`;
}

export const configRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/config/google-api-key",
    {
      preHandler: requireAuth(["customer", "provider", "admin", "supervisor"]),
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: googleApiKeyRateLimitKey,
        },
      },
      schema: {
        tags: ["Config"],
        summary: "Fetch the restricted Google Maps / Places API key",
        description:
          "Shared by customer, provider, and dashboard apps. Requires a valid Bearer JWT. " +
          "The key is a client credential restricted in Google Cloud Console — not a server key. " +
          "Tightly rate-limited; responses are not cacheable by intermediaries.",
        security: [{ bearerAuth: [] }],
        response: {
          200: googleApiKeyResponseSchema,
          503: errorResponseSchema,
          ...authedErrorResponses,
        },
      },
    },
    async (_request, reply) => {
      const key = googleApiKey();
      if (!key) {
        return reply.code(503).send({ error: "GOOGLE_API_KEY_NOT_CONFIGURED" });
      }

      reply.header("Cache-Control", "private, no-store, no-cache, must-revalidate");
      reply.header("Pragma", "no-cache");
      return { googleApiKey: key };
    },
  );
};
