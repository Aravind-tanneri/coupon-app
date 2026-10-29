import { describe, it, expect, vi, beforeEach } from "vitest";
import { onboardingService, maskEmail, hashOtp } from "./onboarding.service.js";
import { prisma } from "../../lib/prisma.js";
import { emailService } from "../notifications/email.service.js";
import { whatsAppService } from "../whatsapp/whatsapp.service.js";
import { auditService } from "../audit/audit.service.js";
import { FakeWhatsAppProvider } from "../whatsapp/fake-whatsapp.provider.js";

vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      student: {
        findUnique: vi.fn(),
      },
      otpChallenge: {
        count: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      whatsAppIdentity: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === "function") {
          return cb(prisma);
        }
        return Promise.all(cb);
      }),
    },
  };
});

vi.mock("../notifications/email.service.js", () => {
  return {
    emailService: {
      sendOtpEmail: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../audit/audit.service.js", () => {
  return {
    auditService: {
      log: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  };
});

describe("Phase 12: Student Identity Linking & Onboarding", () => {
  let fakeProvider: FakeWhatsAppProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeProvider = new FakeWhatsAppProvider();
    whatsAppService.setProvider(fakeProvider);
  });

  describe("Email Masking Utility", () => {
    it("masks email addresses correctly", () => {
      expect(maskEmail("rahul.sharma@college.edu")).toBe("r***a@college.edu");
      expect(maskEmail("ananya@institute.ac.in")).toBe("a***a@institute.ac.in");
      expect(maskEmail("ab@college.edu")).toBe("a***@college.edu");
      expect(maskEmail("a@college.edu")).toBe("a***@college.edu");
      expect(maskEmail("invalid-email")).toBe("***@***");
    });
  });

  describe("Roster Lookup & OTP Issue (§12.1)", () => {
    it("issues OTP and emails code for registered active student", async () => {
      vi.mocked(prisma.otpChallenge.count).mockResolvedValue(0);
      vi.mocked(prisma.student.findUnique).mockResolvedValue({
        id: "stud-1",
        rollNo: "2024CS001",
        name: "Rahul Sharma",
        email: "rahul.sharma@college.edu",
        department: "Computer Science",
        messId: "akshaya",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.whatsAppIdentity.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.otpChallenge.create).mockResolvedValue({
        id: "otp-1",
      } as never);

      await onboardingService.requestOtp("+919876543210", "2024CS001");

      expect(prisma.otpChallenge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phoneE164: "+919876543210",
            studentId: "stud-1",
            attempts: 0,
          }),
        }),
      );

      expect(emailService.sendOtpEmail).toHaveBeenCalledWith(
        "rahul.sharma@college.edu",
        "Rahul Sharma",
        expect.stringMatching(/^\d{6}$/),
      );

      const sent = fakeProvider.getLastMessage();
      expect(sent?.to).toBe("+919876543210");
      expect(sent?.payload["text"]).toContain("r***a@college.edu");
      expect(sent?.payload["text"]).toContain("reply with the 6-digit code");
    });

    it("resists enumeration: sends generic response when roll number does not exist", async () => {
      vi.mocked(prisma.otpChallenge.count).mockResolvedValue(0);
      vi.mocked(prisma.student.findUnique).mockResolvedValue(null);

      await onboardingService.requestOtp("+919876543210", "UNKNOWN_ROLL");

      expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();

      const sent = fakeProvider.getLastMessage();
      expect(sent?.to).toBe("+919876543210");
      expect(sent?.payload["text"]).toContain(
        "If this roll number is registered, an OTP has been sent",
      );
      expect(sent?.payload["text"]).not.toContain("not found");
    });

    it("enforces rate limit: blocks 4th request within 1 hour", async () => {
      vi.mocked(prisma.otpChallenge.count).mockResolvedValue(3);

      await onboardingService.requestOtp("+919876543210", "2024CS001");

      expect(prisma.student.findUnique).not.toHaveBeenCalled();
      expect(prisma.otpChallenge.create).not.toHaveBeenCalled();

      const sent = fakeProvider.getLastMessage();
      expect(sent?.payload["text"]).toContain("Too many verification requests");
    });

    it("refuses linking if phone is already linked to another active student", async () => {
      vi.mocked(prisma.otpChallenge.count).mockResolvedValue(0);
      vi.mocked(prisma.student.findUnique).mockResolvedValue({
        id: "stud-new",
        rollNo: "2024CS002",
        name: "Pooja Patel",
        email: "pooja@college.edu",
        active: true,
      } as never);
      vi.mocked(prisma.whatsAppIdentity.findFirst).mockResolvedValue({
        id: "ident-other",
        studentId: "stud-another-student",
        phoneE164: "+919876543210",
        status: "ACTIVE",
      } as never);

      await onboardingService.requestOtp("+919876543210", "2024CS002");

      expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
      const sent = fakeProvider.getLastMessage();
      expect(sent?.payload["text"]).toContain("already linked to another active student");
    });
  });

  describe("OTP Verification & Identity Binding (§12.2)", () => {
    it("successfully verifies OTP and links identity", async () => {
      const code = "482915";
      const codeHash = hashOtp(code);
      const futureExpiry = new Date(Date.now() + 5 * 60 * 1000);

      vi.mocked(prisma.otpChallenge.findFirst).mockResolvedValue({
        id: "otp-valid",
        phoneE164: "+919876543210",
        studentId: "stud-1",
        codeHash,
        expiresAt: futureExpiry,
        attempts: 1,
        consumedAt: null,
        createdAt: new Date(),
      });

      vi.mocked(prisma.otpChallenge.update).mockResolvedValue({} as never);
      vi.mocked(prisma.student.findUnique).mockResolvedValue({
        id: "stud-1",
        rollNo: "2024CS001",
        name: "Rahul Sharma",
        department: "Computer Science",
      } as never);
      vi.mocked(prisma.whatsAppIdentity.updateMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.whatsAppIdentity.upsert).mockResolvedValue({} as never);

      await onboardingService.verifyOtp("+919876543210", code);

      expect(prisma.otpChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "otp-valid" },
          data: expect.objectContaining({ consumedAt: expect.any(Date) }),
        }),
      );

      expect(prisma.whatsAppIdentity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phoneE164: "+919876543210" },
          create: expect.objectContaining({
            phoneE164: "+919876543210",
            studentId: "stud-1",
            status: "ACTIVE",
          }),
        }),
      );

      const sent = fakeProvider.getLastMessage();
      expect(sent?.payload["text"]).toContain("Account linked successfully");
      expect(sent?.payload["text"]).toContain("Rahul Sharma (Computer Science)");
    });

    it("increments attempt counter on incorrect OTP", async () => {
      const correctHash = hashOtp("654321");
      const futureExpiry = new Date(Date.now() + 5 * 60 * 1000);

      vi.mocked(prisma.otpChallenge.findFirst).mockResolvedValue({
        id: "otp-valid",
        phoneE164: "+919876543210",
        studentId: "stud-1",
        codeHash: correctHash,
        expiresAt: futureExpiry,
        attempts: 2,
        consumedAt: null,
        createdAt: new Date(),
      });
      vi.mocked(prisma.otpChallenge.update).mockResolvedValue({} as never);

      await onboardingService.verifyOtp("+919876543210", "111111");

      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: "otp-valid" },
        data: { attempts: 3 },
      });
      expect(prisma.whatsAppIdentity.upsert).not.toHaveBeenCalled();

      const sent = fakeProvider.getLastMessage();
      expect(sent?.payload["text"]).toContain(
        "Invalid verification code. You have 2 attempts remaining",
      );
    });

    it("locks challenge after 5 failed attempts", async () => {
      const correctHash = hashOtp("654321");
      const futureExpiry = new Date(Date.now() + 5 * 60 * 1000);

      vi.mocked(prisma.otpChallenge.findFirst).mockResolvedValue({
        id: "otp-valid",
        phoneE164: "+919876543210",
        studentId: "stud-1",
        codeHash: correctHash,
        expiresAt: futureExpiry,
        attempts: 5,
        consumedAt: null,
        createdAt: new Date(),
      });

      await onboardingService.verifyOtp("+919876543210", "654321");

      const sent = fakeProvider.getLastMessage();
      expect(sent?.payload["text"]).toContain(
        "Too many failed attempts. This code has been invalidated",
      );
      expect(prisma.whatsAppIdentity.upsert).not.toHaveBeenCalled();
    });

    it("rejects expired OTP challenge", async () => {
      const pastExpiry = new Date(Date.now() - 5 * 60 * 1000);

      vi.mocked(prisma.otpChallenge.findFirst).mockResolvedValue({
        id: "otp-expired",
        phoneE164: "+919876543210",
        studentId: "stud-1",
        codeHash: hashOtp("123456"),
        expiresAt: pastExpiry,
        attempts: 0,
        consumedAt: null,
        createdAt: new Date(),
      });

      await onboardingService.verifyOtp("+919876543210", "123456");

      const sent = fakeProvider.getLastMessage();
      expect(sent?.payload["text"]).toContain(
        "No active verification code found or the code has expired",
      );
      expect(prisma.whatsAppIdentity.upsert).not.toHaveBeenCalled();
    });
  });

  describe("Unlinked User Gatekeeper (§12.3)", () => {
    it("routes unlinked unrecognized messages to roll number prompt", async () => {
      await onboardingService.handleIncomingMessage("+919876543210", {
        text: { body: "Can I see today's menu please?" },
      });

      const sent = fakeProvider.getLastMessage();
      expect(sent?.payload["text"]).toContain("Welcome to Campus Mess");
      expect(sent?.payload["text"]).toContain("reply with your college roll number");
    });
  });

  describe("Unlink & Admin Reset (§12.4)", () => {
    it("allows student to self-unlink via UNLINK command", async () => {
      vi.mocked(prisma.whatsAppIdentity.update).mockResolvedValue({} as never);

      await onboardingService.handleUnlinkRequest("ident-1", "+919876543210");

      expect(prisma.whatsAppIdentity.update).toHaveBeenCalledWith({
        where: { id: "ident-1" },
        data: { status: "INACTIVE" },
      });

      const sent = fakeProvider.getLastMessage();
      expect(sent?.payload["text"]).toContain("Your WhatsApp account has been unlinked");
    });

    it("resets student WhatsApp identity on admin action with audit log", async () => {
      vi.mocked(prisma.whatsAppIdentity.findMany).mockResolvedValue([
        {
          id: "ident-1",
          studentId: "stud-1",
          phoneE164: "+919876543210",
          status: "ACTIVE",
        } as never,
      ]);
      vi.mocked(prisma.whatsAppIdentity.updateMany).mockResolvedValue({ count: 1 });

      await onboardingService.resetStudentWhatsApp("stud-1", "admin-user-1");

      expect(prisma.whatsAppIdentity.updateMany).toHaveBeenCalledWith({
        where: { studentId: "stud-1", status: "ACTIVE" },
        data: { status: "INACTIVE" },
      });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "STUDENT_WHATSAPP_RESET",
          actorId: "admin-user-1",
          entityId: "stud-1",
        }),
      );
    });
  });
});
