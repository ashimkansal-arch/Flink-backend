import { loadConfig } from "../config";

// Runs as its own process, separate from the API server — see REDIS.md / package.json "worker"
// script. Keeping queue processing out of the request-serving process means a slow/stuck job
// can't starve the HTTP server's event loop.
async function main() {
  await loadConfig().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

  const { Worker } = await import("bullmq");
  const { queueRedis } = await import("../lib/redis-queue-client");
  const { startNotificationWorker } = await import("./notification-worker");

  const orderWorker = new Worker(
    "order-notification",
    async (job) => {
      console.log(`Processing job ${job.id} (${job.name})`, job.data);
    },
    { connection: queueRedis },
  );

  const { logFcmStatus } = await import("../lib/fcm");
  logFcmStatus();

  const notificationWorker = startNotificationWorker();

  orderWorker.on("completed", (job) => console.log(`Job ${job.id} completed`));
  orderWorker.on("failed", (job, err) => console.error(`Job ${job?.id} failed:`, err));

  console.log("[worker] listening for order-notification + notification queues");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await Promise.all([orderWorker.close(), notificationWorker.close()]);
      process.exit(0);
    });
  }
}

main();
