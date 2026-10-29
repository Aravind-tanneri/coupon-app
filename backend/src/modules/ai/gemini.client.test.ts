import { describe, it, expect, beforeEach } from "vitest";
import { FakeGeminiClient } from "./gemini.client.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { ExternalServiceError } from "../../lib/errors.js";

describe("Phase 13: Gemini Client & Circuit Breaker (§13.1)", () => {
  let fakeClient: FakeGeminiClient;

  beforeEach(() => {
    fakeClient = new FakeGeminiClient();
  });

  describe("FakeGeminiClient", () => {
    it("handles structured intent generation", async () => {
      fakeClient.setNextStructuredResponse({
        intent: "MENU_QUERY",
        entities: { meal: "LUNCH" },
        confidence: 0.98,
      });

      const res = await fakeClient.generateStructured<{
        intent: string;
        entities: Record<string, string>;
      }>("what is for lunch today?", "System prompt", {});

      expect(res.intent).toBe("MENU_QUERY");
      expect(res.entities["meal"]).toBe("LUNCH");
      expect(fakeClient.callHistory).toHaveLength(1);
    });

    it("handles tool call generation", async () => {
      fakeClient.setNextToolCallResponse({
        toolCalls: [{ name: "get_menu", args: { meal: "DINNER" } }],
      });

      const res = await fakeClient.generateWithTools("what is for dinner?", "System prompt", []);
      expect(res.toolCalls).toBeDefined();
      expect(res.toolCalls?.[0]?.name).toBe("get_menu");
      expect(res.toolCalls?.[0]?.args["meal"]).toBe("DINNER");
    });
  });

  describe("Circuit Breaker (§13.1, §13.5)", () => {
    it("opens after 5 consecutive failures and fails fast", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5, cooldownPeriodMs: 5000 });
      let counter = 0;

      const failingOperation = async () => {
        counter++;
        throw new Error("Gemini upstream 503 error");
      };

      // 5 failures
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute(failingOperation)).rejects.toThrow(
          "Gemini upstream 503 error",
        );
      }

      expect(counter).toBe(5);
      expect(breaker.isOpen()).toBe(true);

      // 6th call fails fast with ExternalServiceError without invoking operation
      await expect(breaker.execute(failingOperation)).rejects.toThrow(ExternalServiceError);
      expect(counter).toBe(5); // Not incremented because circuit was open
    });

    it("resets failure counter upon a successful execution", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      // 2 failures
      await expect(
        breaker.execute(async () => {
          throw new Error("transient error");
        }),
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error("transient error");
        }),
      ).rejects.toThrow();

      // 1 success
      const result = await breaker.execute(async () => "success");
      expect(result).toBe("success");
      expect(breaker.isOpen()).toBe(false);

      // Now 2 more failures should not trip it because count was reset
      await expect(
        breaker.execute(async () => {
          throw new Error("transient error");
        }),
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error("transient error");
        }),
      ).rejects.toThrow();
      expect(breaker.isOpen()).toBe(false);
    });
  });
});
