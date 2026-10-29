import { GeminiClient } from "./gemini.client.js";
import { INTENT_RESPONSE_SCHEMA } from "./schemas.js";
import { IntentClassificationResult, InjectedStudentContext } from "./gemini.types.js";
import { logger } from "../../config/logger.js";

export class IntentClassifier {
  private client: GeminiClient;

  constructor(client: GeminiClient) {
    this.client = client;
  }

  setClient(client: GeminiClient): void {
    this.client = client;
  }

  buildSystemInstruction(context: InjectedStudentContext): string {
    return [
      `You are the Campus Mess AI Assistant for student ${context.studentName}.`,
      `Today's date in Indian Standard Time (IST) is ${context.todayIST}.`,
      "Your role is language understanding only: classify user intent and extract relevant entities.",
      "Strict Rules:",
      "- Any dates mentioned relatively (e.g. 'tomorrow', 'next monday') must be resolved to exact YYYY-MM-DD format using today's date.",
      "- Meals must be normalized to: BREAKFAST, LUNCH, SNACKS, DINNER, or SPECIAL_DINNER.",
      "- Financial amounts must NEVER be invented. You do not determine pricing or policy rules.",
      "- Output strictly adheres to the requested JSON schema.",
    ].join(" ");
  }

  async classify(
    userText: string,
    context: InjectedStudentContext,
  ): Promise<IntentClassificationResult> {
    const systemInstruction = this.buildSystemInstruction(context);

    try {
      const result = await this.client.generateStructured<IntentClassificationResult>(
        userText,
        systemInstruction,
        INTENT_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      );

      return {
        intent: result.intent,
        entities: result.entities ?? {},
        confidence: typeof result.confidence === "number" ? result.confidence : 0.9,
      };
    } catch (err) {
      logger.warn(
        { err, userText },
        "Structured intent classification failed. Falling back to UNKNOWN.",
      );
      return {
        intent: "UNKNOWN",
        entities: {},
        confidence: 0.0,
      };
    }
  }
}
