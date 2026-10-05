import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  authService,
  CONTACT_ADMIN_PASSWORD_RESET_MESSAGE,
} from "../../services/auth-service";
import { requireAuth } from "../../lib/auth/require-auth";
import { tokenPairSchema, errorResponseSchema, authedErrorResponses } from "../../lib/auth/schemas";
import { okResponseSchema } from "../../lib/api-schemas";

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

const forgotPasswordBodySchema = z.object({
  email: z.string().email(),
});

const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

const loginResponseSchema = tokenPairSchema.extend({
  passwordResetRequired: z.boolean(),
  type: z.enum(["admin", "supervisor"]),
  role: z.string().nullable(),
});

function actorType(auth: { type: string }): "admin" | "supervisor" {
  return auth.type === "supervisor" ? "supervisor" : "admin";
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            `auth-login:${(request.body as { email?: string } | undefined)?.email ?? request.ip}`,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Log in with email + password (super-admin, admin, or supervisor)",
        description:
          "Shared login for the dashboard. Looks up the email in admin users first, then supervisors. Response `type` is admin or supervisor; `role` is set for admins (e.g. super_admin, admin) and null for supervisors.",
        body: loginBodySchema,
        response: { 200: loginResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(await authService.login(request.body.email, request.body.password));
      } catch (err) {
        if (err instanceof Error && err.message === "INVALID_CREDENTIALS") {
          return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
        }
        throw err;
      }
    },
  );

  app.post(
    "/auth/forgot-password",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: (request) =>
            `auth-forgot-password:${(request.body as { email?: string } | undefined)?.email ?? request.ip}`,
        },
      },
      schema: {
        tags: ["Auth"],
        summary: "Request a temporary password (super-admin only)",
        description:
          "If the email belongs to an active super-admin, a temporary password is emailed and passwordResetRequired is set to true. Regular admins and supervisors must contact their administrator.",
        body: forgotPasswordBodySchema,
        response: {
          200: okResponseSchema.extend({ passwordResetRequired: z.literal(true) }),
          403: errorResponseSchema.extend({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(await authService.forgotPassword(request.body.email));
      } catch (err) {
        if (err instanceof Error && err.message === "CONTACT_ADMIN") {
          return reply.code(403).send({
            error: "CONTACT_ADMIN",
            message: CONTACT_ADMIN_PASSWORD_RESET_MESSAGE,
          });
        }
        throw err;
      }
    },
  );

  app.post(
    "/auth/refresh",
    {
      schema: {
        tags: ["Auth"],
        summary: "Exchange a refresh token for a new access/refresh pair",
        body: refreshBodySchema,
        response: { 200: tokenPairSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(await authService.refresh(request.body.refreshToken));
      } catch {
        return reply.code(401).send({ error: "INVALID_REFRESH_TOKEN" });
      }
    },
  );

  app.post(
    "/auth/logout",
    {
      preHandler: requireAuth(["admin", "supervisor"]),
      schema: {
        tags: ["Auth"],
        summary: "Revoke the current session's refresh token",
        security: [{ bearerAuth: [] }],
        response: { 204: z.null(), ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      await authService.logout(actorType(auth), auth.id);
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/me/password",
    {
      preHandler: requireAuth(["admin", "supervisor"]),
      schema: {
        tags: ["Auth"],
        summary: "Change password and clear passwordResetRequired",
        security: [{ bearerAuth: [] }],
        body: changePasswordBodySchema,
        response: { 204: z.null(), ...authedErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const auth = request.auth!;
        await authService.changePassword(
          actorType(auth),
          auth.id,
          request.body.currentPassword,
          request.body.newPassword,
        );
        return reply.code(204).send(null);
      } catch (err) {
        if (err instanceof Error && err.message === "INVALID_CREDENTIALS") {
          return reply.code(401).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};
