import { isStaticOtpEnabled } from "./otp";
import { isMsg91Enabled, msg91ResendOtp, msg91SendOtp } from "./msg91-otp";

export async function sendOtp(phoneNumber: string, code?: string): Promise<void> {
  if (isStaticOtpEnabled()) {
    console.log(
      `[otp-sender] static OTP for ${phoneNumber}: ${code ?? process.env.OTP_STATIC_CODE} (MSG91 bypassed)`,
    );
    return;
  }

  if (isMsg91Enabled()) {
    await msg91SendOtp(phoneNumber);
    return;
  }

  const env = process.env.NODE_ENV;
  if (env === "local" || env === "test" || env === undefined) {
    console.log(
      `[otp-sender] OTP for ${phoneNumber}: ${code ?? "(none)"} (logged, not sent — MSG91 not configured)`,
    );
    return;
  }

  throw new Error("OTP_DELIVERY_FAILED");
}

export async function resendOtp(phoneNumber: string, code?: string): Promise<void> {
  if (isStaticOtpEnabled()) {
    await sendOtp(phoneNumber, code);
    return;
  }

  if (isMsg91Enabled()) {
    await msg91ResendOtp(phoneNumber);
    return;
  }

  await sendOtp(phoneNumber, code);
}
