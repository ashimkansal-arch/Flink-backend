import { FastifyRequest } from "fastify";
import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { providerAuthService, ProviderDeviceMismatchError } from "../../services/provider-auth-service";
import { requireAuth } from "../../lib/auth/require-auth";
import { authErrorResponses, tokenPairSchema, authedErrorResponses, errorResponseSchema } from "../../lib/auth/schemas";
import { deviceMismatchMessage } from "../../lib/provider-device";
import { PROVIDER_ACCOUNT_ERROR_CODES } from "../../lib/auth/actor-status";

const loginBodySchema = z.object({
  phoneNumber: z.string().min(8).max(15),
  deviceId: z.string().min(1).max(120),
  deviceName: z.string().min(1).max(120),
});

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

const deviceAuthErrorSchema = errorResponseSchema.extend({
  message: z.string(),
});

function mapAccountError(err: unknown): { status: 403; body: { error: string } } | null {
  if (err instanceof Error && PROVIDER_ACCOUNT_ERROR_CODES.has(err.message)) {
    return { status: 403, body: { error: err.message } };
  }
  return null;
}

function loginKeyGenerator(request: FastifyRequest): string {
  const body = request.body as { phoneNumber?: string } | undefined;
  return `provider-login:${body?.phoneNumber ?? request.ip}`;
}

function mapLoginError(err: unknown): { status: 401 | 403 | 404; body: { error: string; message?: string } } | null {
  if (err instanceof ProviderDeviceMismatchError) {
    return {
      status: 401,
      body: { error: err.message, message: deviceMismatchMessage(err.registeredDeviceName) },
    };
  }
  if (!(err instanceof Error)) return null;
  if (err.message === "PROVIDER_NOT_FOUND") return { status: 404, body: { error: err.message } };
  return mapAccountError(err);
}

export const providerAuthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/provider/auth/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: loginKeyGenerator,
        },
      },
      schema: {
        tags: ["Provider Auth"],
        summary: "Log in with phone number and registered device",
        description:
          "Provider must already exist (created by admin/supervisor). If no device is registered yet, the submitted device is saved and login succeeds. If a device is already registered, deviceId must match.",
        body: loginBodySchema,
        response: {
          200: tokenPairSchema,
          401: deviceAuthErrorSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { phoneNumber, deviceId, deviceName } = request.body;
        const tokens = await providerAuthService.login(phoneNumber, { deviceId, deviceName });
        return reply.code(200).send(tokens);
      } catch (err) {
        const mapped = mapLoginError(err);
        if (!mapped) throw err;
        return reply.code(mapped.status).send(mapped.body);
      }
    },
  );

  app.post(
    "/provider/auth/refresh",
    {
      schema: {
        tags: ["Provider Auth"],
        summary: "Exchange a refresh token for a new access/refresh pair",
        body: refreshBodySchema,
        response: { 200: tokenPairSchema, ...authErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const tokens = await providerAuthService.refresh(request.body.refreshToken);
        return reply.code(200).send(tokens);
      } catch (err) {
        const mapped = mapAccountError(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });
      }
    },
  );

  app.post(
    "/provider/auth/logout",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Auth"],
        summary: "Revoke the current session's refresh token",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      await providerAuthService.logout(request.auth!.id);
      return reply.code(204).send();
    },
  );

  app.delete(
    "/provider/account",
    {
      preHandler: requireAuth("provider"),
      schema: {
        tags: ["Provider Auth"],
        summary: "Soft-delete the authenticated provider account",
        description:
          "Sets status to deleted and records deletedAt. Revokes refresh tokens and marks the provider unavailable.",
        security: [{ bearerAuth: [] }],
        response: {
          204: z.null().describe("Account soft-deleted; no response body"),
          ...authedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      await providerAuthService.deleteAccount(request.auth!.id);
      return reply.code(204).send(null);
    },
  );
};
