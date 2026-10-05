/** Template keys used across booking, provider ops, and wallet flows. */
export type NotificationTemplateKey =
  | "booking.created"
  | "booking.payment_confirmed"
  | "booking.provider_assigned"
  | "booking.provider_reassigned"
  | "booking.new_job"
  | "booking.job_removed"
  | "booking.cancelled"
  | "booking.provider_nearby"
  | "booking.session_updated"
  | "wallet.topup_confirmed"
  | "provider.offline"
  | "provider.offline_request.approved"
  | "provider.offline_request.rejected"
  | "provider.kyc.approved"
  | "provider.kyc.rejected"
  | "admin.broadcast";

export const SESSION_PUSH_TEMPLATE_KEY = "booking.session_updated" satisfies NotificationTemplateKey;

export type NotificationContent = {
  title: string;
  body: string;
};

const DOC_LABELS: Record<string, string> = {
  id_proof: "ID proof",
  address_proof: "Address proof",
};

function docLabel(documentType: unknown): string {
  if (typeof documentType !== "string") return "KYC document";
  return DOC_LABELS[documentType] ?? documentType.replace(/_/g, " ");
}

export function renderNotification(
  templateKey: string,
  payload?: Record<string, unknown> | null,
): NotificationContent {
  const p = payload ?? {};

  switch (templateKey as NotificationTemplateKey) {
    case "booking.created":
      return {
        title: "Booking confirmed",
        body:
          p.paid === true
            ? "Your booking is confirmed."
            : "Your booking has been created. Complete payment to confirm.",
      };
    case "booking.payment_confirmed":
      return {
        title: "Payment confirmed",
        body: "Your booking payment was successful.",
      };
    case "booking.provider_assigned":
    case "booking.provider_reassigned": {
      const name =
        typeof p.providerName === "string" && p.providerName.trim()
          ? p.providerName.trim()
          : null;
      const reassigned =
        templateKey === "booking.provider_reassigned" || p.reassigned === true;
      return {
        title: reassigned ? "Worker updated" : "Worker assigned",
        body: reassigned
          ? name
            ? `Your booking was reassigned to ${name}.`
            : "Your booking was reassigned to another provider."
          : name
            ? `${name} has been assigned to your booking.`
            : "A worker has been assigned to your booking.",
      };
    }
    case "booking.new_job":
      return {
        title: "New job assigned",
        body:
          typeof p.categoryName === "string" && p.categoryName.trim()
            ? `You have a new ${p.categoryName.trim()} booking.`
            : "You have a new booking assigned to you.",
      };
    case "booking.cancelled": {
      const reason = typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : null;
      return {
        title: "Booking cancelled",
        body: reason ? `Your booking was cancelled. ${reason}` : "Your booking was cancelled.",
      };
    }
    case "booking.job_removed": {
      const what =
        typeof p.categoryName === "string" && p.categoryName.trim()
          ? `${p.categoryName.trim()} booking`
          : "booking";
      const when = typeof p.whenText === "string" && p.whenText.trim() ? ` for ${p.whenText.trim()}` : "";
      if (p.reason !== "cancelled") {
        return {
          title: "Job reassigned",
          body: `The ${what}${when} has been moved to another professional. You don't need to go.`,
        };
      }
      return {
        title: "Job cancelled",
        body:
          p.cancelledBy === "admin"
            ? `The ${what}${when} was cancelled by the team. You don't need to go.`
            : `The customer cancelled the ${what}${when}. You don't need to go.`,
      };
    }
    case "booking.provider_nearby":
      return {
        title: "Worker is nearby",
        body: "Your worker is arriving at your location.",
      };
    case "booking.session_updated":
      if (p.event === "checklist_updated") {
        return {
          title: "Checklist updated",
          body: "Your worker updated a session task. Open the job to refresh.",
        };
      }
      if (p.event === "session_ended_early") {
        return {
          title: "Session ended early",
          body: "The customer ended the session early. Open the job to wrap up.",
        };
      }
      if (p.event === "job_completed") {
        return p.endedBy === "customer"
          ? {
              title: "Job completed",
              body: "The customer marked the job complete. Open the job to wrap up.",
            }
          : {
              title: "Job completed",
              body: "Your worker has completed the job. Open the booking to review.",
            };
      }
      return {
        title: "Job started",
        body: "Your worker verified the OTP and started the session. Open the job to follow the timer and tasks.",
      };
    case "wallet.topup_confirmed":
      return {
        title: "Wallet topped up",
        body: "Your wallet balance has been updated.",
      };
    case "provider.offline":
      return {
        title: "You are offline",
        body: "Your availability is set to offline. You will not receive new jobs.",
      };
    case "provider.offline_request.approved":
      return {
        title: "Offline request approved",
        body: "Your request was approved. You are now offline.",
      };
    case "provider.offline_request.rejected":
      return {
        title: "Offline request rejected",
        body:
          typeof p.rejectionReason === "string" && p.rejectionReason.trim()
            ? p.rejectionReason.trim()
            : "Your offline request was rejected.",
      };
    case "provider.kyc.approved":
      return {
        title: "KYC approved",
        body: `Your ${docLabel(p.documentType)} was approved.`,
      };
    case "provider.kyc.rejected":
      return {
        title: "KYC rejected",
        body:
          typeof p.rejectionReason === "string" && p.rejectionReason.trim()
            ? `${docLabel(p.documentType)} rejected: ${p.rejectionReason.trim()}`
            : `Your ${docLabel(p.documentType)} was rejected.`,
      };
    case "admin.broadcast":
      return {
        title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : "Announcement",
        body: typeof p.body === "string" && p.body.trim() ? p.body.trim() : "You have a new update.",
      };
    default:
      return {
        title: "Notification",
        body: "You have a new update.",
      };
  }
}
