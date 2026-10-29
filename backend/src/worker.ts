import { queue } from "./lib/queue.js";
import { logger } from "./config/logger.js";
import { whatsAppWorker } from "./modules/whatsapp/whatsapp.worker.js";

async function startWorker(): Promise<void> {
  logger.info("Initializing Campus Mess background worker process...");

  await queue.start();
  await whatsAppWorker.start();

  // Register worker job handlers
  await queue.work("notifications:email", async (data: unknown) => {
    logger.info({ data }, "Processing background email outbox job");
  });

  await queue.work("notifications:whatsapp", async (data: unknown) => {
    logger.info({ data }, "Processing background WhatsApp notification job");
  });

  logger.info("Campus Mess background workers ready and listening for jobs.");
}

async function shutdownWorker(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Shutting down worker gracefully...`);
  try {
    await queue.stop();
    logger.info("Worker queue stopped successfully.");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Error stopping worker queue");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdownWorker("SIGTERM"));
process.on("SIGINT", () => shutdownWorker("SIGINT"));

startWorker().catch((err) => {
  logger.error({ err }, "Fatal worker startup failure");
  process.exit(1);
});
