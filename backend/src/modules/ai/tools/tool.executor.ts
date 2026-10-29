import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../config/logger.js";
import { TOOL_REGISTRY, STATE_ALLOW_LISTS } from "./tool.registry.js";
import { InjectedStudentContext } from "../gemini.types.js";

export interface ExecuteToolOptions {
  toolName: string;
  args: Record<string, unknown>;
  context: InjectedStudentContext;
  conversationState?: string;
}

export interface ToolExecutionResult {
  outcome: "SUCCESS" | "ERROR" | "DROPPED";
  result?: unknown;
  error?: string;
  toolName: string;
  latencyMs: number;
}

export class ToolExecutor {
  async execute(options: ExecuteToolOptions): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const { toolName, args, context, conversationState = "DEFAULT" } = options;

    const allowedTools = STATE_ALLOW_LISTS[conversationState] ?? STATE_ALLOW_LISTS["DEFAULT"]!;

    // 1. Check if tool is registered
    const toolDef = TOOL_REGISTRY[toolName];
    if (!toolDef) {
      const latencyMs = Date.now() - startTime;
      logger.warn(
        { toolName, studentId: context.studentId },
        "Attempted call to unknown tool. Dropping call.",
      );
      await this.logCall(context.studentId, toolName, args, "DROPPED", latencyMs);
      return {
        outcome: "DROPPED",
        error: `Unknown tool '${toolName}'`,
        toolName,
        latencyMs,
      };
    }

    // 2. Check per-state allow-list (§8)
    if (!allowedTools.includes(toolName)) {
      const latencyMs = Date.now() - startTime;
      logger.warn(
        { toolName, conversationState, studentId: context.studentId },
        "Tool not permitted in current conversation state. Dropping call.",
      );
      await this.logCall(context.studentId, toolName, args, "DROPPED", latencyMs);
      return {
        outcome: "DROPPED",
        error: `Tool '${toolName}' is not permitted in state '${conversationState}'`,
        toolName,
        latencyMs,
      };
    }

    // 3. Validate arguments against Zod schema
    const parsedArgs = toolDef.schema.safeParse(args);
    if (!parsedArgs.success) {
      const latencyMs = Date.now() - startTime;
      logger.warn(
        { toolName, issues: parsedArgs.error.issues, studentId: context.studentId },
        "Tool argument schema validation failed. Dropping call.",
      );
      await this.logCall(context.studentId, toolName, args, "DROPPED", latencyMs);
      return {
        outcome: "DROPPED",
        error: `Invalid arguments: ${parsedArgs.error.issues.map((i) => i.message).join(", ")}`,
        toolName,
        latencyMs,
      };
    }

    // 4. Execute tool with context injection
    try {
      const output = await toolDef.execute(parsedArgs.data, context);
      const latencyMs = Date.now() - startTime;

      await this.logCall(context.studentId, toolName, parsedArgs.data, "SUCCESS", latencyMs);

      return {
        outcome: "SUCCESS",
        result: output,
        toolName,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      logger.error(
        { err, toolName, studentId: context.studentId },
        "Tool execution threw an error",
      );
      await this.logCall(context.studentId, toolName, parsedArgs.data, "ERROR", latencyMs);

      return {
        outcome: "ERROR",
        error: err instanceof Error ? err.message : String(err),
        toolName,
        latencyMs,
      };
    }
  }

  private async logCall(
    studentId: string,
    tool: string,
    argsValidated: unknown,
    outcome: "SUCCESS" | "ERROR" | "DROPPED",
    latencyMs: number,
  ): Promise<void> {
    try {
      await prisma.aiToolCallLog.create({
        data: {
          studentId,
          tool,
          argsValidated: (argsValidated ?? {}) as Prisma.InputJsonValue,
          outcome,
          latencyMs,
        },
      });
    } catch (err) {
      logger.warn({ err, tool, studentId }, "Failed to persist AiToolCallLog");
    }
  }
}

export const toolExecutor = new ToolExecutor();
