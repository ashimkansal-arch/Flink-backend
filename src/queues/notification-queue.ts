import { Queue } from "bullmq";
import { queueRedis } from "../lib/redis-queue-client";
import { NotificationChannel, RecipientType } from "../generated/prisma/enums";

export interface NotificationJobData {
  notificationId: string;
  recipientType: RecipientType;
  recipientId: string;
  channel: NotificationChannel;
  templateKey: string;
  payload?: Record<string, unknown>;
}

export const notificationQueue = new Queue<NotificationJobData>("notification", { connection: queueRedis });
