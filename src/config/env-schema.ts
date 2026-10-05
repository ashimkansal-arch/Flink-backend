import { z } from "zod";

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
    PORT: z.coerce.number().int().positive().default(3000),
    // Opt-in Swagger UI at /docs when NODE_ENV=production (always on for local/test/staging).
    ENABLE_SWAGGER: z.coerce.boolean().default(false),

    // How to obtain the secrets below at boot time.
    // "env"                -> read from process.env / .env (local dev, or a platform that
    //                         injects vars for you, e.g. `doppler run -- npm start`)
    // "aws-secrets-manager" -> fetch a JSON secret from AWS Secrets Manager and merge it into
    //                         process.env before validation runs.
    SECRETS_PROVIDER: z.enum(["env", "aws-secrets-manager"]).default("env"),
    AWS_SECRETS_MANAGER_SECRET_ID: z.string().optional(),

    DATABASE_URL: z.string().url(),
    // Optional read-replica connection string. Defaults to DATABASE_URL (i.e. reads and writes
    // hit the same instance) until a replica actually exists — see src/lib/prisma.ts.
    DATABASE_READ_URL: z.string().url().optional(),
    // Max connections this process opens to Postgres. Keep this * (instance count) comfortably
    // under the database's max_connections (Supabase's pooler, not the raw DB limit, absorbs
    // per-instance fan-out in staging/prod — see DATABASE.md).
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    // Two logically (and, in staging/prod, physically) separate Redis instances — see REDIS.md.
    // Pure cache: allkeys-lru, safe to evict under memory pressure.
    REDIS_CACHE_URL: z.string().url(),
    // Session, geo, and BullMQ queue data: noeviction, must never be evicted.
    REDIS_QUEUE_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),

    // HMAC key for hashing OTP codes (crypto.createHmac, not bcrypt — OTPs are low-entropy,
    // short-TTL, single-use, and high-frequency, so bcrypt's deliberate slowness buys nothing).
    OTP_PEPPER: z.string().min(32, "OTP_PEPPER must be at least 32 characters"),

    // Temporary fixed OTP (e.g. "123456") while MSG91 DLT/template approval is pending.
    // When set, customer send/verify use this code and skip MSG91 even if credentials exist.
    // Remove once MSG91 is live.
    OTP_STATIC_CODE: z
      .string()
      .regex(/^\d{4,8}$/, "OTP_STATIC_CODE must be 4–8 digits")
      .optional(),

    // MSG91 OTP (v5). When both authkey and template id are set, send/resend/verify go through
    // MSG91. Leave either blank in local/test to log OTPs and verify against the local hash.
    MSG91_AUTHKEY: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().optional(),
    MSG91_OTP_COUNTRY_CODE: z.string().regex(/^\d{1,4}$/).default("91"),

    // Path to the Firebase service-account JSON used by the worker for FCM HTTP v1.
    // When unset, push jobs are skipped and marked sent.
    FCM_SERVICE_ACCOUNT_PATH: z.string().optional(),

    // Restricted Google Maps / Places *client* key served to authenticated apps.
    // Lock this key in Google Cloud Console (Android package+SHA-1, iOS bundle id,
    // and/or HTTP referrers, plus API restriction to Maps/Places only). Never use a
    // server key here. Leave unset locally if maps are not needed.
    GOOGLE_API_KEY: z.string().optional(),

    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),

    AWS_REGION: z.string().default("us-east-1"),
    // Optional when the host uses an IAM instance/task role (default AWS credential chain).
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_S3_BUCKET: z.string().min(1),

    // Comma-separated list, required for staging/production (local/test allow any origin).
    ALLOWED_ORIGINS: z.string().optional(),
  })
  .refine((data) => data.SECRETS_PROVIDER !== "aws-secrets-manager" || !!data.AWS_SECRETS_MANAGER_SECRET_ID, {
    message: "AWS_SECRETS_MANAGER_SECRET_ID is required when SECRETS_PROVIDER=aws-secrets-manager",
    path: ["AWS_SECRETS_MANAGER_SECRET_ID"],
  })
  .refine((data) => (data.NODE_ENV !== "staging" && data.NODE_ENV !== "production") || !!data.ALLOWED_ORIGINS, {
    message: "ALLOWED_ORIGINS is required when NODE_ENV=staging or NODE_ENV=production",
    path: ["ALLOWED_ORIGINS"],
  });

export type Env = z.infer<typeof envSchema>;
