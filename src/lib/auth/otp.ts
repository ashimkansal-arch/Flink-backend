import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// HMAC-SHA256, not bcrypt — a 4-digit OTP is low-entropy, single-use, and short-TTL, and this
// path is high-frequency (every login). Bcrypt's deliberate slowness buys nothing here.
const MAX_ATTEMPTS = 5;
const OTP_TTL_SECONDS = 5 * 60;
/** Used while MSG91 DLT/template approval is pending. */
const FALLBACK_STATIC_OTP = "123456";

function pepper(): string {
  return process.env.OTP_PEPPER as string;
}

function isMsg91Configured(): boolean {
  return Boolean(process.env.MSG91_AUTHKEY?.trim() && process.env.MSG91_OTP_TEMPLATE_ID?.trim());
}

/**
 * Fixed OTP for customer login while MSG91 is unavailable.
 * - Explicit `OTP_STATIC_CODE` always wins.
 * - Otherwise defaults to `123456` when MSG91 is not fully configured.
 */
export function getStaticOtpCode(): string | null {
  const configured = process.env.OTP_STATIC_CODE?.trim();
  if (configured) return configured;
  if (!isMsg91Configured()) return FALLBACK_STATIC_OTP;
  return null;
}

export function isStaticOtpEnabled(): boolean {
  return getStaticOtpCode() !== null;
}

export function generateOtpCode(): string {
  const staticCode = getStaticOtpCode();
  if (staticCode) return staticCode;
  return String(randomInt(0, 10000)).padStart(4, "0");
}

export function hashOtpCode(code: string): string {
  return createHmac("sha256", pepper()).update(code).digest("hex");
}

export function verifyOtpCode(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashOtpCode(code));
  const expected = Buffer.from(hash);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function otpExpiresAt(): Date {
  return new Date(Date.now() + OTP_TTL_SECONDS * 1000);
}

export { MAX_ATTEMPTS as OTP_MAX_ATTEMPTS };
