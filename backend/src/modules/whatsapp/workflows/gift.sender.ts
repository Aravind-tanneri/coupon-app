import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../config/logger.js";
import { whatsAppService } from "../whatsapp.service.js";
import { NotificationStatus } from "@prisma/client";

export interface ProcessWhatsAppOutboxResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export class GiftWhatsAppSender {
  /**
   * Processes pending WhatsApp notifications from the outbox (§22.1).
   * Uses template message format to reach students outside the 24-hour service window.
   * Includes 'View Coupon' action that directly loads the verified QR redemption image.
   */
  async processOutbox(batchSize = 25): Promise<ProcessWhatsAppOutboxResult> {
    const now = new Date();

    const pendingNotifications = await prisma.notification.findMany({
      where: {
        channel: "WHATSAPP",
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
            rollNo: true,
            email: true,
          },
        },
      },
    });

    let succeeded = 0;
    let failed = 0;

    for (const notification of pendingNotifications) {
      const payload = (notification.payload || {}) as Record<string, unknown>;
      const batchId = payload.batchId ? String(payload.batchId) : undefined;
      const shortCode = String(payload.shortCode || "");
      const mealDate = String(payload.mealDate || "");
      const occasionMessage = payload.message ? String(payload.message) : "Special Dinner Feast";

      try {
        // 1. Resolve student's linked WhatsApp phone number (§12)
        const identity = await prisma.whatsAppIdentity.findFirst({
          where: {
            studentId: notification.studentId,
            status: "ACTIVE",
          },
        });

        if (!identity) {
          // Student hasn't linked phone yet -> mark failed so it displays in admin dashboard (§22.3)
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: NotificationStatus.FAILED,
              attempts: { increment: 1 },
              error: "Student has not linked a WhatsApp account",
            },
          });

          if (batchId) {
            await prisma.giftItem.updateMany({
              where: {
                batchId,
                studentId: notification.studentId,
              },
              data: {
                whatsappStatus: NotificationStatus.FAILED,
              },
            });
          }

          failed++;
          continue;
        }

        // 2. Transmit WhatsApp Template Message (§22.1)
        let sendResult: { messageId: string };

        try {
          // Meta WhatsApp approved template payload
          sendResult = await whatsAppService.sendTemplate(
            identity.phoneE164,
            "gift_coupon_issued",
            "en",
            [
              {
                type: "body",
                parameters: [
                  { type: "text", text: notification.student.name },
                  { type: "text", text: occasionMessage },
                  { type: "text", text: mealDate },
                  { type: "text", text: shortCode },
                ],
              },
              {
                type: "button",
                sub_type: "quick_reply",
                index: 0,
                parameters: [{ type: "payload", payload: `SHOW_QR:${shortCode}` }],
              },
            ],
          );
        } catch (templateErr) {
          // Fallback to interactive buttons message in dev/sandbox if template is not registered
          logger.warn(
            { err: templateErr, phone: identity.phoneE164 },
            "Template transmission failed; falling back to interactive button message",
          );

          const fallbackText = [
            `🎁 *Complimentary Special Dinner Pass!*`,
            `Hello *${notification.student.name}*, you have received a complimentary pass for *${occasionMessage}*.`,
            `\n📅 *Meal Date:* ${mealDate}`,
            `🔑 *Counter Code:* \`${shortCode}\``,
            `\n_Tap below to retrieve your digital QR code pass._`,
          ].join("\n");

          sendResult = await whatsAppService
            .getProvider()
            .sendButtons(
              identity.phoneE164,
              fallbackText,
              [{ id: `SHOW_QR:${shortCode}`, title: `View Pass ${shortCode}` }],
              { header: "Special Feast Pass" },
            );
        }

        // 3. Mark SENT (§20, §22.1)
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.SENT,
            providerMessageId: sendResult.messageId,
            attempts: { increment: 1 },
            error: null,
          },
        });

        if (batchId) {
          await prisma.giftItem.updateMany({
            where: {
              batchId,
              studentId: notification.studentId,
            },
            data: {
              whatsappStatus: NotificationStatus.SENT,
            },
          });
        }

        succeeded++;
      } catch (err) {
        failed++;
        const errorMessage = err instanceof Error ? err.message : "WhatsApp transmission error";
        const nextAttempts = notification.attempts + 1;

        logger.error(
          {
            err,
            notificationId: notification.id,
            studentId: notification.studentId,
            attempts: nextAttempts,
          },
          "WhatsApp gift notification dispatch failed",
        );

        if (nextAttempts >= 3) {
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
                whatsappStatus: NotificationStatus.FAILED,
              },
            });
          }
        } else {
          // Exponential backoff: 2^attempts minutes
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

export const giftWhatsAppSender = new GiftWhatsAppSender();
