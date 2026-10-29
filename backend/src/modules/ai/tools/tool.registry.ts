import { z } from "zod";
import { ToolDefinition, InjectedStudentContext } from "../gemini.types.js";
import {
  GetMenuArgsSchema,
  ListUpcomingMenusArgsSchema,
  GetMyCouponsArgsSchema,
  GetMyGiftCouponsArgsSchema,
  GetCouponQrArgsSchema,
  ListCouponProductsArgsSchema,
  StartCouponPurchaseArgsSchema,
  GetPaymentStatusArgsSchema,
  GetReimbursementPolicyArgsSchema,
  CalculateReimbursementArgsSchema,
  StartReimbursementClaimArgsSchema,
  GetMyReimbursementsArgsSchema,
  SubmitFeedbackDraftArgsSchema,
  GetAnnouncementsArgsSchema,
  ShowHelpArgsSchema,
  CancelFlowArgsSchema,
} from "../schemas.js";
import { prisma } from "../../../lib/prisma.js";
import { policyService } from "../../reimbursements/policy.service.js";
import { calculateReimbursement } from "../../reimbursements/calculator.js";
import { parseDateIST } from "../../../lib/dates-ist.js";

// List of strictly prohibited parameter names across all tools (§8, §13.3)
export const FORBIDDEN_IDENTITY_PARAM_NAMES = [
  "studentid",
  "student_id",
  "userid",
  "user_id",
  "messid",
  "mess_id",
  "rollno",
  "roll_no",
  "adminid",
  "admin_id",
];

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  get_menu: {
    name: "get_menu",
    description: "Get the mess menu for a specific date or today. Defaults to today IST.",
    schema: GetMenuArgsSchema,
    execute: async (args: z.infer<typeof GetMenuArgsSchema>, context: InjectedStudentContext) => {
      const targetDate = args.date ?? context.todayIST;
      const parsedDate = parseDateIST(targetDate);

      const whereClause: {
        messId: string;
        date: Date;
        mealType?: import("@prisma/client").MealType;
      } = {
        messId: context.messId,
        date: parsedDate,
      };

      if (args.meal) {
        whereClause.mealType = args.meal as import("@prisma/client").MealType;
      }

      const menus = await prisma.menu.findMany({
        where: whereClause,
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });

      return {
        date: targetDate,
        messId: context.messId,
        meals: menus.map((m) => ({
          mealType: m.mealType,
          notes: m.notes,
          items: m.items.map((i) => ({ name: i.name, isVeg: i.isVeg })),
        })),
      };
    },
  },

  list_upcoming_menus: {
    name: "list_upcoming_menus",
    description: "List mess menus for upcoming days (up to 7 days).",
    schema: ListUpcomingMenusArgsSchema,
    execute: async (
      args: z.infer<typeof ListUpcomingMenusArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const days = args.days ?? 3;
      const startDate = parseDateIST(context.todayIST);
      const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);

      const menus = await prisma.menu.findMany({
        where: {
          messId: context.messId,
          date: { gte: startDate, lte: endDate },
        },
        include: { items: { orderBy: { sortOrder: "asc" } } },
        orderBy: [{ date: "asc" }, { mealType: "asc" }],
      });

      return {
        daysRequested: days,
        menusCount: menus.length,
        schedule: menus.map((m) => ({
          date: m.date.toISOString().split("T")[0],
          mealType: m.mealType,
          items: m.items.map((i) => i.name),
        })),
      };
    },
  },

  get_my_coupons: {
    name: "get_my_coupons",
    description: "Get purchased and gift meal coupons for the student.",
    schema: GetMyCouponsArgsSchema,
    execute: async (
      args: z.infer<typeof GetMyCouponsArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const coupons = await prisma.coupon.findMany({
        where: {
          studentId: context.studentId,
          ...(args.status ? { status: args.status as import("@prisma/client").CouponStatus } : {}),
        },
        orderBy: { validDate: "desc" },
        take: 20,
      });

      return {
        studentName: context.studentName,
        total: coupons.length,
        coupons: coupons.map((c, index) => ({
          ref: `#${index + 1}`,
          shortCode: c.shortCode,
          mealType: c.mealType,
          validDate: c.validDate.toISOString().split("T")[0],
          status: c.status,
          source: c.source,
        })),
      };
    },
  },

  get_my_gift_coupons: {
    name: "get_my_gift_coupons",
    description: "Get special meal gift passes issued by administration.",
    schema: GetMyGiftCouponsArgsSchema,
    execute: async (
      _args: z.infer<typeof GetMyGiftCouponsArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const coupons = await prisma.coupon.findMany({
        where: {
          studentId: context.studentId,
          source: "ADMIN_GIFT",
        },
        orderBy: { validDate: "desc" },
      });

      return {
        gifts: coupons.map((c) => ({
          shortCode: c.shortCode,
          mealType: c.mealType,
          validDate: c.validDate.toISOString().split("T")[0],
          status: c.status,
        })),
      };
    },
  },

  get_coupon_qr: {
    name: "get_coupon_qr",
    description: "Retrieve QR redemption pass for a specific coupon short-ref or code.",
    schema: GetCouponQrArgsSchema,
    execute: async (
      args: z.infer<typeof GetCouponQrArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const coupon = await prisma.coupon.findFirst({
        where: {
          studentId: context.studentId,
          OR: [{ shortCode: args.ref.toUpperCase() }],
        },
      });

      if (!coupon) {
        return {
          error: "COUPON_NOT_FOUND",
          message: `Coupon with reference ${args.ref} not found`,
        };
      }

      return {
        action: "SEND_IMAGE",
        shortCode: coupon.shortCode,
        mealType: coupon.mealType,
        validDate: coupon.validDate.toISOString().split("T")[0],
        status: coupon.status,
      };
    },
  },

  list_coupon_products: {
    name: "list_coupon_products",
    description: "List available meal coupon products and prices for the current mess.",
    schema: ListCouponProductsArgsSchema,
    execute: async (
      _args: z.infer<typeof ListCouponProductsArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const products = await prisma.couponProduct.findMany({
        where: { messId: context.messId, active: true },
      });

      return {
        products: products.map((p) => ({
          code: p.code,
          mealType: p.mealType,
          priceRupees: p.pricePaise / 100,
        })),
      };
    },
  },

  start_coupon_purchase: {
    name: "start_coupon_purchase",
    description: "Start purchase of a meal coupon product. Generates payment link only.",
    schema: StartCouponPurchaseArgsSchema,
    execute: async (
      args: z.infer<typeof StartCouponPurchaseArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const product = await prisma.couponProduct.findUnique({
        where: { messId_code: { messId: context.messId, code: args.productCode } },
      });

      if (!product || !product.active) {
        return {
          error: "PRODUCT_UNAVAILABLE",
          message: "Selected coupon product is currently unavailable",
        };
      }

      return {
        action: "REDIRECT_PAYMENT",
        productCode: product.code,
        mealType: product.mealType,
        date: args.date,
        amountPaise: product.pricePaise,
        amountRupees: product.pricePaise / 100,
        note: "Complete purchase via secure payment link",
      };
    },
  },

  get_payment_status: {
    name: "get_payment_status",
    description: "Check the status of a recent coupon order payment.",
    schema: GetPaymentStatusArgsSchema,
    execute: async (
      args: z.infer<typeof GetPaymentStatusArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const order = await prisma.couponOrder.findFirst({
        where: {
          studentId: context.studentId,
          orderToken: args.ref,
        },
      });

      if (!order) {
        return { error: "ORDER_NOT_FOUND", message: "Order reference not found" };
      }

      return {
        status: order.status,
        validDate: order.validDate.toISOString().split("T")[0],
        amountRupees: order.amountPaise / 100,
      };
    },
  },

  get_reimbursement_policy: {
    name: "get_reimbursement_policy",
    description:
      "Get active mess absence reimbursement policy (daily rate, minimum absence days, deadline).",
    schema: GetReimbursementPolicyArgsSchema,
    execute: async (
      _args: z.infer<typeof GetReimbursementPolicyArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const policy = await policyService.getActivePolicy(context.messId);
      if (!policy) {
        return {
          activePolicy: false,
          message: "No active reimbursement policy found for this mess",
        };
      }

      return {
        activePolicy: true,
        dailyRateRupees: policy.dailyRatePaise / 100,
        minAbsenceDays: policy.minAbsenceDays,
        requiredFullDaysToQualify: policy.minAbsenceDays + 1,
        claimDeadlineDays: policy.claimDeadlineDays,
        ruleSummary:
          "Reimbursement is calculated as (returnDate - departureDate - 1) full counted days.",
      };
    },
  },

  calculate_reimbursement: {
    name: "calculate_reimbursement",
    description: "Calculate expected mess reimbursement amount for absence dates without saving.",
    schema: CalculateReimbursementArgsSchema,
    execute: async (
      args: z.infer<typeof CalculateReimbursementArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const policies = await policyService.getPoliciesForMess(context.messId);
      const studentClaims = await prisma.reimbursementRequest.findMany({
        where: {
          studentId: context.studentId,
          status: { notIn: ["REJECTED", "CANCELLED", "DRAFT"] },
        },
        select: { startDate: true, endDate: true },
      });

      const result = calculateReimbursement({
        startDate: args.startDate,
        endDate: args.endDate,
        today: context.todayIST,
        policies,
        existingClaims: studentClaims.map((c, idx) => ({
          id: `claim-${idx}`,
          publicRef: `CLM-${idx}`,
          status: "APPROVED",
          startDate: c.startDate.toISOString().split("T")[0]!,
          endDate: c.endDate.toISOString().split("T")[0]!,
        })),
      });

      return {
        eligible: result.eligible,
        reason: result.reason,
        countedDays: result.countedDays,
        dailyRateRupees: result.rateAtClaimPaise / 100,
        calculatedAmountRupees: result.claimablePaise / 100,
        breakdown: result.breakdown,
      };
    },
  },

  start_reimbursement_claim: {
    name: "start_reimbursement_claim",
    description: "Initiate guided reimbursement claim workflow.",
    schema: StartReimbursementClaimArgsSchema,
    execute: async (
      args: z.infer<typeof StartReimbursementClaimArgsSchema>,
      _context: InjectedStudentContext,
    ) => {
      return {
        action: "START_REIMBURSEMENT_FLOW",
        startDate: args.startDate,
        endDate: args.endDate,
        nextStep: "AWAITING_START_DATE",
      };
    },
  },

  get_my_reimbursements: {
    name: "get_my_reimbursements",
    description: "Get recent reimbursement claims and status for the student.",
    schema: GetMyReimbursementsArgsSchema,
    execute: async (
      args: z.infer<typeof GetMyReimbursementsArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const claims = await prisma.reimbursementRequest.findMany({
        where: {
          studentId: context.studentId,
          ...(args.ref ? { publicRef: args.ref.toUpperCase() } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      return {
        total: claims.length,
        claims: claims.map((c) => ({
          publicRef: c.publicRef,
          status: c.status,
          startDate: c.startDate.toISOString().split("T")[0],
          endDate: c.endDate.toISOString().split("T")[0],
          countedDays: c.countedDays,
          claimedRupees: c.claimedAmountPaise / 100,
          approvedRupees: c.approvedAmountPaise ? c.approvedAmountPaise / 100 : null,
          rejectionReason: c.rejectionReason,
        })),
      };
    },
  },

  submit_feedback_draft: {
    name: "submit_feedback_draft",
    description: "Stage mess dining feedback or complaint. Requires button confirmation.",
    schema: SubmitFeedbackDraftArgsSchema,
    execute: async (
      args: z.infer<typeof SubmitFeedbackDraftArgsSchema>,
      _context: InjectedStudentContext,
    ) => {
      return {
        action: "CONFIRM_FEEDBACK_DRAFT",
        category: args.category,
        message: args.message,
        rating: args.rating,
        note: "Feedback staged. Student must confirm submission via button.",
      };
    },
  },

  get_announcements: {
    name: "get_announcements",
    description: "Get active announcements and dining notices from mess management.",
    schema: GetAnnouncementsArgsSchema,
    execute: async (
      _args: z.infer<typeof GetAnnouncementsArgsSchema>,
      context: InjectedStudentContext,
    ) => {
      const announcements = await prisma.announcement.findMany({
        where: {
          OR: [{ messId: context.messId }, { messId: null }],
          publishAt: { lte: new Date() },
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        },
        orderBy: { publishAt: "desc" },
        take: 5,
      });

      return {
        announcements: announcements.map((a) => ({
          title: a.title,
          body: a.body,
          publishedDate: a.publishAt.toISOString().split("T")[0],
        })),
      };
    },
  },

  show_help: {
    name: "show_help",
    description: "Show available system commands and help menu.",
    schema: ShowHelpArgsSchema,
    execute: async (
      _args: z.infer<typeof ShowHelpArgsSchema>,
      _context: InjectedStudentContext,
    ) => {
      return {
        commands: [
          "MENU: View today's food menu",
          "COUPONS: View your passes or buy a meal coupon",
          "REIMBURSE: Check policy, calculate, or submit leave rebate",
          "FEEDBACK: Share remarks or report food/hygiene issues",
          "ANNOUNCEMENTS: View latest dining hall notices",
          "HELP: Show this guide",
        ],
      };
    },
  },

  cancel_flow: {
    name: "cancel_flow",
    description: "Cancel active guided workflow and return to the main menu.",
    schema: CancelFlowArgsSchema,
    execute: async (
      _args: z.infer<typeof CancelFlowArgsSchema>,
      _context: InjectedStudentContext,
    ) => {
      return {
        action: "CANCEL_ACTIVE_FLOW",
        message: "Current operation cancelled. Returning to main menu.",
      };
    },
  },
};

/**
 * State Allow-Lists (§8): Restricts allowed tools by current conversation state.
 */
export const STATE_ALLOW_LISTS: Record<string, string[]> = {
  DEFAULT: [
    "get_menu",
    "list_upcoming_menus",
    "get_my_coupons",
    "get_my_gift_coupons",
    "get_coupon_qr",
    "list_coupon_products",
    "start_coupon_purchase",
    "get_payment_status",
    "get_reimbursement_policy",
    "calculate_reimbursement",
    "start_reimbursement_claim",
    "get_my_reimbursements",
    "submit_feedback_draft",
    "get_announcements",
    "show_help",
    "cancel_flow",
  ],
  REIMBURSEMENT_FLOW: [
    "calculate_reimbursement",
    "get_reimbursement_policy",
    "cancel_flow",
    "show_help",
  ],
  FEEDBACK_FLOW: ["submit_feedback_draft", "cancel_flow", "show_help"],
};

/**
 * Introspect registry to assert that no tool contains identity parameters (§13.3).
 */
export function introspectToolsAndAssertNoIdentityParams(): void {
  for (const [toolName, toolDef] of Object.entries(TOOL_REGISTRY)) {
    if (toolDef.schema instanceof z.ZodObject) {
      const shape = toolDef.schema.shape;
      for (const paramKey of Object.keys(shape)) {
        const normalized = paramKey.toLowerCase().replace(/[^a-z]/g, "");
        if (FORBIDDEN_IDENTITY_PARAM_NAMES.some((forbidden) => normalized.includes(forbidden))) {
          throw new Error(
            `SECURITY VIOLATION: Tool '${toolName}' accepts identity parameter '${paramKey}'. Identity must be injected!`,
          );
        }
      }
    }
  }
}
