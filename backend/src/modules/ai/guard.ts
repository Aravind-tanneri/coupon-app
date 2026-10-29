import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { TooManyRequestsError } from "../../lib/errors.js";

export const MAX_INPUT_LENGTH = 500;
export const MAX_CALLS_PER_STUDENT_PER_HOUR = 20;

export interface FallbackMenuPayload {
  bodyText: string;
  buttons: Array<{ id: string; title: string }>;
}

export class AiGuard {
  /**
   * Truncates input to 500 characters (§13.5).
   */
  truncateInput(input: string): string {
    if (input.length <= MAX_INPUT_LENGTH) {
      return input;
    }
    logger.info(
      { originalLength: input.length },
      "AI input exceeded 500 characters and was truncated",
    );
    return input.slice(0, MAX_INPUT_LENGTH);
  }

  /**
   * Enforces cost control: max 20 AI calls per student per hour (§8, §13.5).
   */
  async checkRateLimit(studentId: string): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const callCount = await prisma.aiToolCallLog.count({
      where: {
        studentId,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (callCount >= MAX_CALLS_PER_STUDENT_PER_HOUR) {
      logger.warn({ studentId, callCount }, "Student exceeded 20 AI calls per hour rate limit");
      throw new TooManyRequestsError(
        "You have reached the maximum AI assistance queries for this hour (20 calls/hour). Please use the menu buttons.",
      );
    }
  }

  /**
   * Fallback interactive buttons menu when AI is down, rate-limited, or circuit is open (§13.5).
   */
  getFallbackMenu(): FallbackMenuPayload {
    return {
      bodyText:
        "Our automated assistant is temporarily busy. Please choose from the options below to proceed immediately:",
      buttons: [
        { id: "MENU_TODAY", title: "Today's Menu" },
        { id: "MY_COUPONS", title: "My Coupons" },
        { id: "REIMBURSE_START", title: "Apply Rebate" },
      ],
    };
  }
}

export const aiGuard = new AiGuard();
