import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { GeminiClient, GoogleGenAiClient, FakeGeminiClient } from "./gemini.client.js";
import { IntentClassifier } from "./intent.classifier.js";
import { toolExecutor, ToolExecutionResult } from "./tools/tool.executor.js";
import { aiGuard, FallbackMenuPayload } from "./guard.js";
import { InjectedStudentContext, IntentClassificationResult } from "./gemini.types.js";
import { TooManyRequestsError } from "../../lib/errors.js";

export interface AiProcessResult {
  fallback?: boolean;
  fallbackMenu?: FallbackMenuPayload;
  classification?: IntentClassificationResult;
  toolResult?: ToolExecutionResult;
  replyText?: string;
}

export class AiService {
  private client: GeminiClient;
  private classifier: IntentClassifier;

  constructor(client?: GeminiClient) {
    if (client) {
      this.client = client;
    } else if (env.GEMINI_API_KEY && env.NODE_ENV !== "test") {
      this.client = new GoogleGenAiClient();
    } else {
      this.client = new FakeGeminiClient();
    }
    this.classifier = new IntentClassifier(this.client);
  }

  setClient(client: GeminiClient): void {
    this.client = client;
    this.classifier.setClient(client);
  }

  getClient(): GeminiClient {
    return this.client;
  }

  getClassifier(): IntentClassifier {
    return this.classifier;
  }

  /**
   * Main entrypoint for student free-text AI processing (§8, §13).
   */
  async processMessage(
    rawText: string,
    context: InjectedStudentContext,
    conversationState: string = "DEFAULT",
  ): Promise<AiProcessResult> {
    // 1. Truncate input to 500 characters
    const sanitizedText = aiGuard.truncateInput(rawText);

    // 2. Check per-student rate limit (20 calls/hr)
    try {
      await aiGuard.checkRateLimit(context.studentId);
    } catch (err) {
      if (err instanceof TooManyRequestsError) {
        return {
          fallback: true,
          fallbackMenu: aiGuard.getFallbackMenu(),
          replyText: err.message,
        };
      }
      throw err;
    }

    try {
      // 3. Classify intent
      const classification = await this.classifier.classify(sanitizedText, context);

      // 4. Map intent to corresponding tool if allowed in state
      const mappedTool = this.mapIntentToTool(classification.intent, classification.entities);
      let toolResult: ToolExecutionResult | undefined;

      if (mappedTool) {
        toolResult = await toolExecutor.execute({
          toolName: mappedTool.name,
          args: mappedTool.args,
          context,
          conversationState,
        });
      }

      return {
        classification,
        toolResult,
      };
    } catch (err) {
      logger.error(
        { err, studentId: context.studentId },
        "AI processing failed, returning fallback menu",
      );
      return {
        fallback: true,
        fallbackMenu: aiGuard.getFallbackMenu(),
        replyText: "Our assistant is temporarily unavailable. Please use the options below:",
      };
    }
  }

  private mapIntentToTool(
    intent: string,
    entities: Record<string, unknown>,
  ): { name: string; args: Record<string, unknown> } | null {
    switch (intent) {
      case "MENU_QUERY":
        return {
          name: "get_menu",
          args: {
            date: entities["date"],
            meal: entities["meal"],
          },
        };
      case "COUPON_QUERY":
        return {
          name: "get_my_coupons",
          args: {
            status: entities["status"],
          },
        };
      case "COUPON_PURCHASE":
        if (entities["productCode"] && entities["date"]) {
          return {
            name: "start_coupon_purchase",
            args: {
              productCode: entities["productCode"],
              date: entities["date"],
            },
          };
        }
        return { name: "list_coupon_products", args: {} };
      case "GIFT_QUERY":
        return { name: "get_my_gift_coupons", args: {} };
      case "REIMBURSEMENT_CALCULATION":
        if (entities["startDate"] && entities["endDate"]) {
          return {
            name: "calculate_reimbursement",
            args: {
              startDate: entities["startDate"],
              endDate: entities["endDate"],
            },
          };
        }
        return { name: "get_reimbursement_policy", args: {} };
      case "REIMBURSEMENT_QUERY":
        return { name: "get_reimbursement_policy", args: {} };
      case "REIMBURSEMENT_STATUS":
        return {
          name: "get_my_reimbursements",
          args: { ref: entities["ref"] },
        };
      case "ANNOUNCEMENT_QUERY":
        return { name: "get_announcements", args: {} };
      case "HELP":
        return { name: "show_help", args: {} };
      case "CANCEL":
        return { name: "cancel_flow", args: {} };
      default:
        return null;
    }
  }
}

export const aiService = new AiService();
