import { Prisma, FeedbackCategory } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { feedbackService } from "../../feedback/feedback.service.js";
import { parseDateIST, getTodayISTString, formatDisplayDateIST } from "../../../lib/dates-ist.js";

export interface WorkflowReply {
  text: string;
  buttons?: Array<{ id: string; title: string }>;
}

export interface FeedbackDraftData {
  category?: FeedbackCategory;
  rating?: number;
  message?: string;
  isAnonymous?: boolean;
}

export const CATEGORY_DISPLAY_NAMES: Record<FeedbackCategory, string> = {
  FOOD_QUALITY: "🍲 Food Quality",
  MENU: "📋 Menu Variety",
  SERVICE: "🤝 Service & Hygiene",
  OTHER: "💬 General / Other",
};

export const FEEDBACK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle timeout (§9)
export const MAX_DAILY_FEEDBACK = 5;

export class FeedbackWorkflow {
  /**
   * Starts feedback flow or stages free-text feedback from Gemini (§14, §17.1, §17.2).
   * Daily limit check: max 5 items per student per day.
   */
  async startFeedback(
    identityId: string,
    studentId: string,
    messId: string,
    initialData?: {
      category?: FeedbackCategory;
      message?: string;
      rating?: number;
    },
  ): Promise<WorkflowReply> {
    // 1. Enforce daily limit (5 feedback items per student per day §14)
    const todayStart = parseDateIST(getTodayISTString());
    const countToday = await prisma.feedback.count({
      where: {
        studentId,
        createdAt: { gte: todayStart },
      },
    });

    if (countToday >= MAX_DAILY_FEEDBACK) {
      return {
        text: "⚠️ *Daily Feedback Limit Reached*\n\nYou have already submitted 5 feedback entries today. Thank you for your suggestions! You can submit more feedback tomorrow.",
        buttons: [{ id: "MENU_MAIN", title: "Main Menu" }],
      };
    }

    // 2. Clear any stale active feedback conversation
    await prisma.conversation.updateMany({
      where: { identityId, workflow: "FEEDBACK", status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + FEEDBACK_TIMEOUT_MS);

    // 3. Free-text feedback staging (§17.2)
    // If category and message were extracted, stage the draft and ask for confirmation
    if (initialData?.category && initialData?.message) {
      const data: FeedbackDraftData = {
        category: initialData.category,
        message: initialData.message,
        rating: initialData.rating ?? 3,
      };

      await prisma.conversation.create({
        data: {
          identityId,
          workflow: "FEEDBACK",
          step: "AWAITING_CONFIRMATION",
          data: data as unknown as Prisma.InputJsonValue,
          expiresAt,
          status: "ACTIVE",
          version: 1,
        },
      });

      const catLabel = data.category ? CATEGORY_DISPLAY_NAMES[data.category] : "💬 General";
      const stars = "⭐".repeat(data.rating ?? 3);

      return {
        text: [
          "📝 *Stage Feedback Submission*",
          `\nCategory: *${catLabel}*`,
          `Rating: *${stars}*`,
          `Feedback: "${data.message}"`,
          "\nWould you like to submit this feedback to mess management?",
        ].join("\n"),
        buttons: [
          { id: "FEEDBACK_SUBMIT", title: "Confirm & Submit" },
          { id: "FEEDBACK_CANCEL", title: "Cancel" },
        ],
      };
    }

    // 4. Interactive guided start (§17.1)
    await prisma.conversation.create({
      data: {
        identityId,
        workflow: "FEEDBACK",
        step: "AWAITING_CATEGORY",
        data: {} as unknown as Prisma.InputJsonValue,
        expiresAt,
        status: "ACTIVE",
        version: 1,
      },
    });

    return {
      text: "📝 *Mess Feedback & Suggestions*\n\nPlease select the category of your feedback:",
      buttons: [
        { id: "FB_CAT:FOOD_QUALITY", title: "Food Quality" },
        { id: "FB_CAT:MENU", title: "Menu Variety" },
        { id: "FB_CAT:SERVICE", title: "Service & Staff" },
      ],
    };
  }

  /**
   * Handles inbound text or interactive action in feedback flow (§17).
   */
  async handleInbound(
    identityId: string,
    studentId: string,
    messId: string,
    input: { text?: string; actionId?: string },
  ): Promise<WorkflowReply> {
    const action = input.actionId;
    const rawText = input.text?.trim() || "";
    const upperText = rawText.toUpperCase();

    // 1. Global cancel
    if (
      action === "FEEDBACK_CANCEL" ||
      upperText === "CANCEL" ||
      upperText === "STOP" ||
      upperText === "RESTART"
    ) {
      await prisma.conversation.updateMany({
        where: { identityId, workflow: "FEEDBACK", status: "ACTIVE" },
        data: { status: "CANCELLED" },
      });
      return {
        text: "❌ *Feedback Cancelled*\n\nYour feedback draft has been discarded.",
        buttons: [{ id: "MENU_MAIN", title: "Main Menu" }],
      };
    }

    // 2. Load active feedback conversation
    const conversation = await prisma.conversation.findFirst({
      where: { identityId, workflow: "FEEDBACK", status: "ACTIVE" },
    });

    const now = new Date();

    if (!conversation) {
      return this.startFeedback(identityId, studentId, messId);
    }

    if (conversation.expiresAt < now) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "EXPIRED" },
      });
      return {
        text: "⏱️ *Session Expired*\n\nYour feedback session expired due to inactivity. Tap below to start fresh:",
        buttons: [{ id: "FEEDBACK_START", title: "New Feedback" }],
      };
    }

    const data = (conversation.data ?? {}) as unknown as FeedbackDraftData;
    const expiresAt = new Date(now.getTime() + FEEDBACK_TIMEOUT_MS);

    // 3. Step Machine
    switch (conversation.step) {
      case "AWAITING_CATEGORY": {
        let category: FeedbackCategory = "OTHER";
        if (action?.startsWith("FB_CAT:")) {
          category = action.split(":")[1] as FeedbackCategory;
        } else if (upperText.includes("FOOD")) {
          category = "FOOD_QUALITY";
        } else if (upperText.includes("MENU")) {
          category = "MENU";
        } else if (upperText.includes("SERVICE") || upperText.includes("HYGIENE")) {
          category = "SERVICE";
        }

        data.category = category;
        const nextStep = "AWAITING_RATING";

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            step: nextStep,
            data: data as unknown as Prisma.InputJsonValue,
            expiresAt,
            version: { increment: 1 },
          },
        });

        return {
          text: `Selected: *${CATEGORY_DISPLAY_NAMES[category]}*\n\nHow would you rate your overall experience (1 to 5 stars)?`,
          buttons: [
            { id: "FB_RATE:1", title: "⭐ 1 Star" },
            { id: "FB_RATE:3", title: "⭐⭐⭐ 3 Stars" },
            { id: "FB_RATE:5", title: "⭐⭐⭐⭐⭐ 5 Stars" },
          ],
        };
      }

      case "AWAITING_RATING": {
        let rating = 3;
        if (action?.startsWith("FB_RATE:")) {
          rating = Number(action.split(":")[1]) || 3;
        } else {
          const num = parseInt(rawText, 10);
          if (!isNaN(num) && num >= 1 && num <= 5) {
            rating = num;
          }
        }

        data.rating = rating;
        const nextStep = "AWAITING_MESSAGE";

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            step: nextStep,
            data: data as unknown as Prisma.InputJsonValue,
            expiresAt,
            version: { increment: 1 },
          },
        });

        return {
          text: "📝 *Feedback Remarks*\n\nPlease describe your comments, suggestions, or concerns (up to 1000 characters):",
          buttons: [{ id: "FEEDBACK_CANCEL", title: "Cancel" }],
        };
      }

      case "AWAITING_MESSAGE": {
        if (rawText.length < 3) {
          return {
            text: "⚠️ Please enter at least 3 characters describing your feedback:",
            buttons: [{ id: "FEEDBACK_CANCEL", title: "Cancel" }],
          };
        }

        data.message = rawText.slice(0, 1000);
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

        const catLabel = CATEGORY_DISPLAY_NAMES[data.category || "OTHER"];
        const stars = "⭐".repeat(data.rating || 3);

        return {
          text: [
            "📋 *Review Feedback Before Submission*",
            `\nCategory: *${catLabel}*`,
            `Rating: *${stars}*`,
            `Message: "${data.message}"`,
            "\nTap *Confirm & Submit* to record your feedback with the mess supervisor.",
          ].join("\n"),
          buttons: [
            { id: "FEEDBACK_SUBMIT", title: "Confirm & Submit" },
            { id: "FEEDBACK_CANCEL", title: "Cancel" },
          ],
        };
      }

      case "AWAITING_CONFIRMATION": {
        // AC (§17.1, §17.2): Submission requires explicit button confirmation
        if (action === "FEEDBACK_SUBMIT") {
          await feedbackService.submitFeedback({
            studentId,
            messId,
            category: data.category || "OTHER",
            message: data.message || "Feedback submitted via WhatsApp",
            rating: data.rating,
            isAnonymous: data.isAnonymous ?? false,
          });

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: "COMPLETED", step: "SUBMITTED" },
          });

          return {
            text: "✅ *Feedback Received!*\n\nThank you for sharing your thoughts. Dining hall management reviews all feedback daily to maintain food quality and cleanliness standards.",
            buttons: [{ id: "MENU_MAIN", title: "Main Menu" }],
          };
        }

        return {
          text: "⚠️ Please tap *Confirm & Submit* below to send your feedback, or *Cancel* to discard:",
          buttons: [
            { id: "FEEDBACK_SUBMIT", title: "Confirm & Submit" },
            { id: "FEEDBACK_CANCEL", title: "Cancel" },
          ],
        };
      }

      default:
        return this.startFeedback(identityId, studentId, messId);
    }
  }

  /**
   * Retrieves active announcements for mess (§17.3).
   */
  async getAnnouncements(messId: string): Promise<WorkflowReply> {
    const now = new Date();

    const announcements = await prisma.announcement.findMany({
      where: {
        OR: [{ messId }, { messId: null }],
        publishAt: { lte: now },
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }],
      },
      orderBy: { publishAt: "desc" },
      take: 5,
    });

    if (announcements.length === 0) {
      return {
        text: "📢 *Mess Announcements*\n\nThere are no active notices or announcements at this time.",
        buttons: [{ id: "MENU_MAIN", title: "Main Menu" }],
      };
    }

    const lines: string[] = ["📢 *Campus Mess Announcements*\n"];

    for (const a of announcements) {
      const dateStr = formatDisplayDateIST(a.publishAt);
      lines.push(`📌 *${a.title}* (${dateStr})`);
      lines.push(`${a.body}\n`);
    }

    lines.push("_Reply MENU to view dining options._");

    return {
      text: lines.join("\n").trim(),
      buttons: [
        { id: "MENU_TODAY", title: "Today's Menu" },
        { id: "MENU_MAIN", title: "Main Menu" },
      ],
    };
  }
}

export const feedbackWorkflow = new FeedbackWorkflow();
