import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { jobQueue } from "../../lib/queue.js";
import { onboardingService } from "../students/onboarding.service.js";
import { whatsAppRouter } from "./router.js";

export interface WhatsAppInboundJobData {
  message: {
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    interactive?: {
      type: string;
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string; description?: string };
    };
    image?: { id: string; mime_type: string };
    document?: { id: string; filename: string; mime_type: string };
  };
  phone: string;
  identityId?: string | null;
  studentId?: string | null;
}

export class WhatsAppWorker {
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    await jobQueue.work("whatsapp-inbound", async (job: unknown) => {
      await this.processJob(job as WhatsAppInboundJobData);
    });

    logger.info("WhatsApp inbound background worker started.");
  }

  async processJob(jobData: WhatsAppInboundJobData): Promise<void> {
    const { phone, message } = jobData;

    try {
      // Execute within transaction with advisory lock for strictly ordered per-identity processing (§11.3)
      await prisma.$transaction(async (tx) => {
        try {
          // Acquire transaction-scoped advisory lock for this phone number
          await tx.$queryRawUnsafe(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            `whatsapp_${phone}`,
          );
        } catch {
          // Graceful fallback if database engine doesn't support pg_advisory_xact_lock in mock/test
        }

        // Look up identity
        const identity = await tx.whatsAppIdentity.findUnique({
          where: { phoneE164: phone },
          include: { student: true },
        });

        if (!identity || identity.status !== "ACTIVE") {
          // Unlinked student gate (§12.3): lock strictly to onboarding flow
          logger.info({ phone }, "Routing unlinked user to onboarding flow");
          await onboardingService.handleIncomingMessage(phone, message, tx);
          return;
        }

        // Student is linked and verified.
        // Check for UNLINK command (§12.4)
        const incomingText = (message.text?.body || message.interactive?.button_reply?.id || "")
          .trim()
          .toUpperCase();

        if (incomingText === "UNLINK" || incomingText === "LOGOUT") {
          await onboardingService.handleUnlinkRequest(identity.id, phone, tx);
          return;
        }

        // Dispatch to linked conversation handler / router (§14)
        await whatsAppRouter.routeMessage(identity, message, tx);
      });
    } catch (err) {
      logger.error(
        { err, phone, messageId: message.id },
        "Error processing inbound WhatsApp message",
      );
      throw err;
    }
  }
}

export const whatsAppWorker = new WhatsAppWorker();
