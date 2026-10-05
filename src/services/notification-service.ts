import { notificationRepository } from "../repositories/notification-repository";
import { notificationQueue } from "../queues/notification-queue";
import { userRepository } from "../repositories/user-repository";
import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { paginatedResult, paginationSkip } from "../lib/pagination";
import { renderNotification } from "../lib/notification-templates";
import { sendFcmPush } from "../lib/fcm";
import type { NotificationChannel, RecipientType } from "../generated/prisma/enums";

export interface EnqueueNotificationInput {
  recipientType: RecipientType;
  recipientId: string;
  channel: NotificationChannel;
  templateKey: string;
  payload?: Record<string, unknown>;
}

export interface NotifyInput {
  recipientType: Extract<RecipientType, "customer" | "provider">;
  recipientId: string;
  templateKey: string;
  payload?: Record<string, unknown>;
  /** Defaults to both in-app inbox + push. */
  channels?: Array<"in_app" | "push">;
}

function toDto(row: {
  id: string;
  templateKey: string;
  payload: unknown;
  status: string;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : undefined;
  const content = renderNotification(row.templateKey, payload);
  return {
    id: row.id,
    templateKey: row.templateKey,
    title: content.title,
    body: content.body,
    payload: payload ?? null,
    status: row.status,
    sentAt: row.sentAt,
    readAt: row.readAt,
    createdAt: row.createdAt,
    unread: row.status !== "read",
  };
}

async function resolveFcmToken(
  recipientType: RecipientType,
  recipientId: string,
): Promise<string | null> {
  if (recipientType === "customer") {
    const user = await userRepository.findById(recipientId);
    return user?.fcmToken ?? null;
  }
  if (recipientType === "provider") {
    const provider = await serviceProviderRepository.findById(recipientId);
    return provider?.fcmToken ?? null;
  }
  return null;
}

export const notificationService = {
  // Fire-and-forget, called *after* the triggering DB transaction has committed (per the LLD's
  // "non-blocking" note on the booking-creation handler) — a failure here must never roll back
  // or delay the business action it's reporting on. Errors are logged, not thrown.
  enqueue(input: EnqueueNotificationInput): void {
    notificationRepository
      .create(input)
      .then((notification) =>
        notificationQueue.add("dispatch", { ...input, notificationId: notification.id }),
      )
      .catch((err) => console.error("[notification-service] failed to enqueue notification", err));
  },

  /** Create in-app + push notifications for a customer or provider. */
  notify(input: NotifyInput): void {
    const channels = input.channels ?? (["in_app", "push"] as const);
    for (const channel of channels) {
      this.enqueue({
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        channel,
        templateKey: input.templateKey,
        payload: input.payload,
      });
    }
  },

  notifyProvider(
    providerId: string,
    templateKey: string,
    payload?: Record<string, unknown>,
  ): void {
    this.notify({
      recipientType: "provider",
      recipientId: providerId,
      templateKey,
      payload,
    });
  },

  async dispatch(job: {
    notificationId: string;
    recipientType: RecipientType;
    recipientId: string;
    channel: NotificationChannel;
    templateKey: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const row = await notificationRepository.findById(job.notificationId);
    if (!row) return;
    if (row.status === "sent" || row.status === "read") return;

    if (job.channel === "in_app" || job.channel === "email" || job.channel === "sms") {
      // Inbox row is already persisted; mark delivered. SMS/email channels are stubs for now.
      await notificationRepository.markSent(job.notificationId);
      return;
    }

    if (job.channel === "push") {
      const token = await resolveFcmToken(job.recipientType, job.recipientId);
      if (!token) {
        console.warn(
          `[notification] skip push: no fcmToken for ${job.recipientType} ${job.recipientId} (${job.templateKey})`,
        );
        await notificationRepository.markFailed(job.notificationId);
        return;
      }

      const result = await sendFcmPush({
        token,
        templateKey: job.templateKey,
        payload: job.payload,
      });

      if (!result.ok) {
        console.error("[notification] FCM push failed", result.error);
        await notificationRepository.markFailed(job.notificationId);
        return;
      }
      if (result.skipped) {
        console.warn(`[notification] FCM push skipped (service account not loaded) ${job.templateKey}`);
        await notificationRepository.markFailed(job.notificationId);
        return;
      }

      console.log(`[notification] FCM push sent ${job.templateKey} → ${job.recipientType} ${job.recipientId}`);
      await notificationRepository.markSent(job.notificationId);
    }
  },

  async listForActor(
    auth: { type: "customer" | "provider"; id: string },
    query: { page: number; limit: number; unreadOnly?: boolean },
  ) {
    const [rows, total] = await notificationRepository.listForRecipient(
      auth.type,
      auth.id,
      paginationSkip(query),
      { unreadOnly: query.unreadOnly },
    );
    return paginatedResult(rows.map(toDto), total, query);
  },

  async unreadCount(auth: { type: "customer" | "provider"; id: string }) {
    const count = await notificationRepository.countUnread(auth.type, auth.id);
    return { count };
  },

  async markRead(auth: { type: "customer" | "provider"; id: string }, notificationId: string) {
    const result = await notificationRepository.markRead(notificationId, auth.type, auth.id);
    if (result.count === 0) throw new Error("NOTIFICATION_NOT_FOUND");
    return { ok: true as const };
  },

  async markAllRead(auth: { type: "customer" | "provider"; id: string }) {
    await notificationRepository.markAllRead(auth.type, auth.id);
    return { ok: true as const };
  },
};
