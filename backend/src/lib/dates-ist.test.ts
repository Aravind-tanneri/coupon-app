import { describe, it, expect } from "vitest";
import {
  parseDateIST,
  formatDateIST,
  formatDisplayDateIST,
  addDaysIST,
  diffCalendarDaysIST,
  calculateCountedDays,
  getTodayISTString,
  getTodayIST,
  isTimeInWindow,
  isMealInWindow,
  getCurrentISTTime,
  parseUserDateInput,
} from "./dates-ist.js";

describe("Dates IST Library (Asia/Kolkata Calendar)", () => {
  it("computes ADR A1 counted days = end - start - 1", () => {
    // Example from §0: 10 Oct -> 17 Oct = 6 days
    expect(calculateCountedDays("2026-10-10", "2026-10-17")).toBe(6);

    // End - start = 6 => 5 counted days
    expect(calculateCountedDays("2026-10-10", "2026-10-16")).toBe(5);

    // End - start = 5 => 4 counted days
    expect(calculateCountedDays("2026-10-10", "2026-10-15")).toBe(4);

    // Consecutive days => 0 counted days
    expect(calculateCountedDays("2026-10-10", "2026-10-11")).toBe(0);

    // Same day => 0 counted days
    expect(calculateCountedDays("2026-10-10", "2026-10-10")).toBe(0);

    // End before start => 0 counted days
    expect(calculateCountedDays("2026-10-17", "2026-10-10")).toBe(0);
  });

  it("handles leap year boundaries correctly", () => {
    // 2024 is a leap year (Feb 29 exists)
    const diff = diffCalendarDaysIST("2024-02-28", "2024-03-01");
    expect(diff).toBe(2);
    expect(calculateCountedDays("2024-02-28", "2024-03-01")).toBe(1); // 29 Feb
  });

  it("handles month and year boundaries correctly", () => {
    // Month transition: Oct 30 to Nov 3 (Oct has 31 days)
    expect(diffCalendarDaysIST("2026-10-30", "2026-11-03")).toBe(4);
    expect(calculateCountedDays("2026-10-30", "2026-11-03")).toBe(3); // 31 Oct, 1 Nov, 2 Nov

    // Year boundary: 2026-12-30 to 2027-01-02
    expect(diffCalendarDaysIST("2026-12-30", "2027-01-02")).toBe(3);
    expect(calculateCountedDays("2026-12-30", "2027-01-02")).toBe(2); // 31 Dec, 1 Jan
  });

  it("parses valid ISO date strings into UTC midnight dates", () => {
    const d = parseDateIST("2026-10-10");
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(9); // 0-indexed October
    expect(d.getUTCDate()).toBe(10);
    expect(d.getUTCHours()).toBe(0);
  });

  it("rejects malformed and non-existent calendar dates", () => {
    expect(() => parseDateIST("invalid")).toThrowError(/Invalid date format/);
    expect(() => parseDateIST("2026-13-01")).toThrowError(/Invalid calendar date/);
    expect(() => parseDateIST("2026-02-30")).toThrowError(/Invalid calendar date/);
    expect(() => parseDateIST("2025-02-29")).toThrowError(/Invalid calendar date/); // 2025 not leap
  });

  it("formats dates for display e.g. 10 Oct 2026", () => {
    expect(formatDisplayDateIST("2026-10-10")).toBe("10 Oct 2026");
    expect(formatDateIST("2026-10-10")).toBe("2026-10-10");
  });

  it("adds days correctly", () => {
    const next = addDaysIST("2026-10-10", 7);
    expect(formatDateIST(next)).toBe("2026-10-17");
  });

  it("retrieves today's date in IST format", () => {
    const todayStr = getTodayISTString();
    expect(todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const todayDate = getTodayIST();
    expect(todayDate).toBeInstanceOf(Date);
  });

  it("checks meal windows accurately in IST", () => {
    const istTime = getCurrentISTTime();
    expect(istTime.timeStr).toMatch(/^\d{2}:\d{2}$/);
    expect(istTime.hours).toBeGreaterThanOrEqual(0);
    expect(istTime.hours).toBeLessThanOrEqual(23);

    // Standard window checks
    expect(isTimeInWindow("13:00", "12:00", "15:00")).toBe(true);
    expect(isTimeInWindow("11:59", "12:00", "15:00")).toBe(false);
    expect(isTimeInWindow("15:01", "12:00", "15:00")).toBe(false);

    // Meal specific checks with explicit time
    expect(isMealInWindow("LUNCH", undefined, "12:30")).toBe(true);
    expect(isMealInWindow("LUNCH", undefined, "16:00")).toBe(false);
    expect(isMealInWindow("DINNER", undefined, "20:00")).toBe(true);
    expect(isMealInWindow("DINNER", undefined, "08:00")).toBe(false);
  });

  describe("parseUserDateInput (§16.2)", () => {
    it("parses deterministic date formats", () => {
      expect(parseUserDateInput("2026-10-10")).toBe("2026-10-10");
      expect(parseUserDateInput("10/10/2026")).toBe("2026-10-10");
      expect(parseUserDateInput("10-10-2026")).toBe("2026-10-10");
      expect(parseUserDateInput("10/10", 2026)).toBe("2026-10-10");
      expect(parseUserDateInput("10-10", 2026)).toBe("2026-10-10");
      expect(parseUserDateInput("10 Oct", 2026)).toBe("2026-10-10");
      expect(parseUserDateInput("10 October 2026")).toBe("2026-10-10");
      expect(parseUserDateInput("17 Oct 2026")).toBe("2026-10-17");
      expect(parseUserDateInput("Oct 10 2026")).toBe("2026-10-10");
    });

    it("rejects invalid dates and unparseable gibberish", () => {
      expect(parseUserDateInput("31 Feb 2026")).toBeNull();
      expect(parseUserDateInput("not a date")).toBeNull();
      expect(parseUserDateInput("")).toBeNull();
    });
  });
});
