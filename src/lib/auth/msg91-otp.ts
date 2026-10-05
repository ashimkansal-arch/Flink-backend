const MSG91_OTP_BASE = "https://control.msg91.com/api/v5/otp";
const OTP_LENGTH = 4;
const OTP_EXPIRY_MINUTES = 5;

type Msg91OtpConfig = {
  authkey: string;
  templateId: string;
  countryCode: string;
};

function msg91Config(): Msg91OtpConfig {
  return {
    authkey: process.env.MSG91_AUTHKEY ?? "",
    templateId: process.env.MSG91_OTP_TEMPLATE_ID ?? "",
    countryCode: process.env.MSG91_OTP_COUNTRY_CODE ?? "91",
  };
}

export function isMsg91Enabled(): boolean {
  const { authkey, templateId } = msg91Config();
  return Boolean(authkey && templateId);
}

export function toMsg91Mobile(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  const { countryCode } = msg91Config();
  if (digits.startsWith(countryCode) && digits.length > 10) return digits;
  return `${countryCode}${digits}`;
}

async function msg91Request(url: string, method: "GET" | "POST"): Promise<void> {
  const { authkey } = msg91Config();
  const response = await fetch(url, {
    method,
    headers: {
      authkey,
      accept: "application/json",
      "content-type": "application/json",
    },
  });

  let body: { type?: string; message?: string | string[] } = {};
  try {
    body = (await response.json()) as { type?: string; message?: string | string[] };
  } catch {
    throw new Error("OTP_DELIVERY_FAILED");
  }

  const message = Array.isArray(body.message) ? body.message.join(" ") : (body.message ?? "");
  const ok = response.ok && (body.type === "success" || /verified success/i.test(message));
  if (ok) return;

  if (/invalid otp|otp not match|already verified/i.test(message)) {
    throw new Error("OTP_INVALID");
  }
  if (/not found|expired|no otp/i.test(message)) {
    throw new Error("OTP_EXPIRED_OR_NOT_FOUND");
  }
  throw new Error("OTP_DELIVERY_FAILED");
}

export async function msg91SendOtp(phoneNumber: string): Promise<void> {
  const { templateId } = msg91Config();
  const mobile = toMsg91Mobile(phoneNumber);
  const url = new URL(MSG91_OTP_BASE);
  url.searchParams.set("template_id", templateId);
  url.searchParams.set("mobile", mobile);
  url.searchParams.set("otp_length", String(OTP_LENGTH));
  url.searchParams.set("otp_expiry", String(OTP_EXPIRY_MINUTES));
  await msg91Request(url.toString(), "POST");
}

export async function msg91ResendOtp(phoneNumber: string): Promise<void> {
  const mobile = toMsg91Mobile(phoneNumber);
  const url = new URL(`${MSG91_OTP_BASE}/retry`);
  url.searchParams.set("retrytype", "text");
  url.searchParams.set("mobile", mobile);
  await msg91Request(url.toString(), "GET");
}

export async function msg91VerifyOtp(phoneNumber: string, code: string): Promise<void> {
  const mobile = toMsg91Mobile(phoneNumber);
  const url = new URL(`${MSG91_OTP_BASE}/verify`);
  url.searchParams.set("mobile", mobile);
  url.searchParams.set("otp", code);
  await msg91Request(url.toString(), "GET");
}
