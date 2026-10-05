import { loadConfig } from "./config";

async function main() {
  const config = await loadConfig().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

  // Import after config validation so any module that reads process.env at import time
  // (e.g. the Prisma client) sees a fully populated environment, including secrets pulled
  // from a secrets manager.
  const { buildApp } = await import("./app");
  const app = await buildApp(config);

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
