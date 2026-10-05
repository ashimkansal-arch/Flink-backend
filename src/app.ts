import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { AppConfig } from "./config";
import { PROVIDER_KYC_UPLOAD } from "./lib/provider-kyc";
import { PROFILE_PHOTO_UPLOAD } from "./lib/profile-photo";
import { CATALOG_ICON_UPLOAD } from "./lib/catalog-icon";
import { REVIEW_IMAGE_UPLOAD } from "./lib/review-image";
import { healthRoutes } from "./routes/health";
import { v1Routes } from "./routes/v1";
import { recordStaffActivity } from "./lib/staff-audit";
import { publicRequestError } from "./lib/http-errors";
import { sendUploadError } from "./lib/upload-route";

export async function buildApp(config: AppConfig) {
  const app = Fastify({ logger: { level: config.logLevel } }).withTypeProvider<ZodTypeProvider>();

  // Route schemas are zod schemas (see src/routes/*) — Fastify validates/serializes against them
  // directly, and @fastify/swagger reads the same schemas to generate the OpenAPI doc below. One
  // definition, not one for validation and a second hand-kept one for docs.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Route handlers catch their own *expected* business-logic errors (e.g. INVALID_PLAN,
  // BOOKING_NOT_FOUND) and reply directly — those never reach this handler. Anything that does
  // is unexpected: a bug, or a third-party SDK's own error (Prisma, Stripe...). Those must never
  // reach the client verbatim — e.g. a misconfigured Stripe key's error message includes a
  // fragment of the key itself — so only genuinely client-facing categories (request validation,
  // rate limiting) pass their real status/message through; everything else is logged in full and
  // replaced with a generic 500.
  //
  // Must be set before any app.register() below: Fastify's encapsulation snapshots the error
  // handler in effect at plugin-registration time, so setting it after registering the route
  // plugins would leave their routes on Fastify's default (leaky) handler instead of this one.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err.code === "FST_REQ_FILE_TOO_LARGE" || err.code === "FST_FILES_LIMIT") {
      return sendUploadError(reply, "FILE_TOO_LARGE");
    }
    if (err.validation || err.code === "FST_ERR_VALIDATION" || err.statusCode === 429) {
      return reply.code(err.statusCode ?? 400).send({ error: publicRequestError(err) });
    }
    request.log.error(err);
    return reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });

  // Capture the raw bytes alongside Fastify's normal JSON parsing — the Stripe webhook route
  // (src/routes/v1/webhooks.ts) needs the exact signed bytes to verify request authenticity;
  // every other route just uses request.body as before.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    request.rawBody = body as Buffer;
    if (body.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      const parsed = JSON.parse(body.toString("utf8")) as unknown;
      done(null, parsed === null ? undefined : parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(multipart, {
    limits: {
      fileSize: Math.max(
        PROVIDER_KYC_UPLOAD.maxBytes,
        PROFILE_PHOTO_UPLOAD.maxBytes,
        CATALOG_ICON_UPLOAD.maxBytes,
        REVIEW_IMAGE_UPLOAD.maxBytes,
      ),
      files: 4,
      // documentType (+ occasional empty extras from some clients)
      fields: 10,
      parts: 12,
    },
  });
  await app.register(rateLimit, config.rateLimit);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Flink Backend API",
        description:
          "Direct REST APIs for the Flink on-demand home services marketplace — customer catalog, bookings, wallet, provider KYC, and admin dashboard.",
        version: "0.1.0",
      },
      tags: [
        { name: "Me", description: "Shared profile for customers, providers, and dashboard staff" },
        { name: "Config", description: "Shared client configuration for authenticated apps" },
        { name: "Teams", description: "Super Admin CRM team management — members/admins, supervisors, roles, scopes" },
        { name: "Access Control", description: "Org teams, visibility/approval/workflow/SLA policies, and audit" },
        { name: "Customer Auth", description: "Customer OTP login, session, and account lifecycle" },
        { name: "Customer Profile", description: "Location confirmation and home details onboarding" },
        { name: "Customer Catalog", description: "Browse service categories, plans, and add-ons" },
        { name: "Customer Bookings", description: "Create, view, cancel, and review bookings" },
        { name: "Customer Wallet", description: "Wallet balance, transactions, and top-up" },
        { name: "Customer Coupons", description: "Validate a coupon code and preview the discounted price" },
        { name: "Customer Referral", description: "Referral code and referral history" },
        { name: "Webhooks", description: "Third-party callbacks (Stripe payment events)" },
        { name: "Provider Auth", description: "Provider phone + device login, session, and account lifecycle" },
        { name: "Provider", description: "Authenticated provider profile, availability, and KYC" },
        { name: "Provider Bookings", description: "Worker job list, detail, and session OTP start" },
        { name: "Provider Home", description: "Worker home screen" },
        { name: "Provider Earnings", description: "Worker earnings summary and day-by-day breakdown" },
        { name: "Supervisor Providers", description: "Supervisor review of provider KYC documents" },
        {
          name: "Auth",
          description: "Shared email/password login for super-admin, admin, and supervisor (dashboard)",
        },
        { name: "Geo", description: "Countries, states, and cities reference data" },
        { name: "Admin Users", description: "Super-admin management of admin accounts" },
        { name: "Admin Roles", description: "CRUD for admin roles" },
        { name: "Admin Categories", description: "CRUD for service categories and sub-categories" },
        { name: "Admin Packages", description: "Recommended multi-service packages" },
        { name: "Admin Supervisors", description: "CRUD for supervisor accounts" },
        { name: "Admin Providers", description: "CRUD for service providers (admin or supervisor JWT)" },
        { name: "Admin Bookings", description: "CRM booking detail and provider assignment" },
        { name: "Admin Customers", description: "List and view app customers" },
        { name: "Admin Notifications", description: "Push broadcasts to workers or customers" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  // UI (and the JSON/YAML spec it serves) is off in production unless ENABLE_SWAGGER=true —
  // the full route surface, including admin RBAC permission strings, isn't something to expose
  // publicly by default.
  if (config.enableSwagger) {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  app.addHook("onResponse", (request, reply, done) => {
    recordStaffActivity(request, reply);
    done();
  });

  // /health stays unversioned — it's an infra-level liveness check (load balancers/orchestrators
  // expect a stable path), not part of the versioned business API. Everything else is versioned
  // via a URI prefix, the simplest scheme to pin a client to and to read straight off a request
  // log — a future v2 gets its own src/routes/v2/ registered alongside this, not a replacement.
  await app.register(healthRoutes);
  await app.register(v1Routes, { prefix: "/v1" });

  return app;
}
