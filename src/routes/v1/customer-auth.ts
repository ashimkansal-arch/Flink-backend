import { FastifyRequest } from "fastify";
import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { customerAuthService } from "../../services/customer-auth-service";
import { requireAuth } from "../../lib/auth/require-auth";
import { authErrorResponses, tokenPairSchema, authedErrorResponses, otpDeliveryErrorResponses } from "../../lib/auth/schemas";
import { okResponseSchema } from "../../lib/api-schemas";

const sendOtpBodySchema = z.object({
  phoneNumber: z.string().min(8).max(15),
  purpose: z.enum(["login", "signup"]).optional(),
});

const verifyOtpBodySchema = z.object({
  phoneNumber: z.string().min(8).max(15),
  // 4 digits for MSG91/local random; 6 when OTP_STATIC_CODE=123456 is enabled.
  code: z.string().min(4).max(8).regex(/^\d+$/),
  referredByCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .optional()
    .describe("Referral code of the person who invited this customer, e.g. FLK-C-002 (case-insensitive)"),
});

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

const customerAuthErrors = new Set([
  "OTP_EXPIRED_OR_NOT_FOUND",
  "OTP_INVALID",
  "OTP_DELIVERY_FAILED",
  "ACCOUNT_DELETED",
  "ACCOUNT_BLOCKED",
]);

// otp/send triggers an external send (cost/abuse risk) — rate-limited per phone number, not
// just per IP, since an attacker can rotate IPs but the target phone number stays fixed.
function otpSendKeyGenerator(request: FastifyRequest): string {
  const body = request.body as { phoneNumber?: string } | undefined;
  return `otp-send:${body?.phoneNumber ?? request.ip}`;
}

export const customerAuthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/customer/auth/otp/send",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute", keyGenerator: otpSendKeyGenerator } },
      schema: {
        tags: ["Customer Auth"],
        summary: "Send a login/signup OTP to a customer phone number",
        body: sendOtpBodySchema,
        response: { 200: okResponseSchema, ...otpDeliveryErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await customerAuthService.sendOtp(request.body.phoneNumber, request.body.purpose);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        if (err instanceof Error && err.message === "OTP_DELIVERY_FAILED") {
          return reply.code(502).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/customer/auth/otp/resend",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute", keyGenerator: otpSendKeyGenerator } },
      schema: {
        tags: ["Customer Auth"],
        summary: "Resend the same OTP to a customer phone number",
        body: z.object({ phoneNumber: z.string().min(8).max(15) }),
        response: { 200: okResponseSchema, ...otpDeliveryErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        await customerAuthService.resendOtp(request.body.phoneNumber);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        if (err instanceof Error && customerAuthErrors.has(err.message)) {
          return reply.code(err.message === "OTP_DELIVERY_FAILED" ? 502 : 401).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/customer/auth/otp/verify",
    {
      schema: {
        tags: ["Customer Auth"],
        summary: "Verify an OTP and log in — creates the customer on first verify",
        body: verifyOtpBodySchema,
        response: { 200: tokenPairSchema, ...authErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const tokens = await customerAuthService.verifyOtpAndLogin(
          request.body.phoneNumber,
          request.body.code,
          request.body.referredByCode,
        );
        return reply.code(200).send(tokens);
      } catch (err) {
        if (err instanceof Error && customerAuthErrors.has(err.message)) {
          return reply.code(err.message.startsWith("ACCOUNT_") ? 403 : 401).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/customer/auth/refresh",
    {
      schema: {
        tags: ["Customer Auth"],
        summary: "Exchange a refresh token for a new access/refresh pair",
        body: refreshBodySchema,
        response: { 200: tokenPairSchema, ...authErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const tokens = await customerAuthService.refresh(request.body.refreshToken);
        return reply.code(200).send(tokens);
      } catch (err) {
        if (err instanceof Error && (err.message === "ACCOUNT_DELETED" || err.message === "ACCOUNT_BLOCKED")) {
          return reply.code(403).send({ error: err.message });
        }
        return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });
      }
    },
  );

  app.post(
    "/customer/auth/logout",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Auth"],
        summary: "Revoke the current session's refresh token",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      await customerAuthService.logout(request.auth!.id);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/customer/account",
    {
      preHandler: requireAuth("customer"),
      schema: {
        tags: ["Customer Auth"],
        summary: "Soft-delete the authenticated customer account",
        description:
          "Sets status to deleted and records deletedAt. Revokes refresh tokens. Does not permanently remove the row.",
        security: [{ bearerAuth: [] }],
        response: {
          204: z.null().describe("Account soft-deleted; no response body"),
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      await customerAuthService.deleteAccount(request.auth!.id);
      return reply.code(204).send(null);
    },
  );
};
