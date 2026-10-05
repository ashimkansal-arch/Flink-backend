import { db, readDb } from "../lib/prisma";
import { OtpPurpose } from "../generated/prisma/enums";
import { OTP_MAX_ATTEMPTS } from "../lib/auth/otp";

// Internal to the auth services — not route-facing, OTPs aren't a public resource.
export const otpRepository = {
  create(data: { phoneNumber: string; otpCodeHash: string; purpose: OtpPurpose; expiresAt: Date }) {
    return db.otpVerification.create({ data });
  },

  findLatestActive(phoneNumber: string, purpose: OtpPurpose) {
    return readDb.otpVerification.findFirst({
      where: {
        phoneNumber,
        purpose,
        isUsed: false,
        expiresAt: { gt: new Date() },
        attemptCount: { lt: OTP_MAX_ATTEMPTS },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  markUsed(id: string) {
    return db.otpVerification.update({ where: { id }, data: { isUsed: true } });
  },

  incrementAttempt(id: string) {
    return db.otpVerification.update({ where: { id }, data: { attemptCount: { increment: 1 } } });
  },
};
