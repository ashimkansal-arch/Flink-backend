import "dotenv/config";
import { environmentDefaults, type Environment } from "./environments";
import { envSchema, type Env } from "./env-schema";
import { loadSecretsIntoProcessEnv } from "./secrets-loader";

/** Local frontends (Next.js, admin UI, etc.) — always permitted in staging. */
const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3001", "http://13.126.199.221:3000", "http://13.126.199.221:3001"] as const;

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(",").map(normalizeOrigin).filter(Boolean))];
}

function buildCorsOrigin(env: Env): boolean | string[] {
  if (env.NODE_ENV === "local" || env.NODE_ENV === "test") return true;

  const configured = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (env.NODE_ENV === "staging") {
    return [...new Set([...LOCAL_DEV_ORIGINS, ...configured])];
  }
  return configured;
}

function buildConfig(env: Env) {
  const defaults = environmentDefaults[env.NODE_ENV as Environment];

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    enableSwagger: env.ENABLE_SWAGGER || env.NODE_ENV !== "production",
    port: env.PORT,
    logLevel: defaults.logLevel,
    rateLimit: defaults.rateLimit,
    corsOrigin: buildCorsOrigin(env),
    database: {
      url: env.DATABASE_URL,
      readUrl: env.DATABASE_READ_URL ?? env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    redis: { cacheUrl: env.REDIS_CACHE_URL, queueUrl: env.REDIS_QUEUE_URL },
    jwt: { accessSecret: env.JWT_ACCESS_SECRET, refreshSecret: env.JWT_REFRESH_SECRET },
    otpPepper: env.OTP_PEPPER,
    otpStaticCode: env.OTP_STATIC_CODE ?? null,
    msg91: {
      enabled: Boolean(env.MSG91_AUTHKEY && env.MSG91_OTP_TEMPLATE_ID) && !env.OTP_STATIC_CODE,
      authkey: env.MSG91_AUTHKEY ?? "",
      templateId: env.MSG91_OTP_TEMPLATE_ID ?? "",
      countryCode: env.MSG91_OTP_COUNTRY_CODE,
    },
    stripe: { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET },
    googleApiKey: env.GOOGLE_API_KEY?.trim() || null,
    aws: {
      region: env.AWS_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
      s3Bucket: env.AWS_S3_BUCKET,
    },
  };
}

export type AppConfig = ReturnType<typeof buildConfig>;

export async function loadConfig(): Promise<AppConfig> {
  await loadSecretsIntoProcessEnv();

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return buildConfig(result.data);
}
