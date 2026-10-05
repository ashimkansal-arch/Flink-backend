import { Worker } from "bullmq";
import { queueRedis } from "../lib/redis-queue-client";
import { notificationService } from "../services/notification-service";
import type { NotificationJobData } from "./notification-queue";

export function startNotificationWorker() {
  const worker = new Worker<NotificationJobData>(
    "notification",
    async (job) => {
      await notificationService.dispatch(job.data);
    },
    { connection: queueRedis },
  );

  worker.on("completed", (job) => console.log(`[notification] job ${job.id} completed`));
  worker.on("failed", (job, err) =>
    console.error(`[notification] job ${job?.id} failed:`, err),
  );

  return worker;
}
