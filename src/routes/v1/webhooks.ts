import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { paymentService } from "../../services/payment-service";
import { stripeWebhookService } from "../../services/stripe-webhook-service";
import { errorResponseSchema } from "../../lib/auth/schemas";

const receivedResponseSchema = z.object({ received: z.literal(true) });

// Unauthenticated by design — Stripe, not a logged-in actor, calls this. Authenticity comes from
// the signature check below, not a bearer token.
export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/webhooks/stripe",
    {
      schema: {
        tags: ["Webhooks"],
        summary: "Stripe payment event webhook (payment_intent.succeeded etc.)",
        description:
          "Unauthenticated — Stripe calls this directly. Request authenticity is verified via the Stripe-Signature header, not a bearer token.",
        response: { 200: receivedResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const signature = request.headers["stripe-signature"];
      if (typeof signature !== "string" || !request.rawBody) {
        return reply.code(400).send({ error: "MISSING_SIGNATURE" });
      }

      let event;
      try {
        event = paymentService.constructWebhookEvent(request.rawBody, signature);
      } catch {
        return reply.code(400).send({ error: "INVALID_SIGNATURE" });
      }

      await stripeWebhookService.handleEvent(event);
      return reply.code(200).send({ received: true });
    },
  );
};
