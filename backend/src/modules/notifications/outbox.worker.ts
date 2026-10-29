import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { getEmailProvider, EmailProvider } from "./email.provider.js";
import { renderGiftCouponEmail } from "./email.templates.js";
import { NotificationStatus } from "@prisma/client";

export interface OutboxProcessingResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export class EmailOutboxWorker {
  private provider: EmailProvider;

  constructor(provider?: EmailProvider) {
    this.provider = provider ?? getEmailProvider();
  }

  /**
   * Sets custom provider (useful for testing failure scenarios).
   */
  setProvider(provider: EmailProvider) {
    this.provider = provider;
  }

  /**
   * Processes pending email notifications in the outbox (§20, §21.2).
   * Robust error isolation: an error delivering one email does NOT affect other recipients in the batch.
   */
  async processOutbox(batchSize = 25): Promise<OutboxProcessingResult> {
    const now = new Date();

    const pendingNotifications = await prisma.notification.findMany({
      where: {
        channel: "EMAIL",
        status: NotificationStatus.PENDING,
        nextAttemptAt: { lte: now },
      },
      take: batchSize,
      orderBy: { createdAt: "asc" },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            messId: true,
          },
        },
      },
    });

    let succeeded = 0;
    let failed = 0;

    for (const notification of pendingNotifications) {
      try {
        const payload = (notification.payload || {}) as Record<string, unknown>;

        if (notification.template === "GIFT_COUPON_EMAIL") {
          const shortCode = String(payload.shortCode || "");
          const rawToken = String(payload.rawToken || "");
          const mealDate = String(payload.mealDate || "");
          const occasionMessage = payload.message ? String(payload.message) : null;
          const batchId = payload.batchId ? String(payload.batchId) : undefined;

          // Render responsive HTML and text
          const { subject, html, text } = renderGiftCouponEmail({
            studentName: notification.student.name,
            mealDate,
            shortCode,
            rawToken,
            occasionMessage,
          });

          // Deliver via email provider
          const result = await this.provider.send({
            to: notification.student.email,
            subject,
            html,
            text,
            idempotencyKey: notification.id,
            tags: {
              notificationId: notification.id,
              ...(batchId ? { batchId } : {}),
            },
          });

          // Transition Notification PENDING -> SENT (§20)
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: NotificationStatus.SENT,
              providerMessageId: result.providerMessageId,
              attempts: { increment: 1 },
              error: null,
            },
          });

          // Sync GiftItem email status
          if (batchId) {
            await prisma.giftItem.updateMany({
              where: {
                batchId,
                studentId: notification.studentId,
              },
              data: {
                emailStatus: NotificationStatus.SENT,
              },
            });
          }

          succeeded++;
        } else {
          // Unknown template fallback: mark failed
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: NotificationStatus.FAILED,
              error: `Unsupported email template '${notification.template}'`,
            },
          });
          failed++;
        }
      } catch (err) {
        failed++;
        const errorMessage = err instanceof Error ? err.message : "Unknown transmission failure";
        const nextAttempts = notification.attempts + 1;
        const payload = (notification.payload || {}) as Record<string, unknown>;
        const batchId = payload.batchId ? String(payload.batchId) : undefined;

        logger.error(
          {
            err,
            notificationId: notification.id,
            studentId: notification.studentId,
            attempts: nextAttempts,
          },
          "Failed to process outbox email notification",
        );

        if (nextAttempts >= 3) {
          // Exceeded max retries -> FAILED
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: NotificationStatus.FAILED,
              attempts: nextAttempts,
              error: errorMessage,
            },
          });

          if (batchId) {
            await prisma.giftItem.updateMany({
              where: {
                batchId,
                studentId: notification.studentId,
              },
              data: {
                emailStatus: NotificationStatus.FAILED,
              },
            });
          }
        } else {
          // Exponential backoff: 2^attempts * 60 seconds
          const backoffMinutes = Math.pow(2, nextAttempts);
          const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              attempts: nextAttempts,
              nextAttemptAt,
              error: errorMessage,
            },
          });
        }
      }
    }

    return {
      processed: pendingNotifications.length,
      succeeded,
      failed,
    };
  }
}

export const emailOutboxWorker = new EmailOutboxWorker();
