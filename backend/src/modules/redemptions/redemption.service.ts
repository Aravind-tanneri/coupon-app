import { Prisma, CouponStatus, MealType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ConflictError } from "../../lib/errors.js";
import { hashToken } from "../../lib/tokens.js";
import {
  getTodayIST,
  getTodayISTString,
  formatDateIST,
  isMealInWindow,
  MealWindow,
} from "../../lib/dates-ist.js";
import { auditService } from "../audit/audit.service.js";
import { LookupCouponInput, RedeemCouponInput, RedemptionListQuery } from "./redemption.schemas.js";

function cleanTokenOrCode(input: { token?: string; shortCode?: string }) {
  let tokenHash: string | undefined;
  let shortCode: string | undefined;

  if (input.token && input.token.trim().length > 0) {
    let raw = input.token.trim();
    // Support URL scanned from QR e.g. https://domain/c/xyz or /c/xyz
    if (raw.includes("/c/")) {
      const parts = raw.split("/c/");
      const lastPart = parts[parts.length - 1];
      if (lastPart) {
        raw = lastPart.split("?")[0]!;
      }
    }
    tokenHash = hashToken(raw);
  } else if (input.shortCode && input.shortCode.trim().length > 0) {
    shortCode = input.shortCode.trim().toUpperCase();
  }

  return { tokenHash, shortCode };
}

export class RedemptionService {
  /**
   * Reads custom meal window setting for a mess if configured.
   */
  private async getMessMealWindows(
    messId: string,
  ): Promise<Record<string, MealWindow> | undefined> {
    try {
      const setting = await prisma.setting.findUnique({
        where: {
          messId_key: {
            messId,
            key: "mealWindows",
          },
        },
      });

      if (setting && typeof setting.value === "object" && setting.value !== null) {
        return setting.value as unknown as Record<string, MealWindow>;
      }
    } catch {
      // Fallback to default
    }
    return undefined;
  }

