import { userRepository } from "../repositories/user-repository";
import { otpRepository } from "../repositories/otp-repository";
import {
  generateOtpCode,
  getStaticOtpCode,
  hashOtpCode,
  verifyOtpCode,
  otpExpiresAt,
  isStaticOtpEnabled,
} from "../lib/auth/otp";
import { resendOtp, sendOtp } from "../lib/auth/otp-sender";
import { isMsg91Enabled, msg91VerifyOtp } from "../lib/auth/msg91-otp";
import { issueTokenPair, rotateTokenPair, type TokenPair } from "../lib/auth/issue-tokens";
import { refreshTokenStore } from "../lib/auth/refresh-token-store";
import { assertCustomerStatus } from "../lib/auth/actor-status";
import { OtpPurpose } from "../generated/prisma/enums";
import { generateReferralCode } from "../lib/referral-code";

function useLocalOtp(): boolean {
  // Static OTP wins while MSG91 DLT/template approval is pending.
  return isStaticOtpEnabled() || !isMsg91Enabled();
}

async function assertLocalOtp(phoneNumber: string, code: string): Promise<void> {
  const staticCode = getStaticOtpCode();
  // Allow verify with the fixed code without a prior /otp/send (FE/dev convenience).
  if (staticCode && code === staticCode) {
    const existing =
      (await otpRepository.findLatestActive(phoneNumber, OtpPurpose.login)) ??
      (await otpRepository.findLatestActive(phoneNumber, OtpPurpose.signup));
    if (existing) await otpRepository.markUsed(existing.id);
    return;
  }

  const otp =
    (await otpRepository.findLatestActive(phoneNumber, OtpPurpose.login)) ??
    (await otpRepository.findLatestActive(phoneNumber, OtpPurpose.signup));
  if (!otp) throw new Error("OTP_EXPIRED_OR_NOT_FOUND");
  if (!verifyOtpCode(code, otp.otpCodeHash)) {
    await otpRepository.incrementAttempt(otp.id);
    throw new Error("OTP_INVALID");
  }
  await otpRepository.markUsed(otp.id);
}

export const customerAuthService = {
  async sendOtp(phoneNumber: string, purpose: "login" | "signup" = "login"): Promise<void> {
    if (!useLocalOtp()) {
      await sendOtp(phoneNumber);
      return;
    }

    const code = generateOtpCode();
    await otpRepository.create({
      phoneNumber,
      otpCodeHash: hashOtpCode(code),
      purpose: purpose === "signup" ? OtpPurpose.signup : OtpPurpose.login,
      expiresAt: otpExpiresAt(),
    });
    await sendOtp(phoneNumber, code);
  },

  async resendOtp(phoneNumber: string): Promise<void> {
    if (!useLocalOtp()) {
      await resendOtp(phoneNumber);
      return;
    }

    const existing =
      (await otpRepository.findLatestActive(phoneNumber, OtpPurpose.login)) ??
      (await otpRepository.findLatestActive(phoneNumber, OtpPurpose.signup));
    if (!existing) throw new Error("OTP_EXPIRED_OR_NOT_FOUND");
    await this.sendOtp(phoneNumber, existing.purpose === OtpPurpose.signup ? "signup" : "login");
  },

  // Find-or-create on verify: the client doesn't need to know in advance whether a phone number
  // is new or returning, matching resolveCustomerState()'s "single flow" pattern.
  async verifyOtpAndLogin(phoneNumber: string, code: string, referredByCode?: string): Promise<TokenPair> {
    if (!useLocalOtp()) {
      await msg91VerifyOtp(phoneNumber, code);
    } else {
      await assertLocalOtp(phoneNumber, code);
    }

    let user = await userRepository.findByPhone(phoneNumber);
    if (!user) {
      const referralCode = await generateReferralCode("customer");
      user = await userRepository.create({ phoneNumber, referralCode, referredByCode });
    } else {
      assertCustomerStatus(user.status);
    }

    return issueTokenPair("customer", user.id, { sub: user.id, type: "customer", phone: user.phoneNumber });
  },

  async refresh(refreshToken: string): Promise<TokenPair> {
    return rotateTokenPair("customer", refreshToken, async (userId) => {
      const user = await userRepository.findById(userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      assertCustomerStatus(user.status);
      return { sub: user.id, type: "customer", phone: user.phoneNumber };
    });
  },

  async logout(userId: string): Promise<void> {
    await refreshTokenStore.revoke("customer", userId);
  },

  async deleteAccount(userId: string): Promise<void> {
    // requireAuth already verified the user exists and is not deleted.
    await userRepository.softDelete(userId);
    await refreshTokenStore.revoke("customer", userId);
  },
};
