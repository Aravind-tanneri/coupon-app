import { describe, it, expect } from "vitest";
import { calculateReimbursement, PolicyDTO, ExistingClaimDTO } from "./calculator.js";

describe("Authoritative Reimbursement Calculator (§16 Executable Spec)", () => {
  const defaultPolicy: PolicyDTO = {
    id: "policy-1",
    messId: "akshaya",
    dailyRatePaise: 13100, // ₹131.00 per day
    minAbsenceDays: 4, // Absence must be > 4 (i.e. counted >= 5)
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
    claimDeadlineDays: 30, // 30 days window after return
    maxAbsenceDays: null,
  };

  it("calculates exact example from §0 and §16: 10 Oct -> 17 Oct gives 6 days @ ₹131 = ₹786", () => {
    const res = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-17",
      today: "2026-10-18",
      policies: [defaultPolicy],
    });

    expect(res.eligible).toBe(true);
    expect(res.countedDays).toBe(6);
    expect(res.claimablePaise).toBe(78600); // ₹786.00
    expect(res.rateAtClaimPaise).toBe(13100);
    expect(res.segments).toHaveLength(1);
    expect(res.segments[0]!.days).toBe(6);
    expect(res.segments[0]!.amountPaise).toBe(78600);
    expect(res.breakdown?.departureDateExcluded).toBe("2026-10-10");
    expect(res.breakdown?.returnDateExcluded).toBe("2026-10-17");
  });

  it("qualifies end - start = 6 as eligible (countedDays = 5 > 4)", () => {
    // 10 Oct -> 16 Oct: 11, 12, 13, 14, 15 Oct = 5 days
    const res = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-16",
      today: "2026-10-18",
      policies: [defaultPolicy],
    });

    expect(res.eligible).toBe(true);
    expect(res.countedDays).toBe(5);
    expect(res.claimablePaise).toBe(5 * 13100);
  });

  it("rejects end - start = 5 as NOT eligible (countedDays = 4 is not > 4)", () => {
    // 10 Oct -> 15 Oct: 11, 12, 13, 14 Oct = 4 days
    const res = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-15",
      today: "2026-10-18",
      policies: [defaultPolicy],
    });

    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("MIN_DAYS_NOT_MET");
    expect(res.countedDays).toBe(4);
    expect(res.claimablePaise).toBe(0);
  });

  it("rejects 10 -> 11 (0 counted days) and 10 -> 10 (same day)", () => {
    const res1 = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-11",
      today: "2026-10-18",
      policies: [defaultPolicy],
    });
    expect(res1.eligible).toBe(false);
    expect(res1.reason).toBe("NO_COUNTED_DAYS");

    const res2 = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-10",
      today: "2026-10-18",
      policies: [defaultPolicy],
    });
    expect(res2.eligible).toBe(false);
    expect(res2.reason).toBe("INVALID_DATE_RANGE");
  });

  it("rejects end date before start date", () => {
    const res = calculateReimbursement({
      startDate: "2026-10-17",
      endDate: "2026-10-10",
      today: "2026-10-18",
      policies: [defaultPolicy],
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("INVALID_DATE_RANGE");
  });

  it("rejects future return date where endDate > today", () => {
    const res = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-25",
      today: "2026-10-18",
      policies: [defaultPolicy],
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("FUTURE_END_DATE");
  });

  it("rejects claim submitted past the claim deadline window", () => {
    // Return on 10 Aug, today is 25 Oct (> 30 days)
    const res = calculateReimbursement({
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      today: "2026-10-25",
      policies: [defaultPolicy],
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("CLAIM_DEADLINE_EXCEEDED");
  });

  it("allows adjacent claims: claim 10->17 then 17->24 are disjoint and allowed", () => {
    const existingClaim: ExistingClaimDTO = {
      id: "claim-1",
      publicRef: "CLM-2026-0001",
      startDate: "2026-10-10",
      endDate: "2026-10-17", // Counted days are 11..16 Oct
      status: "APPROVED",
    };

    // New claim: 17->24 Oct (counted days are 18..23 Oct)
    const res = calculateReimbursement({
      startDate: "2026-10-17",
      endDate: "2026-10-24",
      today: "2026-10-25",
      policies: [defaultPolicy],
      existingClaims: [existingClaim],
    });

    expect(res.eligible).toBe(true);
    expect(res.countedDays).toBe(6);
    expect(res.overlapWith).toBeUndefined();
  });

  it("rejects overlapping claims: claim 10->17 then 15->22 is rejected as overlapping", () => {
    const existingClaim: ExistingClaimDTO = {
      id: "claim-1",
      publicRef: "CLM-2026-0001",
      startDate: "2026-10-10",
      endDate: "2026-10-17", // Counted: 11..16 Oct
      status: "APPROVED",
    };

    // New claim: 15->22 Oct (counted: 16..21 Oct, overlaps on 16 Oct)
    const res = calculateReimbursement({
      startDate: "2026-10-15",
      endDate: "2026-10-22",
      today: "2026-10-25",
      policies: [defaultPolicy],
      existingClaims: [existingClaim],
    });

    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("OVERLAPPING_CLAIM");
    expect(res.overlapWith).toBe("CLM-2026-0001");
  });

  it("ignores cancelled and rejected claims during overlap check", () => {
    const rejectedClaim: ExistingClaimDTO = {
      id: "claim-old",
      publicRef: "CLM-2026-OLD",
      startDate: "2026-10-10",
      endDate: "2026-10-17",
      status: "REJECTED",
    };

    const res = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-17",
      today: "2026-10-18",
      policies: [defaultPolicy],
      existingClaims: [rejectedClaim],
    });

    expect(res.eligible).toBe(true);
    expect(res.countedDays).toBe(6);
  });

  it("handles rate change mid-absence: segments summed accurately across rate changes", () => {
    // Policy 1: ₹131 up to 13 Oct
    const policy1: PolicyDTO = {
      id: "policy-1",
      messId: "akshaya",
      dailyRatePaise: 13100,
      minAbsenceDays: 4,
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2026-10-13",
      claimDeadlineDays: 30,
    };
    // Policy 2: ₹140 starting 14 Oct
    const policy2: PolicyDTO = {
      id: "policy-2",
      messId: "akshaya",
      dailyRatePaise: 14000,
      minAbsenceDays: 4,
      effectiveFrom: "2026-10-14",
      effectiveUntil: null,
      claimDeadlineDays: 30,
    };

    // Absence 10 Oct to 17 Oct: Counted days are 11, 12, 13, 14, 15, 16 Oct (6 days)
    // 11, 12, 13 Oct (3 days) @ ₹131 = ₹393 (39300 paise)
    // 14, 15, 16 Oct (3 days) @ ₹140 = ₹420 (42000 paise)
    // Total = ₹813 (81300 paise)
    const res = calculateReimbursement({
      startDate: "2026-10-10",
      endDate: "2026-10-17",
      today: "2026-10-18",
      policies: [policy1, policy2],
    });

    expect(res.eligible).toBe(true);
    expect(res.countedDays).toBe(6);
    expect(res.claimablePaise).toBe(81300);
    expect(res.segments).toHaveLength(2);
    expect(res.segments[0]!.days).toBe(3);
    expect(res.segments[0]!.dailyRatePaise).toBe(13100);
    expect(res.segments[0]!.amountPaise).toBe(39300);
    expect(res.segments[1]!.days).toBe(3);
    expect(res.segments[1]!.dailyRatePaise).toBe(14000);
    expect(res.segments[1]!.amountPaise).toBe(42000);
    // Average rate: 81300 / 6 = 13550
    expect(res.rateAtClaimPaise).toBe(13550);
  });

  it("handles leap year boundaries correctly", () => {
    // Leap year 2024: 25 Feb to 04 Mar
    // Counted: 26 Feb, 27 Feb, 28 Feb, 29 Feb, 01 Mar, 02 Mar, 03 Mar = 7 counted days
    const res = calculateReimbursement({
      startDate: "2024-02-25",
      endDate: "2024-03-04",
      today: "2024-03-05",
      policies: [{ ...defaultPolicy, effectiveFrom: "2024-01-01" }],
    });

    expect(res.eligible).toBe(true);
    expect(res.countedDays).toBe(7);
    expect(res.claimablePaise).toBe(7 * 13100);
  });
});
