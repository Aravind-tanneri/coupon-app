import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { env } from "../../config/env.js";
import { whatsAppService } from "./whatsapp.service.js";
import { FakeWhatsAppProvider } from "./fake-whatsapp.provider.js";
import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, BusinessRuleError } from "../../lib/errors.js";
import { jobQueue } from "../../lib/queue.js";
import { MetaWebhookPayload } from "./whatsapp.types.js";
import { whatsAppWorker } from "./whatsapp.worker.js";
import { onboardingService } from "../students/onboarding.service.js";

vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      whatsAppIdentity: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
      whatsAppMessageLog: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      notification: {
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === "function") {
          return cb(prisma);
        }
        return Promise.all(cb);
      }),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock("../../lib/queue.js", () => {
  return {
    jobQueue: {
      send: vi.fn().mockResolvedValue("job-123"),
      work: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../students/onboarding.service.js", () => {
  return {
    onboardingService: {
      handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
      handleUnlinkRequest: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("Phase 11: WhatsApp Module", () => {
  let fakeProvider: FakeWhatsAppProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeProvider = new FakeWhatsAppProvider();
    whatsAppService.setProvider(fakeProvider);
  });

  describe("Provider Interface & Fake Adapter", () => {
    it("sends text, buttons, list, image, and templates", async () => {
      // Allow window check for text/buttons
      vi.mocked(prisma.whatsAppIdentity.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.whatsAppMessageLog.findFirst).mockResolvedValue({
        id: "msg-prev",
        wamid: "wamid.in.1",
        identityId: null,
        direction: "INBOUND",
        type: "text",
        payload: { from: "+919876543210" },
        receivedAt: new Date(),
      });
      vi.mocked(prisma.whatsAppMessageLog.create).mockResolvedValue({
        id: "log-1",
        wamid: "wamid.1",
        identityId: null,
        direction: "OUTBOUND",
        type: "text",
        payload: {},
        receivedAt: new Date(),
      });

      // 1. Text
      const textRes = await whatsAppService.sendText("+919876543210", "Hello student");
      expect(textRes.messageId).toMatch(/^wamid\.fake\./);

      // 2. Buttons
      const btnRes = await whatsAppService.sendButtons(
        "+919876543210",
        "Choose an option",
        [
          { id: "opt_menu", title: "View Menu" },
          { id: "opt_coupon", title: "My Coupons" },
        ],
        { header: "Campus Mess", footer: "Tap to select" },
      );
      expect(btnRes.messageId).toMatch(/^wamid\.fake\./);

      // 3. List
      const listRes = await whatsAppService.sendList(
        "+919876543210",
        "Select your meal",
        "View Meals",
        [
          {
            title: "Today",
            rows: [{ id: "meal_lunch", title: "Lunch", description: "Veg Thali" }],
          },
        ],
      );
      expect(listRes.messageId).toMatch(/^wamid\.fake\./);

      // 4. Image
      const imgRes = await whatsAppService.sendImage(
        "+919876543210",
        "https://cdn.example.com/qr.png",
        {
          caption: "Your coupon pass",
        },
      );
      expect(imgRes.messageId).toMatch(/^wamid\.fake\./);

      // 5. Template (bypasses 24h window)
      const tmplRes = await whatsAppService.sendTemplate(
        "+919876543210",
        "reimbursement_status_update",
        "en",
        [],
      );
      expect(tmplRes.messageId).toMatch(/^wamid\.fake\./);

      // 6. Media download
      fakeProvider.setMedia("media-xyz", Buffer.from("test pdf content"), "application/pdf");
      const media = await whatsAppService.downloadMedia("media-xyz");
      expect(media.data.toString()).toBe("test pdf content");
      expect(media.mimeType).toBe("application/pdf");

      expect(fakeProvider.getSentMessages()).toHaveLength(5);
    });
  });

  describe("24-Hour Customer Service Window (§11.4)", () => {
    it("blocks outbound free-form text if no previous inbound message exists", async () => {
      vi.mocked(prisma.whatsAppIdentity.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.whatsAppMessageLog.findFirst).mockResolvedValue(null);

      await expect(
        whatsAppService.sendText("+919999999999", "Proactive notification"),
      ).rejects.toThrow(BusinessRuleError);

      expect(fakeProvider.getSentMessages()).toHaveLength(0);
    });

    it("blocks outbound free-form text if last inbound message is older than 24 hours", async () => {
      vi.mocked(prisma.whatsAppIdentity.findUnique).mockResolvedValue(null);
      const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000);
      vi.mocked(prisma.whatsAppMessageLog.findFirst).mockResolvedValue({
        id: "msg-old",
        wamid: "wamid.old",
        identityId: null,
        direction: "INBOUND",
        type: "text",
        payload: { from: "+919999999999" },
        receivedAt: thirtyHoursAgo,
      });

      await expect(
        whatsAppService.sendText("+919999999999", "Expired window message"),
      ).rejects.toThrow(/outside 24-hour customer service window/);

      expect(fakeProvider.getSentMessages()).toHaveLength(0);
    });

    it("allows templates even when outside the 24-hour window", async () => {
      vi.mocked(prisma.whatsAppIdentity.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.whatsAppMessageLog.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.whatsAppMessageLog.create).mockResolvedValue({} as never);

      const res = await whatsAppService.sendTemplate("+919999999999", "coupon_ready", "en", []);
      expect(res.messageId).toBeDefined();
      expect(fakeProvider.getSentMessages()).toHaveLength(1);
    });
  });

  describe("Webhook Handshake & Signature Verification (§11.2)", () => {
    it("verifies GET handshake with valid mode and verify token", () => {
      const challenge = whatsAppService.verifyHandshake(
        "subscribe",
        env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "test_webhook_verify_token",
        "CHALLENGE_STRING_456",
      );
      expect(challenge).toBe("CHALLENGE_STRING_456");
    });

    it("rejects GET handshake with invalid token or wrong mode", () => {
      expect(() => {
        whatsAppService.verifyHandshake("subscribe", "wrong_token", "CHALLENGE_456");
      }).toThrow(ForbiddenError);

      expect(() => {
        whatsAppService.verifyHandshake(
          "publish",
          env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "test_webhook_verify_token",
          "CHALLENGE_456",
        );
      }).toThrow(ForbiddenError);
    });

    it("verifies HMAC-SHA256 signature on POST body", () => {
      const appSecret = env.WHATSAPP_APP_SECRET || "test_whatsapp_app_secret";

      const rawBody = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
      const validHmac = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
      const signatureHeader = `sha256=${validHmac}`;

      const isValid = whatsAppService.verifySignature(rawBody, signatureHeader);
      expect(isValid).toBe(true);

      const isInvalid = whatsAppService.verifySignature(rawBody, "sha256=deadbeef1234");
      expect(isInvalid).toBe(false);

      const isMissing = whatsAppService.verifySignature(rawBody, undefined);
      expect(isMissing).toBe(false);
    });
  });

  describe("Webhook Deduplication & Ingestion (§11.2)", () => {
    it("ingests inbound message and queues job", async () => {
      vi.mocked(prisma.whatsAppMessageLog.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.whatsAppIdentity.findUnique).mockResolvedValue({
        id: "ident-1",
        studentId: "stud-1",
        phoneE164: "+919876543210",
        status: "ACTIVE",
        verifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.whatsAppMessageLog.create).mockResolvedValue({} as never);

      const payload: MetaWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-1",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15550001",
                    phone_number_id: "phone-1",
                  },
                  messages: [
                    {
                      from: "+919876543210",
                      id: "wamid.new.101",
                      timestamp: "1729000000",
                      type: "text",
                      text: { body: "MENU" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await whatsAppService.processWebhook(payload);
      expect(result.processed).toBe(1);
      expect(result.duplicates).toBe(0);

      expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            wamid: "wamid.new.101",
            direction: "INBOUND",
            identityId: "ident-1",
          }),
        }),
      );

      expect(jobQueue.send).toHaveBeenCalledWith(
        "whatsapp-inbound",
        expect.objectContaining({
          phone: "+919876543210",
          identityId: "ident-1",
        }),
      );
    });

    it("skips duplicate message IDs (wamid deduplication)", async () => {
      vi.mocked(prisma.whatsAppMessageLog.findUnique).mockResolvedValue({
        id: "log-already-saved",
        wamid: "wamid.duplicate.999",
      } as never);

      const payload: MetaWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-1",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15550001",
                    phone_number_id: "phone-1",
                  },
                  messages: [
                    {
                      from: "+919876543210",
                      id: "wamid.duplicate.999",
                      timestamp: "1729000000",
                      type: "text",
                      text: { body: "MENU" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await whatsAppService.processWebhook(payload);
      expect(result.processed).toBe(0);
      expect(result.duplicates).toBe(1);
      expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
      expect(jobQueue.send).not.toHaveBeenCalled();
    });

    it("handles delivery status updates", async () => {
      vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 1 });

      const payload: MetaWebhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-1",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15550001",
                    phone_number_id: "phone-1",
                  },
                  statuses: [
                    {
                      id: "wamid.notif.1",
                      status: "delivered",
                      timestamp: "1729000000",
                      recipient_id: "+919876543210",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await whatsAppService.processWebhook(payload);
      expect(result.processed).toBe(0);
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { providerMessageId: "wamid.notif.1" },
        data: { status: "DELIVERED", error: null },
      });
    });
  });

  describe("Worker & Per-Identity Lock (§11.3)", () => {
    it("routes unlinked phone messages to onboarding flow", async () => {
      vi.mocked(prisma.whatsAppIdentity.findUnique).mockResolvedValue(null);

      await whatsAppWorker.processJob({
        phone: "+919876543210",
        message: {
          from: "+919876543210",
          id: "wamid.123",
          timestamp: "1729000000",
          type: "text",
          text: { body: "2024CS001" },
        },
      });

      expect(onboardingService.handleIncomingMessage).toHaveBeenCalledWith(
        "+919876543210",
        expect.objectContaining({
          text: { body: "2024CS001" },
        }),
        expect.anything(),
      );
    });

    it("handles UNLINK / LOGOUT command for linked student", async () => {
      vi.mocked(prisma.whatsAppIdentity.findUnique).mockResolvedValue({
        id: "ident-active",
        studentId: "stud-1",
        phoneE164: "+919876543210",
        status: "ACTIVE",
        verifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        student: { name: "Rahul" },
      } as never);

      await whatsAppWorker.processJob({
        phone: "+919876543210",
        message: {
          from: "+919876543210",
          id: "wamid.unlink.1",
          timestamp: "1729000000",
          type: "text",
          text: { body: "UNLINK" },
        },
      });

      expect(onboardingService.handleUnlinkRequest).toHaveBeenCalledWith(
        "ident-active",
        "+919876543210",
        expect.anything(),
      );
    });
  });
});
