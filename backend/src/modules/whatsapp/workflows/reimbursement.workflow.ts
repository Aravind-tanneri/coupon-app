import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { reimbursementService } from "../../reimbursements/reimbursement.service.js";
import { formatDisplayDateIST, parseUserDateInput } from "../../../lib/dates-ist.js";
import { generateNonce } from "../../../lib/tokens.js";
import { maskPayout } from "../../../lib/crypto.js";

export interface WorkflowReply {
  text: string;
  buttons?: Array<{ id: string; title: string }>;
}

export interface ReimbursementDraftData {
  startDate?: string;
  endDate?: string;
  countedDays?: number;
  rateAtClaimPaise?: number;
  claimablePaise?: number;
  reason?: string;
  payoutDetails?: string;
  nonce?: string;
  draftClaimId?: string;
}

export const REIMBURSEMENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle timeout (§9)

export class ReimbursementWorkflow {
  /**
   * Starts or resumes an active reimbursement conversation (§16.1).
   */
  async startOrResume(
    identityId: string,
    studentId: string,
    initialStartDate?: string,
  ): Promise<WorkflowReply> {
    const existing = await prisma.conversation.findFirst({
      where: {
        identityId,
        workflow: "REIMBURSEMENT",
        status: "ACTIVE",
      },
    });

    const now = new Date();

    if (existing) {
      if (existing.expiresAt < now) {
        // Expired conversation: close it out and start fresh
        await prisma.conversation.update({
          where: { id: existing.id },
          data: { status: "EXPIRED" },
        });
      } else {
        // Active and not expired: resume current step
        const data = existing.data as unknown as ReimbursementDraftData;
        return this.renderStepPrompt(existing.step, data, studentId);
      }
    }

    // Create fresh conversation
    const expiresAt = new Date(now.getTime() + REIMBURSEMENT_TIMEOUT_MS);
    const initialData: ReimbursementDraftData = {};

    let initialStep = "AWAITING_START_DATE";

    if (initialStartDate) {
      const parsed = parseUserDateInput(initialStartDate);
      if (parsed) {
        initialData.startDate = parsed;
        initialStep = "AWAITING_END_DATE";
      }
    }

    await prisma.conversation.create({
      data: {
        identityId,
        workflow: "REIMBURSEMENT",
        step: initialStep,
        data: initialData as unknown as Prisma.InputJsonValue,
        expiresAt,
        status: "ACTIVE",
        version: 1,
      },
    });

    return this.renderStepPrompt(initialStep, initialData, studentId);
  }

