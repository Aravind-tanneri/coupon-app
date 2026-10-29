import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { auditService } from "../audit/audit.service.js";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";
import { NotificationStatus } from "@prisma/client";

export const notificationRouter = Router();

/**
 * Validates webhook cryptographic signatures from Resend/Svix (§20, §21.4).
 */
export function verifyEmailWebhookSignature(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret?: string,
): boolean {
  if (!secret) return true; // Allowed in dev/test when secret is omitted

  const signatureHeader = headers["svix-signature"] || headers["x-resend-signature"];
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return false;
  }

  const timestamp = headers["svix-timestamp"] || "";
  const svixId = headers["svix-id"] || "";

  // Anti-replay: timestamp tolerance 5 minutes
  if (timestamp) {
    const ts = parseInt(String(timestamp), 10);
    if (!isNaN(ts) && Math.abs(Date.now() / 1000 - ts) > 300) {
      return false;
    }
  }

  const payloadToSign =
    svixId && timestamp
      ? `${svixId}.${timestamp}.${rawBody}`
      : typeof rawBody === "string"
        ? rawBody
        : rawBody.toString("utf8");

  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key =
      Buffer.from(cleanSecret, "base64").length > 0 && cleanSecret.length % 4 === 0
        ? Buffer.from(cleanSecret, "base64")
        : Buffer.from(secret);
  } catch {
    key = Buffer.from(secret);
  }

  const hmac = crypto.createHmac("sha256", key).update(payloadToSign).digest();
  const computedBase64 = hmac.toString("base64");
  const computedHex = hmac.toString("hex");

  // Signatures can be formatted as "v1,signature"
  const candidates = signatureHeader.split(" ").flatMap((s) => s.split(","));
  for (const candidate of candidates) {
    const sigClean = candidate.startsWith("v1=")
      ? candidate.slice(3)
      : candidate.startsWith("v1,")
        ? candidate.slice(3)
        : candidate;

    try {
      if (
        (computedBase64.length === sigClean.length &&
          crypto.timingSafeEqual(Buffer.from(computedBase64), Buffer.from(sigClean))) ||
        (computedHex.length === sigClean.length &&
          crypto.timingSafeEqual(Buffer.from(computedHex), Buffer.from(sigClean)))
      ) {
        return true;
      }
    } catch {
      // Continue checking next candidate
    }
  }

  return false;
}

/**
 * Webhook handler for email provider delivery & bounce updates (§20, §21.4).
 */
notificationRouter.post("/email/webhook", async (req: Request, res: Response) => {
  // 1. Signature Verification
  const rawBody =
    (req as unknown as { rawBody?: Buffer | string }).rawBody || JSON.stringify(req.body);
  const isValid = verifyEmailWebhookSignature(rawBody, req.headers, env.RESEND_WEBHOOK_SECRET);

  if (!isValid) {
    logger.warn({ ip: req.ip }, "Rejected email webhook with invalid signature");
    throw new UnauthorizedError("Invalid webhook signature");
  }

  const body = req.body as {
    type?: string;
    id?: string;
    data?: {
      email_id?: string;
      to?: string[];
      bounce_type?: string;
      bounce_sub_type?: string;
      message?: string;
    };
  };

  const eventType = body.type || "unknown";
  const emailId = body.data?.email_id || body.id;

  if (!emailId) {
    throw new BadRequestError("Missing email_id in webhook payload");
  }

  const eventId = body.id || `evt_${emailId}_${eventType}_${Date.now()}`;

  // 2. Anti-Replay Idempotency (§20, §21.4)
  const existing = await prisma.webhookEvent.findUnique({
    where: {
      provider_eventId: {
        provider: "RESEND",
        eventId,
      },
    },
  });

  if (existing) {
    logger.info({ eventId }, "Replayed email webhook ignored");
    return res.status(200).json({ success: true, message: "Duplicate event acknowledged" });
  }

  await prisma.webhookEvent.create({
    data: {
      provider: "RESEND",
      eventId,
    },
  });

  // 3. Process events: delivered, bounced, complained
  const notification = await prisma.notification.findFirst({
    where: {
      providerMessageId: emailId,
    },
  });

  if (!notification) {
    logger.warn({ emailId, eventType }, "Received webhook for untracked email message ID");
    return res.status(200).json({ success: true, message: "Event recorded" });
  }

  const payload = (notification.payload || {}) as Record<string, unknown>;
  const batchId = payload.batchId ? String(payload.batchId) : undefined;

  if (eventType === "email.delivered" || eventType === "delivered") {
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.DELIVERED,
      },
    });

    if (batchId) {
      await prisma.giftItem.updateMany({
        where: {
          batchId,
          studentId: notification.studentId,
        },
        data: {
          emailStatus: NotificationStatus.DELIVERED,
        },
      });
    }

    logger.info({ emailId, studentId: notification.studentId }, "Email marked DELIVERED");
  } else if (
    eventType === "email.bounced" ||
    eventType === "bounced" ||
    eventType === "email.complained" ||
    eventType === "complained"
  ) {
    const reason = body.data?.message || body.data?.bounce_type || "Provider reported bounce";

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.BOUNCED,
        error: reason,
      },
    });

    if (batchId) {
      await prisma.giftItem.updateMany({
        where: {
          batchId,
          studentId: notification.studentId,
        },
        data: {
          emailStatus: NotificationStatus.BOUNCED,
        },
      });
    }

    await auditService.log({
      actorType: "SYSTEM",
      actorId: "EMAIL_WEBHOOK",
      action: "EMAIL_BOUNCED",
      entityType: "Notification",
      entityId: notification.id,
      after: {
        emailId,
        reason,
        studentId: notification.studentId,
        batchId,
      },
    });

    logger.warn({ emailId, studentId: notification.studentId, reason }, "Email marked BOUNCED");
  }

  return res.status(200).json({
    success: true,
    eventType,
    emailId,
  });
});
