type Mail = { to: string; subject: string; text: string };

export async function sendMail(mail: Mail): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[mailer] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }

  // SMTP is optional — when host is set, send via nodemailer-compatible env without a hard
  // runtime dependency on a specific provider. Dynamic import keeps local/test light.
  const nodemailer = (await import("nodemailer").catch(() => null)) as {
    createTransport: (opts: unknown) => { sendMail: (opts: unknown) => Promise<unknown> };
  } | null;
  if (!nodemailer) {
    console.log(`[mailer] SMTP_HOST set but nodemailer is not installed; logging instead\n${mail.text}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "noreply@flink.local",
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: htmlFromText(mail.text),
  });
}

type CredentialMail = {
  to: string;
  fullName: string;
  temporaryPassword: string;
  roleLabel: string;
};

function crmPublicUrl(): string {
  return (process.env.CRM_PUBLIC_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
}

function loginUrl(): string {
  return `${crmPublicUrl()}/login`;
}

function passwordResetUrl(): string {
  return `${crmPublicUrl()}/forgot-password`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlFromText(text: string): string {
  const withLinks = escapeHtml(text).replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1">$1</a>',
  );
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111;white-space:pre-wrap;">${withLinks}</div>`;
}

function credentialEmailText(input: CredentialMail & { kind: "welcome" | "reset" }): string {
  const intro =
    input.kind === "welcome"
      ? "Your Flink CRM account has been created successfully."
      : "An administrator has reset your Flink CRM password.";
  const when = input.kind === "welcome" ? "first login" : "next login";
  const unexpected =
    input.kind === "welcome"
      ? "If you did not expect this account or believe this email was sent to you by mistake, please contact your administrator."
      : "If you did not request this password reset or believe this email was sent to you by mistake, please contact your administrator.";

  return [
    `Hi ${input.fullName},`,
    "",
    intro,
    "",
    "Account Details",
    `Email: ${input.to}`,
    `Role: ${input.roleLabel}`,
    `Temporary Password: ${input.temporaryPassword}`,
    "",
    "How to Log In",
    "",
    `Visit the Flink CRM login page: ${loginUrl()}`,
    "",
    "Enter your email address and temporary password.",
    "",
    "Click Sign In.",
    "",
    `You will be prompted to create a new password on your ${when}.`,
    "",
    "Forgot Your Password?",
    `Reset your password using the password reset link: ${passwordResetUrl()}`,
    "",
    "⚠️ Security Notice",
    `This email contains temporary login credentials. Please do not share your password or login details with anyone. For your security, change the temporary password immediately after your ${when}.`,
    "",
    unexpected,
    "",
    "Regards,",
    "Flink CRM Team",
  ].join("\n");
}

async function sendCredentialEmail(
  input: CredentialMail & { subject: string; kind: "welcome" | "reset" },
): Promise<void> {
  await sendMail({
    to: input.to,
    subject: input.subject,
    text: credentialEmailText(input),
  });
}

/** Welcome email for any CRM team member (admin, dispatcher, support, …). */
export async function sendTeamMemberWelcomeEmail(input: CredentialMail): Promise<void> {
  await sendCredentialEmail({
    ...input,
    subject: "Your Flink CRM account has been created",
    kind: "welcome",
  });
}

export async function sendTeamMemberPasswordResetEmail(input: CredentialMail): Promise<void> {
  await sendCredentialEmail({
    ...input,
    subject: "Your Flink CRM password was reset",
    kind: "reset",
  });
}

export async function sendProviderDeviceResetEmail(input: {
  to: string;
  fullName: string;
  previousDevice: { deviceId: string; deviceName: string } | null;
}): Promise<void> {
  const previousDevice = input.previousDevice
    ? `${input.previousDevice.deviceName} (${input.previousDevice.deviceId})`
    : "None registered";
  const text = [
    `Hi ${input.fullName},`,
    "",
    "An administrator has reset the device registered to your Flink Provider account.",
    "",
    "⚠️ IMPORTANT SECURITY NOTICE",
    "If you did not request or authorize this device reset, do not log in from a new device. Please contact your administrator immediately.",
    "",
    "For your security, never share your login credentials or verification codes with anyone.",
    "",
    "Device Details",
    `Previous Device: ${previousDevice}`,
    "",
    "You can now log in to your account from a new device.",
    "",
    "Regards,",
    "Flink Team",
  ].join("\n");

  await sendMail({
    to: input.to,
    subject: "Your Flink provider device was reset",
    text,
  });
}
