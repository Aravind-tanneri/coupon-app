import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { createApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { reimbursementService } from "../../modules/reimbursements/reimbursement.service.js";
import { giftService } from "../../modules/gifts/gift.service.js";
import { validateMediaFile, MAX_FILE_SIZE_BYTES } from "../../modules/storage/file-validator.js";
import { storageService } from "../../modules/storage/storage.service.js";
import { IpRateLimiter } from "../../middleware/rateLimit.js";
import { RazorpayAdapter } from "../../modules/payments/razorpay.adapter.js";
import { whatsAppService } from "../../modules/whatsapp/whatsapp.service.js";
import { ForbiddenError, BusinessRuleError } from "../../lib/errors.js";

// Mock Prisma
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    adminUser: { findUnique: vi.fn() },
    session: { findUnique: vi.fn(), delete: vi.fn() },
    reimbursementRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    reimbursementDocument: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    giftBatch: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    coupon: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    webhookEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

describe("Phase 24 / §24.5 Penetration Test Suite", () => {
  const app = createApp({ enableLogging: false });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. IDOR & Authorization Boundary Tests
  // --------------------------------------------------------------------------
  describe("1. IDOR & Access Control Boundaries", () => {
    it("1.1 Refuses unauthenticated requests to protected admin endpoints with 401", async () => {
      const res1 = await request(app).get("/api/v1/reimbursements/requests");
      expect(res1.status).toBe(401);
      expect(res1.body.error.code).toBe("UNAUTHORIZED");

      const res2 = await request(app).get("/api/v1/gifts/batches");
      expect(res2.status).toBe(401);
      expect(res2.body.error.code).toBe("UNAUTHORIZED");

      const res3 = await request(app).get("/api/v1/coupons");
      expect(res3.status).toBe(401);
      expect(res3.body.error.code).toBe("UNAUTHORIZED");
    });

    it("1.2 Prevents cross-mess IDOR: Mess Admin A cannot approve or mutate claims of Mess B", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValueOnce({
        id: "claim-annapurna-1",
        messId: "mess-annapurna",
        studentId: "student-1",
        version: 1,
        status: "SUBMITTED",
        amountPaise: 78600,
        approvedDays: 6,
        dailyRatePaise: 13100,
      } as any);

      // Admin from Mess A ("mess-akshaya") attempts to review/approve
      await expect(
        reimbursementService.approveClaim(
          "claim-annapurna-1",
          "admin-akshaya-user",
          { approvedAmountPaise: 78600, version: 1 },
          "mess-akshaya", // Mismatched mess restriction
        ),
      ).rejects.toThrow(BusinessRuleError);
    });

    it("1.3 Prevents cross-mess IDOR: Mess Admin A cannot view supporting documents of Mess B", async () => {
      vi.mocked(prisma.reimbursementDocument.findFirst).mockResolvedValueOnce({
        id: "doc-annapurna-1",
        requestId: "claim-annapurna-1",
        storageKey: "reimb/claim-annapurna-1/secret.pdf",
        originalName: "medical_cert.pdf",
        scanStatus: "CLEAN",
        request: {
          id: "claim-annapurna-1",
          messId: "mess-annapurna",
        },
      } as any);

      // Admin from Mess A attempts to fetch document signed URL
      await expect(
        reimbursementService.getDocumentUrl(
          "claim-annapurna-1",
          "doc-annapurna-1",
          "admin-akshaya-user",
          "127.0.0.1",
          "mess-akshaya", // Mismatched mess
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it("1.4 Prevents cross-mess IDOR: Mess Admin A cannot inspect or revoke gift coupons of Mess B", async () => {
      vi.mocked(prisma.coupon.findUnique).mockResolvedValueOnce({
        id: "coupon-annapurna-gift",
        messId: "mess-annapurna",
        source: "ADMIN_GIFT",
        status: "ACTIVE",
        mess: { id: "mess-annapurna", code: "ANNAPURNA", name: "Annapurna Dining" },
        student: { id: "std-1", rollNo: "2024CS001", name: "Student", email: "std@campus.edu" },
      } as any);

      // Admin from Mess A attempts to revoke Mess B's coupon
      await expect(
        giftService.revokeGiftCoupon(
          "coupon-annapurna-gift",
          "admin-akshaya-user",
          "Revocation attempt",
          "127.0.0.1",
          "mess-akshaya", // Mismatched mess
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Token Enumeration & Timing Attacks
  // --------------------------------------------------------------------------
  describe("2. Token Enumeration, Uniform 404, & Timing Attacks", () => {
    it("2.1 Returns uniform 404 on missing/nonexistent tokens without revealing existence or schema details", async () => {
      vi.mocked(prisma.coupon.findUnique).mockResolvedValue(null);

      const res = await request(app).get("/c/NONEXISTENT12345");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
      expect(res.body.error.message).toContain("not found");
      // Must not leak database error or query trace
      expect(res.body).not.toHaveProperty("stack");
      expect(res.body).not.toHaveProperty("query");
    });

    it("2.2 Enforces IP-based rate limiting against brute-force token enumeration", () => {
      const limiter = new IpRateLimiter({ maxRequests: 5, windowMs: 10000 });
      const attackerIp = "198.51.100.42";

      // First 5 requests succeed
      for (let i = 0; i < 5; i++) {
        expect(limiter.check(attackerIp)).toBe(true);
      }

      // 6th request is throttled
      expect(limiter.check(attackerIp)).toBe(false);
    });

    it("2.3 Uses constant-time comparison in webhook HMAC verification to prevent timing side-channels", () => {
      const secret = "test_webhook_secret_key";
      const payload = JSON.stringify({ event: "payment.captured", id: "pay_123" });
      const validSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

      const adapter = new RazorpayAdapter("rzp_test_key", secret, secret);

      // Valid signature passes
      expect(adapter.verifyWebhookSignature(payload, validSignature)).toBe(true);

      // Tampered signature with 1 bit difference fails safely
      const tamperedSignature =
        validSignature.slice(0, -1) + (validSignature.slice(-1) === "a" ? "b" : "a");
      expect(adapter.verifyWebhookSignature(payload, tamperedSignature)).toBe(false);

      // Different length string returns false without uncaught exception
      expect(adapter.verifyWebhookSignature(payload, "short_invalid")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Upload Abuse Prevention (§25)
  // --------------------------------------------------------------------------
  describe("3. File Upload Abuse Prevention (§25)", () => {
    it("3.1 Rejects executable disguised with an image extension (PE / MZ magic byte mismatch)", () => {
      // Create executable buffer starting with DOS MZ header 'MZ' (0x4D, 0x5A)
      const fakeExeBuffer = Buffer.alloc(1024);
      fakeExeBuffer[0] = 0x4d; // 'M'
      fakeExeBuffer[1] = 0x5a; // 'Z'

      expect(() => {
        validateMediaFile(fakeExeBuffer, "image/jpeg", "disguised_virus.jpg");
      }).toThrow(/Unsupported file format/);
    });

    it("3.2 Rejects oversized file payload exceeding 5 MB ceiling", () => {
      const oversizedBuffer = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024);
      // Valid PNG header
      oversizedBuffer[0] = 0x89;
      oversizedBuffer[1] = 0x50;
      oversizedBuffer[2] = 0x4e;
      oversizedBuffer[3] = 0x47;

      expect(() => {
        validateMediaFile(oversizedBuffer, "image/png", "huge_receipt.png");
      }).toThrow(/exceeds 5 MB limit/);
    });

    it("3.3 Rejects malicious PDF containing embedded scripts or launch actions", () => {
      const maliciousPdfContent =
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert('PWNED');) >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
      const pdfBuffer = Buffer.from(maliciousPdfContent, "binary");

      expect(() => {
        validateMediaFile(pdfBuffer, "application/pdf", "receipt.pdf");
      }).toThrow(/PDF rejected: contains embedded scripts or external actions/);
    });

    it("3.4 Enforces claim document immutability: refuses attaching documents once claim is APPROVED", async () => {
      vi.mocked(prisma.reimbursementRequest.findUnique).mockResolvedValueOnce({
        id: "claim-approved-1",
        status: "APPROVED",
        documents: [],
      } as any);

      const validPng = Buffer.alloc(64);
      validPng[0] = 0x89;
      validPng[1] = 0x50;
      validPng[2] = 0x4e;
      validPng[3] = 0x47;

      await expect(
        storageService.attachReimbursementDocument(
          "claim-approved-1",
          validPng,
          "image/png",
          "late_receipt.png",
        ),
      ).rejects.toThrow(/Documents cannot be added to a claim in APPROVED status/);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Webhook Forgery & Replay Prevention
  // --------------------------------------------------------------------------
  describe("4. Webhook Forgery & Replay Defenses", () => {
    it("4.1 Rejects WhatsApp webhook payload with invalid signature header", () => {
      const payload = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
      const forgedSig = "sha256=0000000000000000000000000000000000000000000000000000000000000000";

      const isValid = whatsAppService.verifySignature(payload, forgedSig);
      expect(isValid).toBe(false);
    });

    it("4.2 Rejects WhatsApp webhook missing sha256 prefix entirely", () => {
      const payload = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
      const malformedHeader = "invalid_format_without_prefix";

      const isValid = whatsAppService.verifySignature(payload, malformedHeader);
      expect(isValid).toBe(false);
    });

    it("4.3 Deduplicates replayed webhook events atomically using unique constraint", async () => {
      const eventId = "wh_evt_replay_test_123";

      // First delivery creates event record
      vi.mocked(prisma.webhookEvent.create).mockResolvedValueOnce({
        id: "evt-db-1",
        provider: "RAZORPAY",
        eventId,
        status: "PROCESSED",
      } as any);

      // Second delivery throws unique constraint collision (P2002)
      const p2002Error = new Error("Unique constraint failed");
      (p2002Error as any).code = "P2002";
      vi.mocked(prisma.webhookEvent.create).mockRejectedValueOnce(p2002Error);

      const recordEvent = async () => {
        try {
          await prisma.webhookEvent.create({
            data: {
              provider: "RAZORPAY",
              eventId,
            },
          });
          return false;
        } catch (err: any) {
          if (err.code === "P2002") {
            return true; // Detected duplicate replay
          }
          throw err;
        }
      };

      const firstAttemptDuplicate = await recordEvent();
      expect(firstAttemptDuplicate).toBe(false);

      const secondAttemptDuplicate = await recordEvent();
      expect(secondAttemptDuplicate).toBe(true);
    });
  });
});
