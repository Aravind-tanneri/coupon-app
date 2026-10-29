import { z } from "zod";

export const AI_INTENTS = [
  "MENU_QUERY",
  "COUPON_QUERY",
  "COUPON_PURCHASE",
  "COUPON_STATUS",
  "GIFT_QUERY",
  "REIMBURSEMENT_QUERY",
  "REIMBURSEMENT_CALCULATION",
  "REIMBURSEMENT_SUBMISSION",
  "REIMBURSEMENT_STATUS",
  "FEEDBACK_SUBMISSION",
  "ANNOUNCEMENT_QUERY",
  "HELP",
  "CANCEL",
  "UNKNOWN",
] as const;

export type AiIntent = (typeof AI_INTENTS)[number];

export interface ExtractedEntities {
  date?: string;
  meal?: "BREAKFAST" | "LUNCH" | "SNACKS" | "DINNER" | "SPECIAL_DINNER" | string;
  category?: string;
  rating?: number;
  message?: string;
  productCode?: string;
  startDate?: string;
  endDate?: string;
  ref?: string;
  days?: number;
  status?: string;
  [key: string]: unknown;
}

export interface IntentClassificationResult {
  intent: AiIntent;
  entities: ExtractedEntities;
  confidence: number;
}

export interface InjectedStudentContext {
  studentId: string;
  messId: string;
  rollNo: string;
  studentName: string;
  todayIST: string;
}

export interface ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: TSchema;
  execute: (args: z.infer<TSchema>, context: InjectedStudentContext) => Promise<unknown>;
}

export interface AiToolCallLogData {
  studentId: string;
  tool: string;
  argsValidated: unknown;
  outcome: "SUCCESS" | "ERROR" | "DROPPED";
  latencyMs: number;
}