  /**
   * Processes inbound user action or text message during an active reimbursement flow (§16).
   */
  async handleInbound(
    identityId: string,
    studentId: string,
    input: { text?: string; actionId?: string },
  ): Promise<WorkflowReply> {
    const now = new Date();
    const action = input.actionId;
    const rawText = input.text?.trim() || "";
    const upperText = rawText.toUpperCase();

    // 1. Global escape keywords (§9: "cancel", "menu", "restart")
    if (
      action === "REIMB_CANCEL" ||
      upperText === "CANCEL" ||
      upperText === "STOP" ||
      upperText === "ABORT" ||
      upperText === "RESTART"
    ) {
      await prisma.conversation.updateMany({
        where: { identityId, workflow: "REIMBURSEMENT", status: "ACTIVE" },
        data: { status: "CANCELLED" },
      });
      return {
        text: "❌ *Reimbursement Claim Cancelled*\n\nYour active claim has been cancelled. You can start a new claim anytime by sending *REIMBURSE*.",
        buttons: [{ id: "MENU_MAIN", title: "Main Menu" }],
      };
    }

    // 2. Load active conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        identityId,
        workflow: "REIMBURSEMENT",
        status: "ACTIVE",
      },
    });

    if (!conversation) {
      // No active conversation: start fresh
      return this.startOrResume(identityId, studentId);
    }

    // Check expiry
    if (conversation.expiresAt < now) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "EXPIRED" },
      });
      return {
        text: "⏱️ *Session Expired*\n\nYour reimbursement claim session expired due to 30 minutes of inactivity. Tap below to start a new claim:",
        buttons: [{ id: "REIMB_START", title: "New Claim" }],
      };
    }

    const data = (conversation.data ?? {}) as unknown as ReimbursementDraftData;
    const expiresAt = new Date(now.getTime() + REIMBURSEMENT_TIMEOUT_MS);

    // 3. Step Machine Dispatcher
    switch (conversation.step) {
      case "AWAITING_START_DATE": {
        const dateInput = rawText;
        const parsed = parseUserDateInput(dateInput);

        if (!parsed) {
          return {
            text: "⚠️ *Invalid Date Format*\n\nPlease enter a valid departure date (e.g. *10 Oct*, *10/10/2026*, or *2026-10-10*):",
            buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
          };
        }

        data.startDate = parsed;
        const nextStep = "AWAITING_END_DATE";

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            step: nextStep,
            data: data as unknown as Prisma.InputJsonValue,
            expiresAt,
            version: { increment: 1 },
          },
        });

        return this.renderStepPrompt(nextStep, data, studentId);
      }

      case "AWAITING_END_DATE": {
        const dateInput = rawText;
        const parsed = parseUserDateInput(dateInput);

        if (!parsed) {
          return {
            text: "⚠️ *Invalid Date Format*\n\nPlease enter a valid return date (e.g. *17 Oct*, *17/10/2026*, or *2026-10-17*):",
            buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
          };
        }

        if (parsed <= (data.startDate ?? "")) {
          return {
            text: `⚠️ *Invalid Return Date*\n\nYour return date must be strictly after your departure date (*${formatDisplayDateIST(data.startDate!)}*).\n\nPlease enter your return date:`,
            buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
          };
        }

        // Run authoritative backend calculation (§16.3)
        const calc = await reimbursementService.calculateForStudent(
          studentId,
          data.startDate!,
          parsed,
        );

        if (!calc.eligible) {
          return {
            text: [
              `⚠️ *Claim Not Eligible*`,
              `\n${calc.message || "Your selected absence dates do not meet the campus reimbursement policy."}`,
              `\n• Departure: *${formatDisplayDateIST(data.startDate!)}*`,
              `• Return: *${formatDisplayDateIST(parsed)}*`,
              `• Counted days: *${calc.countedDays}*`,
              `\nTap *Start Over* to try different dates, or *Cancel* to exit.`,
            ].join("\n"),
            buttons: [
              { id: "REIMB_START", title: "Start Over" },
              { id: "REIMB_CANCEL", title: "Cancel" },
            ],
          };
        }

        // Save backend draft claim
        const draft = await reimbursementService.saveDraft(studentId, {
          startDate: data.startDate!,
          endDate: parsed,
        });

        data.endDate = parsed;
        data.countedDays = calc.countedDays;
        data.rateAtClaimPaise = calc.rateAtClaimPaise;
        data.claimablePaise = calc.claimablePaise;
        data.draftClaimId = draft.id;

        const nextStep = "SHOW_CALCULATION";

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            step: nextStep,
            data: data as unknown as Prisma.InputJsonValue,
            expiresAt,
            version: { increment: 1 },
          },
        });

        return this.renderStepPrompt(nextStep, data, studentId);
      }

      case "SHOW_CALCULATION": {
        if (action === "REIMB_CONTINUE" || upperText === "CONTINUE" || upperText === "NEXT") {
          const nextStep = "AWAITING_REASON";
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              step: nextStep,
              expiresAt,
              version: { increment: 1 },
            },
          });
          return this.renderStepPrompt(nextStep, data, studentId);
        }

        return this.renderStepPrompt("SHOW_CALCULATION", data, studentId);
      }

      case "AWAITING_REASON": {
        if (rawText.length < 3) {
          return {
            text: "⚠️ Please enter a clear reason for your absence (at least 3 characters, e.g. Vacation, Sick Leave, Family Function):",
            buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
          };
        }

        data.reason = rawText;
        const nextStep = "AWAITING_PAYOUT_DETAILS";

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            step: nextStep,
            data: data as unknown as Prisma.InputJsonValue,
            expiresAt,
            version: { increment: 1 },
          },
        });

        return this.renderStepPrompt(nextStep, data, studentId);
      }

      case "AWAITING_PAYOUT_DETAILS": {
        if (rawText.length < 4) {
          return {
            text: "⚠️ Please enter a valid UPI ID (e.g. name@okaxis) or Bank details for reimbursement transfer:",
            buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
          };
        }

        data.payoutDetails = rawText;

        // Save updated draft with reason and encrypted payout
        if (data.draftClaimId && data.startDate && data.endDate) {
          await reimbursementService.saveDraft(studentId, {
            startDate: data.startDate,
            endDate: data.endDate,
            reason: data.reason,
            payoutDetails: data.payoutDetails,
          });
        }

        // Generate single-use server nonce for submission (§16.5)
        const submitNonce = generateNonce("submit");
        data.nonce = submitNonce;
        const nextStep = "AWAITING_CONFIRMATION";

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            step: nextStep,
            data: data as unknown as Prisma.InputJsonValue,
            expiresAt,
            version: { increment: 1 },
          },
        });

        return this.renderStepPrompt(nextStep, data, studentId);
      }

      case "AWAITING_CONFIRMATION": {
        // STRICT SECURITY CONTROL (§16.5):
        // A typed "yes" or "submit" does NOT submit. Only the button callback carrying the nonce submits!
        if (action && action.startsWith("REIMB_SUBMIT:")) {
          const submittedNonce = action.split(":")[1];
          const expectedNonce = data.nonce ? data.nonce.split(":")[1] : null;

          if (!submittedNonce || submittedNonce !== expectedNonce) {
            return {
              text: "⚠️ This submission link has expired or has already been used. Please check your claims status or submit a new claim.",
              buttons: [{ id: "MY_CLAIMS", title: "My Claims" }],
            };
          }

          // Invalidate nonce to guarantee single-use
          data.nonce = undefined;

          // Autoritative submission via service
          const submitted = await reimbursementService.submitClaim(studentId, data.draftClaimId);

          // Mark conversation COMPLETED
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              status: "COMPLETED",
              step: "SUBMITTED",
              data: data as unknown as Prisma.InputJsonValue,
            },
          });

          const amountRupees = (submitted.claimedAmountPaise / 100).toFixed(2);

          return {
            text: [
              `✅ *Claim Submitted Successfully!*`,
              `\nReference: *\`${submitted.publicRef}\`*`,
              `Amount: *₹${amountRupees}*`,
              `Status: *🟡 SUBMITTED*`,
              `\nYour claim has been submitted to mess management for verification. You will be notified when it is reviewed.`,
            ].join("\n"),
            buttons: [
              { id: "MY_CLAIMS", title: "My Claims" },
              { id: "MENU_MAIN", title: "Main Menu" },
            ],
          };
        }

        // If user sent free text instead of clicking button:
        return {
          text: "⚠️ *Confirmation Required*\n\nPlease tap the *Submit Claim* button below to confirm your claim submission:",
          buttons: [
            { id: `REIMB_SUBMIT:${data.nonce?.split(":")[1] || "invalid"}`, title: "Submit Claim" },
            { id: "REIMB_CANCEL", title: "Cancel" },
          ],
        };
      }

      default:
        return this.startOrResume(identityId, studentId);
    }
  }

  /**
   * Formats review screen, calculation screen, or step prompt based on current state (§3, §9).
   */
  private async renderStepPrompt(
    step: string,
    data: ReimbursementDraftData,
    studentId: string,
  ): Promise<WorkflowReply> {
    switch (step) {
      case "AWAITING_START_DATE":
        return {
          text: [
            "📅 *Absence Reimbursement Claim*",
            "\nPlease enter your *departure date* (the date you left campus).",
            "_Examples: 10 Oct, 10/10/2026, 2026-10-10_",
            "\n_Type CANCEL at any time to abort._",
          ].join("\n"),
          buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
        };

      case "AWAITING_END_DATE":
        return {
          text: [
            "📅 *Absence Return Date*",
            `\nDeparture date: *${data.startDate ? formatDisplayDateIST(data.startDate) : "Set"}*`,
            "\nPlease enter your *return date* (the date you return to campus):",
            "\n_Note: Per institution policy, both departure and return dates are excluded from the rebate calculation._",
          ].join("\n"),
          buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
        };

      case "SHOW_CALCULATION": {
        const startStr = data.startDate ? formatDisplayDateIST(data.startDate) : "";
        const endStr = data.endDate ? formatDisplayDateIST(data.endDate) : "";
        const rateRs = ((data.rateAtClaimPaise ?? 0) / 100).toFixed(0);
        const claimRs = ((data.claimablePaise ?? 0) / 100).toFixed(2);

        return {
          text: [
            "💰 *CLAIM CALCULATION*",
            `Away: ${startStr} – ${endStr}`,
            `Days counted: ${data.countedDays} (departure and return days excluded)`,
            `Rate: ₹${rateRs}/day`,
            `Estimated claim: ₹${claimRs}`,
          ].join("\n"),
          buttons: [
            { id: "REIMB_CONTINUE", title: "Continue" },
            { id: "REIMB_CANCEL", title: "Cancel" },
          ],
        };
      }

      case "AWAITING_REASON":
        return {
          text: "📝 *Reason for Absence*\n\nPlease state the reason for your absence (e.g. Vacation, Sick leave, Academic project, Family event):",
          buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
        };

      case "AWAITING_PAYOUT_DETAILS":
        return {
          text: [
            "💳 *Payout Details*",
            "\nPlease enter your *UPI ID* (e.g., student@upi) or Bank Account & IFSC details for the reimbursement payout.",
            "\n_🔒 Details are securely encrypted at rest._",
          ].join("\n"),
          buttons: [{ id: "REIMB_CANCEL", title: "Cancel" }],
        };

      case "AWAITING_CONFIRMATION": {
        const student = await prisma.student.findUnique({
          where: { id: studentId },
          include: { mess: true },
        });

        const startStr = data.startDate ? formatDisplayDateIST(data.startDate) : "";
        const endStr = data.endDate ? formatDisplayDateIST(data.endDate) : "";
        const rateRs = ((data.rateAtClaimPaise ?? 0) / 100).toFixed(0);
        const claimRs = ((data.claimablePaise ?? 0) / 100).toFixed(2);
        const masked = data.payoutDetails ? maskPayout(data.payoutDetails) : "****";

        const submitNonce = data.nonce ? data.nonce.split(":")[1] : "nonce";

        return {
          text: [
            "📋 *REVIEW YOUR CLAIM*",
            `Away: ${startStr} – ${endStr}`,
            `Days counted: ${data.countedDays}`,
            `Rate: ₹${rateRs}/day`,
            `Claimed amount: ₹${claimRs}`,
            `Department: ${student?.department ?? "N/A"}`,
            `Roll No: ${student?.rollNo ?? "N/A"}`,
            `Mess: ${student?.mess?.name ?? "Akshaya"}`,
            `Reason: ${data.reason ?? "N/A"}`,
            `Payout: ${masked}`,
            "\n_Tap 'Submit Claim' below to finalize your claim submission._",
          ].join("\n"),
          buttons: [
            { id: `REIMB_SUBMIT:${submitNonce}`, title: "Submit Claim" },
            { id: "REIMB_CANCEL", title: "Cancel" },
          ],
        };
      }

      default:
        return {
          text: "Select an option:",
          buttons: [{ id: "MENU_MAIN", title: "Main Menu" }],
        };
    }
  }

  /**
   * Shows a student's existing claims and highlights any claims requiring info (§16.6).
   */
  async listMyClaims(studentId: string): Promise<WorkflowReply> {
    const claims = await prisma.reimbursementRequest.findMany({
      where: {
        studentId,
        status: { not: "DRAFT" },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    if (claims.length === 0) {
      return {
        text: "📋 *My Reimbursement Claims*\n\nYou have no submitted claims on file.\n\nTap below to file a new absence reimbursement claim.",
        buttons: [{ id: "REIMB_START", title: "File New Claim" }],
      };
    }

    const lines: string[] = ["📋 *My Reimbursement Claims*\n"];

    for (const c of claims) {
      const startStr = formatDisplayDateIST(c.startDate);
      const endStr = formatDisplayDateIST(c.endDate);
      const amountRs = (c.claimedAmountPaise / 100).toFixed(2);
      const badge = this.formatStatusBadge(c.status);

      lines.push(
        `• *\`${c.publicRef}\`*: ${startStr} – ${endStr}\n   Amount: *₹${amountRs}* | ${badge}`,
      );

      if (c.status === "INFO_REQUESTED") {
        lines.push(
          `   ⚠️ *Action Required*: Mess admin requested more info: "${c.rejectionReason || "Please provide supporting details."}"`,
        );
      }
    }

    lines.push("\n_Reply REIMBURSE to file a new claim._");

    return {
      text: lines.join("\n"),
      buttons: [
        { id: "REIMB_START", title: "File New Claim" },
        { id: "MENU_MAIN", title: "Main Menu" },
      ],
    };
  }

  private formatStatusBadge(status: string): string {
    switch (status) {
      case "SUBMITTED":
        return "🟡 Submitted";
      case "UNDER_REVIEW":
        return "🔵 Under Review";
      case "APPROVED":
        return "🟢 Approved";
      case "REJECTED":
        return "🔴 Rejected";
      case "INFO_REQUESTED":
        return "🟠 Info Requested";
      case "PAID":
        return "✅ Paid";
      default:
        return status;
    }
  }
}

export const reimbursementWorkflow = new ReimbursementWorkflow();
