import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsoleEmailProvider } from "./email.provider.js";
import { renderGiftCouponEmail } from "./email.templates.js";
import { EmailOutboxWorker } from "./outbox.worker.js";
import { verifyEmailWebhookSignature } from "./notification.routes.js";
import { prisma } from "../../lib/prisma.js";
import { NotificationStatus } from "@prisma/client";
import crypto from "crypto";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    giftItem: {
      updateMany: vi.fn(),
    },
    webhookEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("../audit/audit.service.js", () => ({
  auditService: {
    log: vi.fn(),
  },
}));

describe("Phase 21: Gift Email Delivery & Outbox (§20, §21)", () => {
  let fakeProvider: ConsoleEmailProvider;
  let worker: EmailOutboxWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeProvider = new ConsoleEmailProvider();
    worker = new EmailOutboxWorker(fakeProvider);
  });

  describe("21.1 Provider Interface & Console Provider", () => {
    it("delivers and records sent emails in memory", async () => {
      const result = await fakeProvider.send({
        to: "alice@institution.edu",
        subject: "Your Gift Pass",
        html: "<p>Hello Alice</p>",
        text: "Hello Alice",
      });

      expect(result.providerMessageId).toMatch(/^console-msg-/);
      const sent = fakeProvider.getSentEmails();
      expect(sent.length).toBe(1);
      expect(sent[0]?.to).toBe("alice@institution.edu");
      expect(sent[0]?.subject).toBe("Your Gift Pass");
    });

    it("throws simulated rejection when shouldFail predicate triggers", async () => {
      fakeProvider.setShouldFail((options) => options.to === "bounce@institution.edu");

      await expect(
        fakeProvider.send({
          to: "bounce@institution.edu",
          subject: "Test",
          html: "<p>Hi</p>",
        }),
      ).rejects.toThrow("Simulated email delivery rejection");
    });
  });

  describe("21.3 Email Template Security & Rendering (§20)", () => {
    const rawToken = "Vj3k7L0aBcDeFgHiJkLmNoPq";
    const shortCode = "7K9X2MW4";
    const emailResult = renderGiftCouponEmail({
      studentName: "Rahul Sharma",
      mealDate: "2026-11-05",
      shortCode,
      rawToken,
      occasionMessage: "Diwali Special Dinner 2026",
      messName: "Akshaya Mess",
    });

    it("renders table-based responsive HTML and plain text with short code and pass URL", () => {
      expect(emailResult.subject).toContain("Diwali Special Dinner 2026");
      expect(emailResult.subject).toContain("2026-11-05");

      // HTML assertions
      expect(emailResult.html).toContain(shortCode);
      expect(emailResult.html).toContain("Rahul Sharma");
      expect(emailResult.html).toContain("Akshaya Mess");
      expect(emailResult.html).toContain(`/c/${rawToken}`);
      expect(emailResult.html).toContain("View Digital QR Pass");

      // Text assertions
      expect(emailResult.text).toContain(shortCode);
      expect(emailResult.text).toContain(`/c/${rawToken}`);
    });

    it("CRITICAL AC (§20): contains ZERO internal database IDs or CUIDs in subject, html, or text", () => {
      const cuidPattern = /c[a-z0-9]{24}/i;
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

      // Subject
      expect(emailResult.subject).not.toMatch(cuidPattern);
      expect(emailResult.subject).not.toMatch(uuidPattern);

      // HTML
      expect(emailResult.html).not.toMatch(cuidPattern);
      expect(emailResult.html).not.toMatch(uuidPattern);

      // Plain text
      expect(emailResult.text).not.toMatch(cuidPattern);
      expect(emailResult.text).not.toMatch(uuidPattern);
    });
  });

  describe("21.2 Outbox Worker & Retries (§20, §21.2)", () => {
    it("processes pending notifications and updates status to SENT", async () => {
      vi.mocked(prisma.notification.findMany).mockResolvedValue([
        {
          id: "notif-1",
          studentId: "stud-1",
          channel: "EMAIL",
          template: "GIFT_COUPON_EMAIL",
          payload: {
            batchId: "batch-1",
            couponId: "coup-1",
            shortCode: "7K9X2MW4",
            rawToken: "token123",
            mealDate: "2026-11-05",
            message: "Diwali Dinner",
          },
          status: NotificationStatus.PENDING,
          providerMessageId: null,
          attempts: 0,
          error: null,
          nextAttemptAt: new Date(Date.now() - 10000),
          createdAt: new Date(),
          updatedAt: new Date(),
          student: {
            id: "stud-1",
            name: "Alice Johnson",
            email: "alice@test.edu",
            messId: "akshaya",
          },
        },
      ] as never);

      const result = await worker.processOutbox(10);

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-1" },
          data: expect.objectContaining({
            status: NotificationStatus.SENT,
          }),
        }),
      );

      expect(prisma.giftItem.updateMany).toHaveBeenCalledWith({
        where: { batchId: "batch-1", studentId: "stud-1" },
        data: { emailStatus: NotificationStatus.SENT },
      });
    });

    it("reschedules with exponential backoff on transient failure and marks FAILED after 3 attempts", async () => {
      fakeProvider.setShouldFail(true);

      // Attempt 1 failure -> reschedules
      vi.mocked(prisma.notification.findMany).mockResolvedValueOnce([
        {
          id: "notif-transient",
          studentId: "stud-1",
          channel: "EMAIL",
          template: "GIFT_COUPON_EMAIL",
          payload: {
            batchId: "batch-1",
            shortCode: "CODE1234",
            rawToken: "tok1",
            mealDate: "2026-11-05",
          },
          status: NotificationStatus.PENDING,
          providerMessageId: null,
          attempts: 1, // Will become attempt 2
          error: null,
          nextAttemptAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          student: { id: "stud-1", name: "Bob", email: "bob@test.edu", messId: "akshaya" },
        },
      ] as never);

      const res1 = await worker.processOutbox(10);
      expect(res1.failed).toBe(1);

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-transient" },
          data: expect.objectContaining({
            attempts: 2,
            nextAttemptAt: expect.any(Date),
          }),
        }),
      );

      // Attempt 3 failure -> marks FAILED
      vi.mocked(prisma.notification.findMany).mockResolvedValueOnce([
        {
          id: "notif-fatal",
          studentId: "stud-1",
          channel: "EMAIL",
          template: "GIFT_COUPON_EMAIL",
          payload: {
            batchId: "batch-1",
            shortCode: "CODE1234",
            rawToken: "tok1",
            mealDate: "2026-11-05",
          },
          status: NotificationStatus.PENDING,
          providerMessageId: null,
          attempts: 2, // Will become attempt 3
          error: null,
          nextAttemptAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          student: { id: "stud-1", name: "Bob", email: "bob@test.edu", messId: "akshaya" },
        },
      ] as never);

      const res2 = await worker.processOutbox(10);
      expect(res2.failed).toBe(1);

      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-fatal" },
          data: expect.objectContaining({
            status: NotificationStatus.FAILED,
            attempts: 3,
          }),
        }),
      );

      expect(prisma.giftItem.updateMany).toHaveBeenCalledWith({
        where: { batchId: "batch-1", studentId: "stud-1" },
        data: { emailStatus: NotificationStatus.FAILED },
      });
    });

    it("CRITICAL AC (§21.5, §29): a partial batch failure (one bounce/error) leaves others unaffected", async () => {
      // Simulate failure ONLY for student 'bob@test.edu'
      fakeProvider.setShouldFail((opts) => opts.to === "bob@test.edu");

      vi.mocked(prisma.notification.findMany).mockResolvedValue([
        {
          id: "notif-alice",
          studentId: "s-alice",
          channel: "EMAIL",
          template: "GIFT_COUPON_EMAIL",
          payload: {
            batchId: "batch-1",
            shortCode: "ALICE123",
            rawToken: "tok-alice",
            mealDate: "2026-11-05",
          },
          status: NotificationStatus.PENDING,
          attempts: 0,
          student: { id: "s-alice", name: "Alice", email: "alice@test.edu", messId: "akshaya" },
        },
        {
          id: "notif-bob",
          studentId: "s-bob",
          channel: "EMAIL",
          template: "GIFT_COUPON_EMAIL",
          payload: {
            batchId: "batch-1",
            shortCode: "BOB12345",
            rawToken: "tok-bob",
            mealDate: "2026-11-05",
          },
          status: NotificationStatus.PENDING,
          attempts: 0,
          student: { id: "s-bob", name: "Bob", email: "bob@test.edu", messId: "akshaya" },
        },
        {
          id: "notif-charlie",
          studentId: "s-charlie",
          channel: "EMAIL",
          template: "GIFT_COUPON_EMAIL",
          payload: {
            batchId: "batch-1",
            shortCode: "CHARLIE1",
            rawToken: "tok-charlie",
            mealDate: "2026-11-05",
          },
          status: NotificationStatus.PENDING,
          attempts: 0,
          student: {
            id: "s-charlie",
            name: "Charlie",
            email: "charlie@test.edu",
            messId: "akshaya",
          },
        },
      ] as never);

      const result = await worker.processOutbox(10);

      expect(result.processed).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);

      // Alice & Charlie were SENT
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-alice" },
          data: expect.objectContaining({ status: NotificationStatus.SENT }),
        }),
      );
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-charlie" },
          data: expect.objectContaining({ status: NotificationStatus.SENT }),
        }),
      );

      // Bob failed and was rescheduled
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "notif-bob" },
          data: expect.objectContaining({ attempts: 1 }),
        }),
      );
    });
  });

  describe("21.4 Webhook Signature Verification (§20, §21.4)", () => {
    const secret = "whsec_mf9283ud823hd928hd28dh==";

    it("verifies valid Svix HMAC signature", () => {
      const rawBody = JSON.stringify({ type: "email.delivered", id: "evt_123" });
      const svixId = "msg_pqr123";
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const payloadToSign = `${svixId}.${timestamp}.${rawBody}`;

      const key = Buffer.from("mf9283ud823hd928hd28dh==", "base64");
      const signature = `v1,${crypto.createHmac("sha256", key).update(payloadToSign).digest("base64")}`;

      const headers = {
        "svix-id": svixId,
        "svix-timestamp": timestamp,
        "svix-signature": signature,
      };

      const valid = verifyEmailWebhookSignature(rawBody, headers, secret);
      expect(valid).toBe(true);
    });

    it("rejects forged webhook signature", () => {
      const rawBody = JSON.stringify({ type: "email.bounced" });
      const headers = {
        "svix-signature": "v1,forgedsignature1234567890=",
      };

      const valid = verifyEmailWebhookSignature(rawBody, headers, secret);
      expect(valid).toBe(false);
    });
  });
});
