import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { jobQueue } from "../../lib/queue.js";
import { WhatsAppProvider } from "./whatsapp.provider.js";
import { FakeWhatsAppProvider } from "./fake-whatsapp.provider.js";
import { MetaWhatsAppAdapter } from "./meta.adapter.js";
import {
  SendTextOptions,
  ButtonItem,
  SendButtonsOptions,
  ListSection,
  SendListOptions,
  SendImageOptions,
  TemplateComponent,
  ProviderSendResult,
  MediaDownloadResult,
  MetaWebhookPayload,
} from "./whatsapp.types.js";
import { ForbiddenError, BusinessRuleError } from "../../lib/errors.js";

export class WhatsAppService {
  private provider: WhatsAppProvider;

  constructor(provider?: WhatsAppProvider) {
    if (provider) {
      this.provider = provider;
    } else if (
      env.WHATSAPP_PHONE_NUMBER_ID &&
      env.WHATSAPP_ACCESS_TOKEN &&
      env.NODE_ENV !== "test"
    ) {
      this.provider = new MetaWhatsAppAdapter({
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
      });
    } else {
      this.provider = new FakeWhatsAppProvider();
    }
  }

  setProvider(provider: WhatsAppProvider): void {
    this.provider = provider;
  }

  getProvider(): WhatsAppProvider {
    return this.provider;
  }

  /**
   * Check 24-hour Customer Service Window (§11.4).
   * WhatsApp policy requires that outbound free-form messages can only be sent
   * within 24 hours of the last user-initiated inbound message.
   */
  async isWithinCustomerServiceWindow(phoneE164: string): Promise<boolean> {
    const identity = await prisma.whatsAppIdentity.findUnique({
      where: { phoneE164 },
    });

    // Look up latest inbound message for this identity or phone
    const lastInbound = await prisma.whatsAppMessageLog.findFirst({
      where: {
        direction: "INBOUND",
        OR: [
          ...(identity ? [{ identityId: identity.id }] : []),
          { payload: { path: ["from"], equals: phoneE164 } },
        ],
      },
      orderBy: { receivedAt: "desc" },
    });

    if (!lastInbound) {
      return false;
    }

    const elapsedMs = Date.now() - lastInbound.receivedAt.getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    return elapsedMs <= twentyFourHoursMs;
  }

