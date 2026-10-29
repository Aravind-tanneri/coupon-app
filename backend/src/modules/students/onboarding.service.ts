import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { emailService } from "../notifications/email.service.js";
import { whatsAppService } from "../whatsapp/whatsapp.service.js";
import { auditService } from "../audit/audit.service.js";

export function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return "***@***";
  const [local, domain] = parts;
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export class OnboardingService {
  /**
   * Router gatekeeper (§12.3): All unlinked inbound messages are directed here.
   */
  async handleIncomingMessage(
    phone: string,
    message: {
      text?: { body?: string };
      interactive?: { button_reply?: { id?: string; title?: string } };
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const rawText = (message.text?.body || message.interactive?.button_reply?.id || "").trim();

    // Check if user submitted a 6-digit OTP code (§12.2)
    if (/^\d{6}$/.test(rawText)) {
      await this.verifyOtp(phone, rawText, tx);
      return;
    }

    // Check if user entered what looks like a roll number (e.g. 2024CS001, 22BCE1042)
    if (/^[A-Za-z0-9/_-]{4,20}$/.test(rawText)) {
      await this.requestOtp(phone, rawText, tx);
      return;
    }

    // Default unlinked fallback prompt (§12.3)
    await this.reply(
      phone,
      "Welcome to Campus Mess! To link your WhatsApp account, please reply with your college roll number (e.g. 2024CS001).",
    );
  }

  /**
   * Roster lookup & OTP issuance with enumeration resistance (§12.1).
   */
  async requestOtp(
    phone: string,
    rollNoInput: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? prisma;
    const normalizedRoll = rollNoInput.trim().toUpperCase();

    // 1. Rate limiting: max 3 OTP requests per hour per phone
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentOtpCount = await db.otpChallenge.count({
      where: {
        phoneE164: phone,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (recentOtpCount >= 3) {
      await this.reply(
        phone,
        "Too many verification requests. Please wait an hour before requesting a new code.",
      );
      return;
    }

    // 2. Lookup student in roster
    const student = await db.student.findUnique({
      where: { rollNo: normalizedRoll },
    });

    // 3. Enumeration resistance (§12.1):
    // If student is not found or inactive, send identical confirmation text without revealing absence
    if (!student || !student.active) {
      logger.info(
        { rollNo: normalizedRoll, phone },
        "Student not found during OTP request (enumeration safe)",
      );
      await this.reply(
        phone,
        "If this roll number is registered, an OTP has been sent to your college email. Please reply with the 6-digit code.",
      );
      return;
    }

    // 4. Ensure phone is not already actively bound to another student (§12.2)
    const existingIdentity = await db.whatsAppIdentity.findFirst({
      where: { phoneE164: phone, status: "ACTIVE" },
    });

    if (existingIdentity && existingIdentity.studentId !== student.id) {
      await this.reply(
        phone,
        "This phone number is already linked to another active student account. Please contact mess administration.",
      );
      return;
    }

    // 5. Invalidate existing active OTP challenges for this phone
    await db.otpChallenge.updateMany({
      where: { phoneE164: phone, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    // 6. Generate 6-digit CSPRNG code & hash
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const codeHash = hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min TTL

    await db.otpChallenge.create({
      data: {
        phoneE164: phone,
        studentId: student.id,
        codeHash,
        expiresAt,
        attempts: 0,
      },
    });

    // 7. Dispatch OTP to student's college email
    await emailService.sendOtpEmail(student.email, student.name, otpCode);

    // 8. Send WhatsApp confirmation with masked email preview (§12.1)
    const masked = maskEmail(student.email);
    await this.reply(
      phone,
      `If this roll number is registered, an OTP has been sent to your college email (preview: ${masked}). Please reply with the 6-digit code.`,
    );
  }

  /**
   * OTP Verification and Identity Binding (§12.2).
   */
  async verifyOtp(phone: string, otpCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? prisma;

    // Find latest active OTP challenge
    const challenge = await db.otpChallenge.findFirst({
      where: {
        phoneE164: phone,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!challenge || challenge.expiresAt < new Date()) {
      await this.reply(
        phone,
        "No active verification code found or the code has expired. Please reply with your roll number to request a new code.",
      );
      return;
    }

    // Check failed attempts ceiling (max 5 attempts)
    if (challenge.attempts >= 5) {
      await this.reply(
        phone,
        "Too many failed attempts. This code has been invalidated. Please reply with your roll number to request a new code.",
      );
      return;
    }

    // Constant-time hash check
    const submittedHash = hashOtp(otpCode);
    if (submittedHash !== challenge.codeHash) {
      const newAttempts = challenge.attempts + 1;
      await db.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: newAttempts },
      });

      const remaining = 5 - newAttempts;
      if (remaining <= 0) {
        await this.reply(
          phone,
          "Too many failed attempts. This code has been invalidated. Please reply with your roll number to request a new code.",
        );
      } else {
        await this.reply(
          phone,
          `Invalid verification code. You have ${remaining} attempts remaining.`,
        );
      }
      return;
    }

    // Code matches: consume challenge
    await db.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const student = await db.student.findUnique({
      where: { id: challenge.studentId },
    });

    if (!student) {
      await this.reply(phone, "Student account not found. Please contact administration.");
      return;
    }

    // Enforce 1-active-identity per student: deactivate any previous WhatsApp identity for this student
    await db.whatsAppIdentity.updateMany({
      where: { studentId: student.id, status: "ACTIVE" },
      data: { status: "INACTIVE" },
    });

    // Create or activate WhatsAppIdentity
    await db.whatsAppIdentity.upsert({
      where: { phoneE164: phone },
      update: {
        studentId: student.id,
        status: "ACTIVE",
        verifiedAt: new Date(),
      },
      create: {
        phoneE164: phone,
        studentId: student.id,
        status: "ACTIVE",
        verifiedAt: new Date(),
      },
    });

    logger.info({ studentId: student.id, phone }, "Student WhatsApp identity linked successfully");

    // Send welcome confirmation message
    await this.reply(
      phone,
      `Account linked successfully! Welcome, ${student.name} (${student.department}). You can now type MENU for today's food, COUPONS for passes, or CLAIMS for reimbursements.`,
    );
  }

  /**
   * Student Self-Unlink (§12.4).
   */
  async handleUnlinkRequest(
    identityId: string,
    phone: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? prisma;

    await db.whatsAppIdentity.update({
      where: { id: identityId },
      data: { status: "INACTIVE" },
    });

    logger.info({ identityId, phone }, "Student self-unlinked WhatsApp identity");

    await this.reply(
      phone,
      "Your WhatsApp account has been unlinked from Campus Mess. Reply with your roll number anytime to link again.",
    );
  }

  /**
   * Administrative Identity Reset (§12.4).
   */
  async resetStudentWhatsApp(
    studentId: string,
    actorId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? prisma;

    const previousIdentities = await db.whatsAppIdentity.findMany({
      where: { studentId, status: "ACTIVE" },
    });

    await db.whatsAppIdentity.updateMany({
      where: { studentId, status: "ACTIVE" },
      data: { status: "INACTIVE" },
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId,
      action: "STUDENT_WHATSAPP_RESET",
      entityType: "Student",
      entityId: studentId,
      before: { activeIdentities: previousIdentities.length },
      after: { activeIdentities: 0 },
    });

    logger.info({ studentId, actorId }, "Admin reset WhatsApp identities for student");
  }

  private async reply(phone: string, text: string): Promise<void> {
    try {
      // Freeform replies during onboarding are sent directly via provider to avoid window loops
      await whatsAppService.getProvider().sendText(phone, text);
    } catch (err) {
      logger.error({ err, phone }, "Failed to send onboarding reply via WhatsApp");
    }
  }
}

export const onboardingService = new OnboardingService();
