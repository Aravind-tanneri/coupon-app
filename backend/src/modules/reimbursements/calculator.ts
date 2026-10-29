import {
  parseDateIST,
  formatDateIST,
  addDaysIST,
  diffCalendarDaysIST,
} from "../../lib/dates-ist.js";

export interface PolicyDTO {
  id: string;
  messId: string;
  dailyRatePaise: number;
  minAbsenceDays: number;
  effectiveFrom: Date | string;
  effectiveUntil?: Date | string | null;
  claimDeadlineDays: number;
  maxAbsenceDays?: number | null;
  documentRequired?: boolean;
}

export interface ExistingClaimDTO {
  id: string;
  publicRef: string;
  startDate: Date | string;
  endDate: Date | string;
  status: string;
}

export interface PolicySegment {
  policyId: string;
  dailyRatePaise: number;
  days: number;
  fromDate: string;
  toDate: string;
  amountPaise: number;
}

export interface CalculationBreakdown {
  startDate: string;
  endDate: string;
  departureDateExcluded: string;
  returnDateExcluded: string;
  countedDays: number;
  rateAtClaimPaise: number;
  claimablePaise: number;
  segments: PolicySegment[];
}

export interface CalculationResult {
  eligible: boolean;
  reason?: string;
  message?: string;
  countedDays: number;
  claimablePaise: number;
  rateAtClaimPaise: number;
  segments: PolicySegment[];
  overlapWith?: string;
  breakdown?: CalculationBreakdown;
}

/**
 * Pure, deterministic calculation engine strictly implementing ADR A1 and §16.
 * All date arithmetic is pinned strictly to Asia/Kolkata (IST).
 */
