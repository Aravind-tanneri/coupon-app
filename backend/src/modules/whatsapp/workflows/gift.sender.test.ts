import { describe, it, expect, vi, beforeEach } from "vitest";
import { giftWhatsAppSender } from "./gift.sender.js";
import { couponWorkflow } from "./coupon.workflow.js";
import { whatsAppService } from "../whatsapp.service.js";
import { prisma } from "../../../lib/prisma.js";
import { NotificationStatus } from "@prisma/client";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    giftItem: {
      updateMany: vi.fn(),
    },
    whatsAppIdentity: {
      findFirst: vi.fn(),
    },
    coupon: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../whatsapp.service.js", () => ({
  whatsAppService: {
    sendTemplate: vi.fn(),
    getProvider: vi.fn(() => ({
      sendButtons: vi.fn().mockResolvedValue({ messageId: "btn-msg-123" }),
      sendText: vi.fn().mockResolvedValue({ messageId: "txt-msg-123" }),
      sendImage: vi.fn().mockResolvedValue({ messageId: "img-msg-123" }),
    })),
  },
}));

describe("Phase 22: Gift WhatsApp Notifications (§22)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("22.1 Gift Template Sender", () => {
    it("dispatches template message with quick-reply View Pass button for linked student", async () => {
      vi.mocked(prisma.notification.findMany).mockResolvedValue([
        {
          id: "notif-wa-1",
          studentId: "stud-1",
          channel: "WHATSAPP",
          template: "GIFT_COUPON_WHATSAPP",
          payload: {
            batchId: "batch-1",
            couponId: "coup-1",
            shortCode: "DWLI9999",
            mealDate: "2026-11-05",
            message: "Diwali Special Dinner 2026",
          },
          status: NotificationStatus.PENDING,
          attempts: 0,
          error: null,
          nextAttemptAt: new Date(Date.now() - 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
          student: {
            id: "stud-1",
            name: "Alice Johnson",
            rollNo: "2024CS001",
            email: "alice@test.edu",
          },
        },
      ] as never);

      // Student has verified WhatsApp phone
      vi.mocked(prisma.whatsAppIdentity.findFirst).mockResolvedValue({
        id: "ident-1",
        studentId: "stud-1",
        phoneE164: "+919876543210",
        status: "ACTIVE",
      } as never);

      vi.mocked(whatsAppService.sendTemplate).mockResolvedValue({
        messageId: "wamid-template-1234",
      });

      const res = await giftWhatsAppSender.processOutbox(10);

      expect(res.processed).toBe(1);
      expect(res.succeeded).toBe(1);
      expect(res.failed).toBe(0);

      expect(whatsAppService.sendTemplate).toHaveBeenCalledWith(
        "+919876543210",
        "gift_coupon_issued",
        "en",
        expect.arrayContaining([
          expect.objectContaining({
            type: "body",
            parameters: expect.arrayContaining([
              { type: "text", text: "Alice Johnson" },
              { type: "text", text: "Diwali Special Dinner 2026" },
              { type: "text", text: "2026-11-05" },
              { type: "text", text: "DWLI9999" },
            ]),
          }),
          expect.objectContaining({
            type: "button",
            sub_type: "quick_reply",
            parameters: [{ type: "payload", payload: "SHOW_QR:DWLI9999" }],
          }),
        ]),
      );

      // Mark SENT
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-wa-1" },
          data: expect.objectContaining({
            status: NotificationStatus.SENT,
            providerMessageId: "wamid-template-1234",
          }),
        }),
      );

      expect(prisma.giftItem.updateMany).toHaveBeenCalledWith({
        where: { batchId: "batch-1", studentId: "stud-1" },
        data: { whatsappStatus: NotificationStatus.SENT },
      });
    });

    it("marks FAILED when student has no linked WhatsApp identity (§22.3 dashboard visibility)", async () => {
      vi.mocked(prisma.notification.findMany).mockResolvedValue([
        {
          id: "notif-wa-unlinked",
          studentId: "stud-unlinked",
          channel: "WHATSAPP",
          template: "GIFT_COUPON_WHATSAPP",
          payload: { batchId: "batch-1", shortCode: "DWLI8888", mealDate: "2026-11-05" },
          status: NotificationStatus.PENDING,
          attempts: 0,
          student: { id: "stud-unlinked", name: "Bob", rollNo: "2024EE002", email: "bob@test.edu" },
        },
      ] as never);

      // No active identity found
      vi.mocked(prisma.whatsAppIdentity.findFirst).mockResolvedValue(null);

      const res = await giftWhatsAppSender.processOutbox(10);

      expect(res.processed).toBe(1);
      expect(res.failed).toBe(1);
      expect(res.succeeded).toBe(0);

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-wa-unlinked" },
          data: expect.objectContaining({
            status: NotificationStatus.FAILED,
            error: "Student has not linked a WhatsApp account",
          }),
        }),
      );

      expect(prisma.giftItem.updateMany).toHaveBeenCalledWith({
        where: { batchId: "batch-1", studentId: "stud-unlinked" },
        data: { whatsappStatus: NotificationStatus.FAILED },
      });
    });
  });

  describe("22.2 My Gifts via get_my_gift_coupons", () => {
    it("returns formatted list of special feast gift passes with QR action buttons", async () => {
      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        {
          id: "coup-g1",
          studentId: "stud-1",
          source: "ADMIN_GIFT",
          status: "ACTIVE",
          shortCode: "FEAST123",
          validDate: new Date("2026-11-05T00:00:00.000Z"),
          mealType: "SPECIAL_DINNER",
        },
      ] as never);

      const reply = await couponWorkflow.listMyGiftCoupons("stud-1");

      expect(reply.text).toContain("My Special Feast Gift Passes");
      expect(reply.text).toContain("Special Dinner");
      expect(reply.text).toContain("FEAST123");
      expect(reply.text).toContain("🟢 Valid");
      expect(reply.buttons).toEqual([{ id: "SHOW_QR:FEAST123", title: "Pass FEAST123" }]);
    });

    it("returns helpful prompt when student has no gift passes", async () => {
      vi.mocked(prisma.coupon.findMany).mockResolvedValue([]);

      const reply = await couponWorkflow.listMyGiftCoupons("stud-1");

      expect(reply.text).toContain("You currently have no special dinner gift coupons");
      expect(reply.buttons).toEqual([{ id: "SHOW_TODAY_MENU", title: "View Today Menu" }]);
    });
  });
});
