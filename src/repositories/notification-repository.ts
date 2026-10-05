import { Prisma } from "../generated/prisma/client";
import { db, readDb } from "../lib/prisma";
import { NotificationChannel, NotificationStatus, RecipientType } from "../generated/prisma/enums";

export const notificationRepository = {
  create(data: {
    recipientType: RecipientType;
    recipientId: string;
    channel: NotificationChannel;
    templateKey: string;
    payload?: Record<string, unknown>;
  }) {
    return db.notification.create({
      data: {
        recipientType: data.recipientType,
        recipientId: data.recipientId,
        channel: data.channel,
        templateKey: data.templateKey,
        payload: data.payload as Prisma.InputJsonValue | undefined,
      },
    });
  },

  findById(id: string) {
    return readDb.notification.findUnique({ where: { id } });
  },

  listForRecipient(
    recipientType: RecipientType,
    recipientId: string,
    page: { skip: number; take: number },
    opts?: { unreadOnly?: boolean },
  ) {
    const where: Prisma.NotificationWhereInput = {
      recipientType,
      recipientId,
      channel: "in_app",
      ...(opts?.unreadOnly ? { status: { not: "read" } } : {}),
    };

    return Promise.all([
      readDb.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
      }),
      readDb.notification.count({ where }),
    ]);
  },

  countUnread(recipientType: RecipientType, recipientId: string) {
    return readDb.notification.count({
      where: {
        recipientType,
        recipientId,
        channel: "in_app",
        status: { not: "read" },
      },
    });
  },

  markSent(id: string) {
    return db.notification.update({
      where: { id },
      data: { status: "sent", sentAt: new Date() },
    });
  },

  markFailed(id: string) {
    return db.notification.update({
      where: { id },
      data: { status: "failed" },
    });
  },

  markRead(id: string, recipientType: RecipientType, recipientId: string) {
    return db.notification.updateMany({
      where: { id, recipientType, recipientId, channel: "in_app" },
      data: { status: "read", readAt: new Date() },
    });
  },

  markAllRead(recipientType: RecipientType, recipientId: string) {
    return db.notification.updateMany({
      where: {
        recipientType,
        recipientId,
        channel: "in_app",
        status: { not: "read" },
      },
      data: { status: "read" as NotificationStatus, readAt: new Date() },
    });
  },
};