export function calculateReimbursement(params: {
  startDate: Date | string;
  endDate: Date | string;
  today: Date | string;
  policies: PolicyDTO[];
  existingClaims?: ExistingClaimDTO[];
}): CalculationResult {
  const {
    startDate: rawStart,
    endDate: rawEnd,
    today: rawToday,
    policies,
    existingClaims = [],
  } = params;

  const startStr = formatDateIST(rawStart);
  const endStr = formatDateIST(rawEnd);
  const todayStr = formatDateIST(rawToday);

  const startDate = parseDateIST(startStr);
  const endDate = parseDateIST(endStr);
  const today = parseDateIST(todayStr);

  // 1. Calendar Order Validation
  if (endDate.getTime() <= startDate.getTime()) {
    return {
      eligible: false,
      reason: "INVALID_DATE_RANGE",
      message: "Return date must be strictly after departure date.",
      countedDays: 0,
      claimablePaise: 0,
      rateAtClaimPaise: 0,
      segments: [],
    };
  }

  // 2. Future Date Check
  if (endDate.getTime() > today.getTime()) {
    return {
      eligible: false,
      reason: "FUTURE_END_DATE",
      message: "Return date cannot be in the future.",
      countedDays: 0,
      claimablePaise: 0,
      rateAtClaimPaise: 0,
      segments: [],
    };
  }

  // 3. ADR A1: Counted days = end - start - 1
  const diffDays = diffCalendarDaysIST(startDate, endDate);
  const countedDays = diffDays - 1;

  if (countedDays <= 0) {
    return {
      eligible: false,
      reason: "NO_COUNTED_DAYS",
      message:
        "No full days between departure and return. Both departure and return dates are excluded.",
      countedDays: 0,
      claimablePaise: 0,
      rateAtClaimPaise: 0,
      segments: [],
    };
  }

  // 4. Policy for Departure + 1
  const firstCountedDay = addDaysIST(startDate, 1);
  const basePolicy = findPolicyForDate(firstCountedDay, policies);

  if (!basePolicy) {
    return {
      eligible: false,
      reason: "NO_POLICY_FOR_DATE",
      message: `No active reimbursement policy found for departure period starting ${formatDateIST(firstCountedDay)}.`,
      countedDays,
      claimablePaise: 0,
      rateAtClaimPaise: 0,
      segments: [],
    };
  }

  // 5. Minimum Absence Days Rule (countedDays > minAbsenceDays)
  // ADR A2: If minAbsenceDays = 4, must be strictly > 4, i.e. countedDays >= 5 (end - start >= 6).
  if (countedDays <= basePolicy.minAbsenceDays) {
    return {
      eligible: false,
      reason: "MIN_DAYS_NOT_MET",
      message: `Absence must be strictly more than ${basePolicy.minAbsenceDays} days (minimum ${basePolicy.minAbsenceDays + 1} full counted days). Found ${countedDays} counted days.`,
      countedDays,
      claimablePaise: 0,
      rateAtClaimPaise: 0,
      segments: [],
    };
  }

  // 6. Claim Deadline Validation
  if (basePolicy.claimDeadlineDays > 0) {
    const daysSinceReturn = diffCalendarDaysIST(endDate, today);
    if (daysSinceReturn > basePolicy.claimDeadlineDays) {
      return {
        eligible: false,
        reason: "CLAIM_DEADLINE_EXCEEDED",
        message: `Claim submission window expired. Must submit within ${basePolicy.claimDeadlineDays} days of return (returned ${daysSinceReturn} days ago).`,
        countedDays,
        claimablePaise: 0,
        rateAtClaimPaise: 0,
        segments: [],
      };
    }
  }

  // 7. Overlap Detection with Existing Active Claims
  // Counted range is [start + 1, end - 1]
  const firstCountedTime = firstCountedDay.getTime();
  const lastCountedTime = addDaysIST(startDate, countedDays).getTime();

  for (const claim of existingClaims) {
    const status = claim.status.toUpperCase();
    if (status === "DRAFT" || status === "REJECTED" || status === "CANCELLED") {
      continue;
    }

    const cStart = parseDateIST(formatDateIST(claim.startDate));
    const cEnd = parseDateIST(formatDateIST(claim.endDate));
    const cDiff = diffCalendarDaysIST(cStart, cEnd);
    if (cDiff <= 1) continue; // No counted days in that claim

    const cFirstCountedTime = addDaysIST(cStart, 1).getTime();
    const cLastCountedTime = addDaysIST(cStart, cDiff - 1).getTime();

    // Check interval overlap: max(start1, start2) <= min(end1, end2)
    const overlapStart = Math.max(firstCountedTime, cFirstCountedTime);
    const overlapEnd = Math.min(lastCountedTime, cLastCountedTime);

    if (overlapStart <= overlapEnd) {
      return {
        eligible: false,
        reason: "OVERLAPPING_CLAIM",
        overlapWith: claim.publicRef,
        message: `Absence period overlaps with active claim ${claim.publicRef}.`,
        countedDays,
        claimablePaise: 0,
        rateAtClaimPaise: 0,
        segments: [],
      };
    }
  }

  // 8. Per-Day Policy Segmentation
  // Cap billable days if maxAbsenceDays is set
  const billableDays =
    basePolicy.maxAbsenceDays && basePolicy.maxAbsenceDays > 0
      ? Math.min(countedDays, basePolicy.maxAbsenceDays)
      : countedDays;

  const segments: PolicySegment[] = [];
  let currentSegment: PolicySegment | null = null;
  let totalClaimablePaise = 0;

  for (let i = 1; i <= billableDays; i++) {
    const day = addDaysIST(startDate, i);
    const dayStr = formatDateIST(day);
    const policyForDay = findPolicyForDate(day, policies);

    if (!policyForDay) {
      return {
        eligible: false,
        reason: "NO_POLICY_FOR_DATE",
        message: `No reimbursement policy configured for date ${dayStr}.`,
        countedDays,
        claimablePaise: 0,
        rateAtClaimPaise: 0,
        segments: [],
      };
    }

    if (currentSegment && currentSegment.policyId === policyForDay.id) {
      currentSegment.days += 1;
      currentSegment.toDate = dayStr;
      currentSegment.amountPaise += policyForDay.dailyRatePaise;
    } else {
      if (currentSegment) {
        segments.push(currentSegment);
      }
      currentSegment = {
        policyId: policyForDay.id,
        dailyRatePaise: policyForDay.dailyRatePaise,
        days: 1,
        fromDate: dayStr,
        toDate: dayStr,
        amountPaise: policyForDay.dailyRatePaise,
      };
    }

    totalClaimablePaise += policyForDay.dailyRatePaise;
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  const rateAtClaimPaise =
    countedDays > 0 ? Math.round(totalClaimablePaise / countedDays) : basePolicy.dailyRatePaise;

  const breakdown: CalculationBreakdown = {
    startDate: startStr,
    endDate: endStr,
    departureDateExcluded: startStr,
    returnDateExcluded: endStr,
    countedDays,
    rateAtClaimPaise,
    claimablePaise: totalClaimablePaise,
    segments,
  };

  return {
    eligible: true,
    countedDays,
    claimablePaise: totalClaimablePaise,
    rateAtClaimPaise,
    segments,
    breakdown,
  };
}

function findPolicyForDate(date: Date, policies: PolicyDTO[]): PolicyDTO | undefined {
  const dTime = date.getTime();

  return policies.find((p) => {
    const fromTime = parseDateIST(formatDateIST(p.effectiveFrom)).getTime();
    if (dTime < fromTime) return false;

    if (p.effectiveUntil) {
      const untilTime = parseDateIST(formatDateIST(p.effectiveUntil)).getTime();
      if (dTime > untilTime) return false;
    }

    return true;
  });
}