  /**
   * Preview scan: looks up coupon and validates redemption readiness without consuming it.
   */
  async lookupCoupon(input: LookupCouponInput & { messId?: string; actorId: string; ip?: string }) {
    const { tokenHash, shortCode } = cleanTokenOrCode(input);

    const coupon = await prisma.coupon.findFirst({
      where: {
        ...(tokenHash ? { tokenHash } : { shortCode }),
      },
      include: {
        student: {
          select: {
            id: true,
            rollNo: true,
            name: true,
            department: true,
          },
        },
        product: {
          select: {
            id: true,
            code: true,
            mealType: true,
            pricePaise: true,
          },
        },
        mess: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!coupon) {
      return {
        success: false,
        canRedeem: false,
        reason: "NOT_FOUND",
        message: "Coupon not found. Please verify the code or QR token.",
      };
    }

    const todayStr = getTodayISTString();
    const couponDateStr = formatDateIST(coupon.validDate);
    const now = new Date();

    // 1. Mess check
    if (input.messId && coupon.messId !== input.messId) {
      return {
        success: true,
        canRedeem: false,
        reason: "WRONG_MESS",
        message: `This coupon is assigned to ${coupon.mess.name}, not your mess.`,
        coupon,
      };
    }

    // 2. Status check
    if (coupon.status === CouponStatus.REDEEMED) {
      return {
        success: true,
        canRedeem: false,
        reason: "ALREADY_REDEEMED",
        message: `Coupon was already redeemed on ${coupon.redeemedAt?.toLocaleTimeString() ?? "earlier"}.`,
        coupon,
      };
    }

    if (coupon.status === CouponStatus.REVOKED) {
      return {
        success: true,
        canRedeem: false,
        reason: "REVOKED",
        message: "This coupon was revoked by mess administration.",
        coupon,
      };
    }

    if (coupon.status !== CouponStatus.ACTIVE) {
      return {
        success: true,
        canRedeem: false,
        reason: "INVALID_STATUS",
        message: `Coupon is in ${coupon.status} status.`,
        coupon,
      };
    }

    // 3. Date check
    if (couponDateStr !== todayStr) {
      return {
        success: true,
        canRedeem: false,
        reason: "WRONG_DATE",
        message: `Coupon is valid for ${couponDateStr}, but today is ${todayStr}.`,
        coupon,
      };
    }

    // 4. Expiry check
    if (coupon.expiresAt <= now) {
      return {
        success: true,
        canRedeem: false,
        reason: "EXPIRED",
        message: "Coupon has expired.",
        coupon,
      };
    }

    // 5. Meal window check
    if (!input.skipMealWindowCheck) {
      const customWindows = await this.getMessMealWindows(coupon.messId);
      const inWindow = isMealInWindow(coupon.mealType, customWindows);
      if (!inWindow) {
        return {
          success: true,
          canRedeem: false,
          reason: "OUTSIDE_MEAL_WINDOW",
          message: `Redemption is currently closed. Current time is outside the ${coupon.mealType} meal window.`,
          coupon,
        };
      }
    }

    return {
      success: true,
      canRedeem: true,
      message: "Coupon verified. Ready for redemption.",
      coupon,
    };
  }

  /**
   * Consumes a coupon atomically. Returns 409 Conflict with specific reason code on failure.
   */
  async redeemCoupon(input: RedeemCouponInput & { messId?: string; staffId: string; ip?: string }) {
    const { tokenHash, shortCode } = cleanTokenOrCode(input);
    const now = new Date();
    const todayIST = getTodayIST();
    const todayStr = getTodayISTString();

    // 1. Initial look up for meal window validation
    const existing = await prisma.coupon.findFirst({
      where: {
        ...(tokenHash ? { tokenHash } : { shortCode }),
      },
      include: {
        student: true,
        mess: true,
      },
    });

    if (!existing) {
      await auditService.log({
        actorType: "ADMIN",
        actorId: input.staffId,
        action: "REDEMPTION_FAILED",
        entityType: "Coupon",
        entityId: "UNKNOWN",
        after: { reason: "NOT_FOUND", shortCode: input.shortCode },
        ip: input.ip,
      });
      throw new ConflictError("Coupon not found", "NOT_FOUND");
    }

    // 2. Validate meal window before atomic consume
    if (!input.skipMealWindowCheck) {
      const customWindows = await this.getMessMealWindows(existing.messId);
      const inWindow = isMealInWindow(existing.mealType, customWindows);
      if (!inWindow) {
        await auditService.log({
          actorType: "ADMIN",
          actorId: input.staffId,
          action: "REDEMPTION_FAILED",
          entityType: "Coupon",
          entityId: existing.id,
          after: { reason: "OUTSIDE_MEAL_WINDOW", mealType: existing.mealType },
          ip: input.ip,
        });
        throw new ConflictError(
          `Current time is outside the ${existing.mealType} meal window`,
          "OUTSIDE_MEAL_WINDOW",
        );
      }
    }

    // 3. Atomic consume in transaction (single UPDATE ... WHERE status='ACTIVE')
    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.coupon.updateMany({
        where: {
          id: existing.id,
          status: CouponStatus.ACTIVE,
          validDate: todayIST,
          expiresAt: { gt: now },
          ...(input.messId ? { messId: input.messId } : {}),
        },
        data: {
          status: CouponStatus.REDEEMED,
          redeemedAt: now,
          redeemedById: input.staffId,
        },
      });

      if (updateResult.count === 0) {
        // Classify failure exactly
        if (input.messId && existing.messId !== input.messId) {
          throw new ConflictError("Coupon belongs to a different mess", "WRONG_MESS");
        }
        if (existing.status === CouponStatus.REDEEMED) {
          throw new ConflictError(
            `Coupon was already redeemed on ${existing.redeemedAt?.toISOString()}`,
            "ALREADY_REDEEMED",
            { redeemedAt: existing.redeemedAt, redeemedById: existing.redeemedById },
          );
        }
        if (existing.status === CouponStatus.REVOKED) {
          throw new ConflictError("Coupon has been revoked by administration", "REVOKED");
        }
        const couponDateStr = formatDateIST(existing.validDate);
        if (couponDateStr !== todayStr) {
          throw new ConflictError(
            `Coupon is valid for ${couponDateStr}, not today (${todayStr})`,
            "WRONG_DATE",
            { validDate: couponDateStr, today: todayStr },
          );
        }
        if (existing.expiresAt <= now) {
          throw new ConflictError("Coupon has expired", "EXPIRED", {
            expiresAt: existing.expiresAt,
          });
        }
        throw new ConflictError("Coupon is already redeemed or inactive", "ALREADY_REDEEMED");
      }

      // Record CouponRedemption row (second integrity constraint)
      await tx.couponRedemption.create({
        data: {
          couponId: existing.id,
          staffId: input.staffId,
          at: now,
        },
      });

      return tx.coupon.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          student: {
            select: {
              id: true,
              rollNo: true,
              name: true,
              department: true,
            },
          },
          product: {
            select: {
              id: true,
              code: true,
              mealType: true,
            },
          },
          mess: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });
    });

    await auditService.log({
      actorType: "ADMIN",
      actorId: input.staffId,
      action: "COUPON_REDEEMED",
      entityType: "Coupon",
      entityId: result.id,
      after: {
        shortCode: result.shortCode,
        mealType: result.mealType,
        studentRollNo: result.student.rollNo,
        redeemedAt: now,
      },
      ip: input.ip,
    });

    return result;
  }

  /**
   * Retrieves paginated redemption history log.
   */
  async listRedemptions(query: RedemptionListQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.CouponWhereInput = {
      status: CouponStatus.REDEEMED,
    };

    if (query.messId) where.messId = query.messId;
    if (query.mealType) where.mealType = query.mealType;
    if (query.date) {
      where.validDate = new Date(`${query.date}T00:00:00.000Z`);
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { shortCode: { contains: term.toUpperCase(), mode: "insensitive" } },
        { student: { rollNo: { contains: term, mode: "insensitive" } } },
        { student: { name: { contains: term, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { redeemedAt: "desc" },
        include: {
          student: { select: { id: true, rollNo: true, name: true, department: true } },
          product: { select: { id: true, code: true, mealType: true } },
          mess: { select: { id: true, code: true, name: true } },
          redemption: true,
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Returns daily redemption metrics and live feed for the counter scanner.
   */
  async getRedemptionSummary(messId?: string, dateStr?: string) {
    const targetDateStr = dateStr ?? getTodayISTString();
    const targetDate = new Date(`${targetDateStr}T00:00:00.000Z`);

    const where: Prisma.CouponWhereInput = {
      status: CouponStatus.REDEEMED,
      validDate: targetDate,
      ...(messId ? { messId } : {}),
    };

    const [totalToday, byMeal, recent] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.groupBy({
        by: ["mealType"],
        where,
        _count: { id: true },
      }),
      prisma.coupon.findMany({
        where,
        take: 10,
        orderBy: { redeemedAt: "desc" },
        include: {
          student: { select: { rollNo: true, name: true, department: true } },
          product: { select: { code: true } },
        },
      }),
    ]);

    const mealCounts: Record<MealType, number> = {
      BREAKFAST: 0,
      LUNCH: 0,
      SNACKS: 0,
      DINNER: 0,
      SPECIAL_DINNER: 0,
    };

    for (const group of byMeal) {
      mealCounts[group.mealType] = group._count.id;
    }

    return {
      date: targetDateStr,
      totalRedeemedToday: totalToday,
      byMeal: mealCounts,
      recentFeed: recent,
    };
  }
}

export const redemptionService = new RedemptionService();
