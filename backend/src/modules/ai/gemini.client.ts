import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { ExternalServiceError } from "../../lib/errors.js";

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallResponse {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiClientResponse {
  text?: string;
  toolCalls?: ToolCallResponse[];
}

export interface GeminiClient {
  generateStructured<T>(
    prompt: string,
    systemInstruction: string,
    responseSchema: Record<string, unknown>,
  ): Promise<T>;

  generateWithTools(
    prompt: string,
    systemInstruction: string,
    tools: ToolDeclaration[],
  ): Promise<GeminiClientResponse>;
}

export class FakeGeminiClient implements GeminiClient {
  private structuredResponses: unknown[] = [];
  private toolCallResponses: GeminiClientResponse[] = [];
  public callHistory: Array<{ prompt: string; systemInstruction: string; type: string }> = [];

  setNextStructuredResponse<T>(data: T): void {
    this.structuredResponses.push(data);
  }

  setNextToolCallResponse(response: GeminiClientResponse): void {
    this.toolCallResponses.push(response);
  }

  async generateStructured<T>(
    prompt: string,
    systemInstruction: string,
    _responseSchema: Record<string, unknown>,
  ): Promise<T> {
    this.callHistory.push({ prompt, systemInstruction, type: "structured" });

    if (this.structuredResponses.length > 0) {
      return this.structuredResponses.shift() as T;
    }

    // Default heuristic intent classifier for fallback simulation in tests
    const normalized = prompt.toLowerCase();
    let intent = "UNKNOWN";
    const entities: Record<string, unknown> = {};

    // 1. Feedback & Complaints (must evaluate before meal queries)
    if (
      normalized.includes("feedback") ||
      normalized.includes("complaint") ||
      normalized.includes("star") ||
      normalized.includes("salty") ||
      normalized.includes("cleanliness") ||
      normalized.includes("hygiene") ||
      normalized.includes("taste")
    ) {
      intent = "FEEDBACK_SUBMISSION";
    }
    // 2. Coupon Purchase (must evaluate before general coupon query or menu)
    else if (
      (normalized.includes("buy") || normalized.includes("purchase")) &&
      (normalized.includes("coupon") ||
        normalized.includes("pass") ||
        normalized.includes("lunch") ||
        normalized.includes("dinner") ||
        normalized.includes("breakfast") ||
        normalized.includes("meal"))
    ) {
      intent = "COUPON_PURCHASE";
      if (normalized.includes("lunch")) entities["productCode"] = "EXTRA_LUNCH";
      if (normalized.includes("dinner")) entities["productCode"] = "EXTRA_DINNER";
    }
    // 3. Coupon Query
    else if (normalized.includes("coupon") || normalized.includes("pass")) {
      intent = "COUPON_QUERY";
    }
    // 4. Reimbursement Calculation (must evaluate before general reimbursement query)
    else if (
      (normalized.includes("reimburse") ||
        normalized.includes("rebate") ||
        normalized.includes("refund") ||
        normalized.includes("claim")) &&
      (normalized.includes("calculate") ||
        normalized.includes("calculator") ||
        normalized.includes("how much") ||
        normalized.includes("days") ||
        normalized.includes("oct") ||
        normalized.includes("leave"))
    ) {
      intent = "REIMBURSEMENT_CALCULATION";
    }
    // 5. Reimbursement Status
    else if (
      (normalized.includes("reimburse") ||
        normalized.includes("rebate") ||
        normalized.includes("claim")) &&
      (normalized.includes("status") || normalized.includes("check"))
    ) {
      intent = "REIMBURSEMENT_STATUS";
    }
    // 6. Reimbursement General
    else if (
      normalized.includes("reimburse") ||
      normalized.includes("rebate") ||
      normalized.includes("claim")
    ) {
      intent = "REIMBURSEMENT_QUERY";
    }
    // 7. Menu Query
    else if (
      normalized.includes("menu") ||
      normalized.includes("lunch") ||
      normalized.includes("dinner") ||
      normalized.includes("breakfast") ||
      normalized.includes("snack") ||
      normalized.includes("food")
    ) {
      intent = "MENU_QUERY";
      if (normalized.includes("lunch")) entities["meal"] = "LUNCH";
      if (normalized.includes("dinner")) entities["meal"] = "DINNER";
      if (normalized.includes("breakfast")) entities["meal"] = "BREAKFAST";
      if (normalized.includes("snack")) entities["meal"] = "SNACKS";
    }
    // 8. Gift Query
    else if (normalized.includes("gift")) {
      intent = "GIFT_QUERY";
    }
    // 9. Announcement Query
    else if (normalized.includes("announcement") || normalized.includes("notice")) {
      intent = "ANNOUNCEMENT_QUERY";
    }
    // 10. Help
    else if (normalized.includes("help") || normalized.includes("command")) {
      intent = "HELP";
    }
    // 11. Cancel
    else if (normalized.includes("cancel") || normalized.includes("stop")) {
      intent = "CANCEL";
    }

    return {
      intent,
      entities,
      confidence: 0.95,
    } as unknown as T;
  }

  async generateWithTools(
    prompt: string,
    systemInstruction: string,
    _tools: ToolDeclaration[],
  ): Promise<GeminiClientResponse> {
    this.callHistory.push({ prompt, systemInstruction, type: "tools" });

    if (this.toolCallResponses.length > 0) {
      return this.toolCallResponses.shift()!;
    }

    // Default heuristic response
    const normalized = prompt.toLowerCase();
    if (normalized.includes("menu")) {
      return {
        toolCalls: [{ name: "get_menu", args: {} }],
      };
    }
    if (normalized.includes("coupon")) {
      return {
        toolCalls: [{ name: "get_my_coupons", args: {} }],
      };
    }
    if (normalized.includes("reimbursement") || normalized.includes("claim")) {
      return {
        toolCalls: [{ name: "get_reimbursement_policy", args: {} }],
      };
    }

    return {
      text: "I can help you check today's menu, view your coupons, or apply for meal reimbursements. How can I assist?",
    };
  }

  clearHistory(): void {
    this.callHistory = [];
    this.structuredResponses = [];
    this.toolCallResponses = [];
  }
}

export class GoogleGenAiClient implements GeminiClient {
  private ai: GoogleGenAI;
  private model: string;
  private circuitBreaker: CircuitBreaker;
  private readonly timeoutMs: number;

  constructor(options?: {
    model?: string;
    apiKey?: string;
    circuitBreaker?: CircuitBreaker;
    timeoutMs?: number;
  }) {
    const apiKey = options?.apiKey ?? env.GEMINI_API_KEY ?? "dummy_key_for_init";
    this.ai = new GoogleGenAI({ apiKey });
    this.model = options?.model ?? env.GEMINI_MODEL ?? "gemini-2.0-flash";
    this.circuitBreaker = options?.circuitBreaker ?? new CircuitBreaker();
    this.timeoutMs = options?.timeoutMs ?? 8000;
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  private async executeWithRetryAndTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      let attempts = 0;
      let lastError: unknown;

      while (attempts < 2) {
        attempts++;
        try {
          // 8s timeout via Promise.race (§13.1)
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new ExternalServiceError(`Gemini request timed out after ${this.timeoutMs}ms`),
              );
            }, this.timeoutMs);
          });

          return await Promise.race([operation(), timeoutPromise]);
        } catch (err) {
          lastError = err;
          logger.warn(
            { attempt: attempts, err: err instanceof Error ? err.message : String(err) },
            "Gemini API attempt failed",
          );
          if (attempts < 2) {
            // Brief backoff before 1 retry (§13.1)
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new ExternalServiceError(`Gemini invocation failed: ${String(lastError)}`);
    });
  }

  async generateStructured<T>(
    prompt: string,
    systemInstruction: string,
    responseSchema: Record<string, unknown>,
  ): Promise<T> {
    return this.executeWithRetryAndTimeout(async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new ExternalServiceError("Gemini returned empty response text");
      }

      try {
        return JSON.parse(responseText) as T;
      } catch (parseError) {
        throw new ExternalServiceError(
          `Failed to parse Gemini structured JSON: ${String(parseError)}`,
        );
      }
    });
  }

  async generateWithTools(
    prompt: string,
    systemInstruction: string,
    tools: ToolDeclaration[],
  ): Promise<GeminiClientResponse> {
    return this.executeWithRetryAndTimeout(async () => {
      // Map tool declarations to Gemini FunctionDeclaration format
      const functionDeclarations = tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));

      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations }],
        },
      });

      const toolCalls: ToolCallResponse[] = [];
      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      for (const part of parts) {
        if (part.functionCall && part.functionCall.name) {
          toolCalls.push({
            name: part.functionCall.name,
            args: (part.functionCall.args as Record<string, unknown>) ?? {},
          });
        }
      }

      return {
        text: response.text ?? undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    });
  }
}