  async sendText(to: string, text: string, options?: SendTextOptions): Promise<ProviderSendResult> {
    const withinWindow = await this.isWithinCustomerServiceWindow(to);
    if (!withinWindow) {
      logger.warn({ to }, "Outbound text rejected: outside 24-hour customer service window");
      throw new BusinessRuleError(
        "CUSTOMER_SERVICE_WINDOW_EXPIRED",
        "Cannot send free-form message outside 24-hour customer service window. Template required.",
      );
    }

    const result = await this.provider.sendText(to, text, options);
    await this.logOutboundMessage(to, result.messageId, "text", { text, options });
    return result;
  }

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: ButtonItem[],
    options?: SendButtonsOptions,
  ): Promise<ProviderSendResult> {
    const withinWindow = await this.isWithinCustomerServiceWindow(to);
    if (!withinWindow) {
      logger.warn({ to }, "Outbound buttons rejected: outside 24-hour customer service window");
      throw new BusinessRuleError(
        "CUSTOMER_SERVICE_WINDOW_EXPIRED",
        "Cannot send free-form buttons outside 24-hour customer service window. Template required.",
      );
    }

    const result = await this.provider.sendButtons(to, bodyText, buttons, options);
    await this.logOutboundMessage(to, result.messageId, "interactive", {
      bodyText,
      buttons,
      options,
    });
    return result;
  }

  async sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
    options?: SendListOptions,
  ): Promise<ProviderSendResult> {
    const withinWindow = await this.isWithinCustomerServiceWindow(to);
    if (!withinWindow) {
      logger.warn({ to }, "Outbound list rejected: outside 24-hour customer service window");
      throw new BusinessRuleError(
        "CUSTOMER_SERVICE_WINDOW_EXPIRED",
        "Cannot send free-form list outside 24-hour customer service window. Template required.",
      );
    }

    const result = await this.provider.sendList(to, bodyText, buttonText, sections, options);
    await this.logOutboundMessage(to, result.messageId, "interactive", {
      bodyText,
      buttonText,
      sections,
      options,
    });
    return result;
  }

  async sendImage(
    to: string,
    imageUrlOrBuffer: string | Buffer,
    options?: SendImageOptions,
  ): Promise<ProviderSendResult> {
    const withinWindow = await this.isWithinCustomerServiceWindow(to);
    if (!withinWindow) {
      logger.warn({ to }, "Outbound image rejected: outside 24-hour customer service window");
      throw new BusinessRuleError(
        "CUSTOMER_SERVICE_WINDOW_EXPIRED",
        "Cannot send media outside 24-hour customer service window. Template required.",
      );
    }

    const result = await this.provider.sendImage(to, imageUrlOrBuffer, options);
    await this.logOutboundMessage(to, result.messageId, "image", { options });
    return result;
  }

  /**
   * Templates are pre-approved by Meta and can be sent anytime, even outside the 24-hour window.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: TemplateComponent[],
  ): Promise<ProviderSendResult> {
    const result = await this.provider.sendTemplate(to, templateName, languageCode, components);
    await this.logOutboundMessage(to, result.messageId, "template", {
      templateName,
      languageCode,
      components,
    });
    return result;
  }

  async downloadMedia(mediaId: string): Promise<MediaDownloadResult> {
    return this.provider.downloadMedia(mediaId);
  }

  private async logOutboundMessage(
    to: string,
    wamid: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const identity = await prisma.whatsAppIdentity.findUnique({
        where: { phoneE164: to },
      });

      await prisma.whatsAppMessageLog.create({
        data: {
          wamid,
          identityId: identity?.id ?? null,
          direction: "OUTBOUND",
          type,
          payload: { to, ...payload } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      logger.warn({ err, wamid }, "Failed to log outbound WhatsApp message to database");
    }
  }

  /**
   * Meta Webhook Handshake Verification (GET /api/v1/whatsapp/webhook).
   */
  verifyHandshake(mode?: string, token?: string, challenge?: string): string {
    const configuredToken = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (mode === "subscribe" && configuredToken && token === configuredToken && challenge) {
      return challenge;
    }
    throw new ForbiddenError("Invalid WhatsApp webhook verify token or subscription mode");
  }

  /**
   * Verify HMAC-SHA256 signature on POST request body.
   */
  verifySignature(rawBody: Buffer | string | undefined, signatureHeader?: string): boolean {
    const appSecret = env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      if (env.NODE_ENV === "test") return true;
      logger.warn("WHATSAPP_APP_SECRET not configured, rejecting webhook");
      return false;
    }

    if (!rawBody || !signatureHeader) {
      return false;
    }

    const parts = signatureHeader.split("=");
    if (parts.length !== 2 || parts[0] !== "sha256" || !parts[1]) {
      return false;
    }

    const expectedSignature = parts[1];
    const computedSignature = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

    try {
      const expectedBuf = Buffer.from(expectedSignature, "hex");
      const computedBuf = Buffer.from(computedSignature, "hex");
      if (expectedBuf.length !== computedBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(expectedBuf, computedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Ingest and deduplicate webhook payload (§11.2).
   */
  async processWebhook(
    payload: MetaWebhookPayload,
  ): Promise<{ processed: number; duplicates: number }> {
    let processed = 0;
    let duplicates = 0;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const val = change.value;
        if (!val) continue;

        // Process message status updates (sent, delivered, read, failed)
        if (val.statuses && Array.isArray(val.statuses)) {
          for (const status of val.statuses) {
            logger.info(
              { statusId: status.id, status: status.status },
              "WhatsApp delivery status update",
            );
            // If linked notification exists, update status
            await prisma.notification
              .updateMany({
                where: { providerMessageId: status.id },
                data: {
                  status: status.status === "failed" ? "FAILED" : "DELIVERED",
                  error: status.errors?.[0]?.message ?? null,
                },
              })
              .catch(() => null);
          }
        }

        // Process inbound user messages
        if (val.messages && Array.isArray(val.messages)) {
          for (const msg of val.messages) {
            const wamid = msg.id;
            const fromPhone = msg.from;

            // Deduplication by wamid (§11.2)
            const existing = await prisma.whatsAppMessageLog.findUnique({
              where: { wamid },
            });

            if (existing) {
              duplicates++;
              logger.info({ wamid }, "Duplicate WhatsApp message detected and skipped");
              continue;
            }

            // Resolve student identity if previously linked
            const identity = await prisma.whatsAppIdentity.findUnique({
              where: { phoneE164: fromPhone },
            });

            // Insert into WhatsAppMessageLog
            await prisma.whatsAppMessageLog.create({
              data: {
                wamid,
                identityId: identity?.id ?? null,
                direction: "INBOUND",
                type: msg.type,
                payload: msg as unknown as Prisma.InputJsonValue,
              },
            });

            // Enqueue inbound message job
            await jobQueue.send("whatsapp-inbound", {
              message: msg,
              phone: fromPhone,
              identityId: identity?.id ?? null,
              studentId: identity?.studentId ?? null,
            });

            processed++;
          }
        }
      }
    }

    return { processed, duplicates };
  }
}

export const whatsAppService = new WhatsAppService();
