import { Queue } from "bullmq";
import { queueRedis } from "../lib/redis-queue-client";

export const orderNotificationQueue = new Queue("order-notification", { connection: queueRedis });

export function enqueueOrderConfirmation(orderId: string) {
  return orderNotificationQueue.add("order-confirmation", { orderId });
}
