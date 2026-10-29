import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TOOL_REGISTRY,
  introspectToolsAndAssertNoIdentityParams,
  FORBIDDEN_IDENTITY_PARAM_NAMES,
} from "./tools/tool.registry.js";
import { toolExecutor } from "./tools/tool.executor.js";
import { aiGuard, MAX_INPUT_LENGTH } from "./guard.js";
import { prisma } from "../../lib/prisma.js";
import { InjectedStudentContext } from "./gemini.types.js";
import { TooManyRequestsError } from "../../lib/errors.js";

vi.mock("../../lib/prisma.js", () => {
  return {
    prisma: {
      menu: {
        findMany: vi.fn(),
      },
      coupon: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      couponProduct: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      couponOrder: {
        findFirst: vi.fn(),
      },
      reimbursementRequest: {
        findMany: vi.fn(),
      },
      announcement: {
        findMany: vi.fn(),
      },
      aiToolCallLog: {
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
        count: vi.fn(),
      },
    },
  };
});

vi.mock("../reimbursements/policy.service.js", () => {
  return {
    policyService: {
      getActivePolicy: vi.fn().mockResolvedValue({
        id: "pol-1",
        messId: "akshaya",
        dailyRatePaise: 13100,
        minAbsenceDays: 4,
        claimDeadlineDays: 30,
      }),
      getPoliciesForMess: vi.fn().mockResolvedValue([
        {
          id: "pol-1",
          messId: "akshaya",
          dailyRatePaise: 13100,
          minAbsenceDays: 4,
          claimDeadlineDays: 30,
          effectiveFrom: new Date("2026-01-01"),
          effectiveUntil: null,
        },
      ]),
    },
  };
});

describe("Phase 13: Tool Registry, Context Injection & Allow-Lists (§13.3, §13.4, §13.5)", () => {
  const mockContext: InjectedStudentContext = {
    studentId: "stud-xyz-123",
    messId: "akshaya",
    rollNo: "2024CS001",
    studentName: "Rahul Sharma",
    todayIST: "2026-10-29",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Architectural Tool Introspection (§13.3)", () => {
    it("asserts NO tool in the registry accepts student, user, or mess identity parameters", () => {
      // Must not throw
      expect(() => introspectToolsAndAssertNoIdentityParams()).not.toThrow();

      // Deep inspection of all registered tools
      for (const [toolName, toolDef] of Object.entries(TOOL_REGISTRY)) {
        // @ts-expect-error shape inspection
        const shape = toolDef.schema.shape || {};
        for (const key of Object.keys(shape)) {
          const normalized = key.toLowerCase();
          for (const forbidden of FORBIDDEN_IDENTITY_PARAM_NAMES) {
            expect(
              normalized,
              `Tool '${toolName}' must not have parameter '${key}' containing '${forbidden}'`,
            ).not.toContain(forbidden);
          }
        }
      }
    });

    it("verifies prohibited tools are NOT in the registry (§8)", () => {
      const toolNames = Object.keys(TOOL_REGISTRY);

      // Financial submissions and admin tools must NOT be accessible to LLM
      expect(toolNames).not.toContain("submit_reimbursement");
      expect(toolNames).not.toContain("approve_claim");
      expect(toolNames).not.toContain("reject_claim");
      expect(toolNames).not.toContain("record_payment");
      expect(toolNames).not.toContain("execute_sql");
      expect(toolNames).not.toContain("query_database");
    });
  });

  describe("Tool Execution & Context Injection (§13.4)", () => {
    it("injects messId into get_menu query", async () => {
      vi.mocked(prisma.menu.findMany).mockResolvedValue([
        {
          id: "m-1",
          messId: "akshaya",
          mealType: "LUNCH",
          date: new Date("2026-10-29"),
          notes: "Special treat",
          items: [{ name: "Paneer Butter Masala", isVeg: true, sortOrder: 1 }],
        } as never,
      ]);

      const result = await toolExecutor.execute({
        toolName: "get_menu",
        args: { date: "2026-10-29", meal: "LUNCH" },
        context: mockContext,
        conversationState: "DEFAULT",
      });

      expect(result.outcome).toBe("SUCCESS");
      expect(prisma.menu.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            messId: "akshaya", // Injected from context
          }),
        }),
      );

      expect(prisma.aiToolCallLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentId: "stud-xyz-123",
            tool: "get_menu",
            outcome: "SUCCESS",
          }),
        }),
      );
    });

    it("injects studentId into get_my_coupons query", async () => {
      vi.mocked(prisma.coupon.findMany).mockResolvedValue([
        {
          id: "cpn-1",
          shortCode: "CPN-1234",
          mealType: "DINNER",
          validDate: new Date("2026-10-29"),
          status: "ACTIVE",
          source: "PURCHASE",
        } as never,
      ]);

      const result = await toolExecutor.execute({
        toolName: "get_my_coupons",
        args: {},
        context: mockContext,
        conversationState: "DEFAULT",
      });

      expect(result.outcome).toBe("SUCCESS");
      expect(prisma.coupon.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            studentId: "stud-xyz-123", // Injected from context
          }),
        }),
      );
    });

    it("drops unknown tool calls and logs as DROPPED", async () => {
      const result = await toolExecutor.execute({
        toolName: "non_existent_tool",
        args: {},
        context: mockContext,
        conversationState: "DEFAULT",
      });

      expect(result.outcome).toBe("DROPPED");
      expect(prisma.aiToolCallLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            studentId: "stud-xyz-123",
            tool: "non_existent_tool",
            outcome: "DROPPED",
          }),
        }),
      );
    });
  });

  describe("Per-State Tool Allow-Lists (§8)", () => {
    it("permits reimbursement tools in REIMBURSEMENT_FLOW state but blocks menu tools", async () => {
      // 1. Blocked in REIMBURSEMENT_FLOW
      const blockedResult = await toolExecutor.execute({
        toolName: "get_menu",
        args: {},
        context: mockContext,
        conversationState: "REIMBURSEMENT_FLOW",
      });

      expect(blockedResult.outcome).toBe("DROPPED");
      expect(blockedResult.error).toContain("is not permitted in state 'REIMBURSEMENT_FLOW'");

      // 2. Allowed in REIMBURSEMENT_FLOW
      const allowedResult = await toolExecutor.execute({
        toolName: "get_reimbursement_policy",
        args: {},
        context: mockContext,
        conversationState: "REIMBURSEMENT_FLOW",
      });

      expect(allowedResult.outcome).toBe("SUCCESS");
    });
  });

  describe("Guard: Rate Limiting & Input Truncation (§13.5)", () => {
    it("truncates inputs exceeding 500 characters", () => {
      const longInput = "a".repeat(800);
      const truncated = aiGuard.truncateInput(longInput);
      expect(truncated.length).toBe(MAX_INPUT_LENGTH);
    });

    it("enforces max 20 AI calls per student per hour", async () => {
      vi.mocked(prisma.aiToolCallLog.count).mockResolvedValue(20);

      await expect(aiGuard.checkRateLimit("stud-xyz-123")).rejects.toThrow(TooManyRequestsError);
    });

    it("returns deterministic fallback buttons menu when service is down", () => {
      const fallback = aiGuard.getFallbackMenu();
      expect(fallback.buttons).toHaveLength(3);
      expect(fallback.buttons.map((b) => b.id)).toEqual([
        "MENU_TODAY",
        "MY_COUPONS",
        "REIMBURSE_START",
      ]);
    });
  });
});
