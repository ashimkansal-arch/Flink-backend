import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

// bcryptjs (pure JS), not bcrypt (native/node-gyp) — the Dockerfile's node:22-alpine stages have
// no python3/make/g++, and bcrypt's native compile step would break the build. bcryptjs is a
// drop-in replacement with no native dependency.
const COST_FACTOR = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}
