/**
 * Date calculations pinned strictly to Asia/Kolkata (IST = UTC+05:30).
 * Never uses local machine timezone for calendar dates.
 */

const IST_TIMEZONE = "Asia/Kolkata";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns today's date formatted as YYYY-MM-DD in Asia/Kolkata.
 */
export function getTodayISTString(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

/**
 * Returns today's date as a UTC Date pinned to midnight, matching Prisma @db.Date.
 */
export function getTodayIST(): Date {
  return parseDateIST(getTodayISTString());
}

/**
 * Parses an ISO date string (YYYY-MM-DD) into a UTC Date pinned to 00:00:00.000.
 */
export function parseDateIST(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new Error(`Invalid date format [${dateStr}]. Expected YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Construct UTC midnight date
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  // Verify valid calendar day (e.g. rejects 2026-02-31)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date [${dateStr}].`);
  }

  return date;
}

/**
 * Formats a Date or string to YYYY-MM-DD in Asia/Kolkata.
 */
export function formatDateIST(date: Date | string): string {
  const d = typeof date === "string" ? parseDateIST(date) : date;
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date to a human readable string in IST e.g. "10 Oct 2026".
 */
export function formatDisplayDateIST(date: Date | string): string {
  const d = typeof date === "string" ? parseDateIST(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/**
 * Adds or subtracts integer days to an IST date.
 */
export function addDaysIST(date: Date | string, days: number): Date {
  const d = typeof date === "string" ? parseDateIST(date) : date;
  const result = new Date(d.getTime() + days * MS_PER_DAY);
  return result;
}

/**
 * Computes difference in calendar days: end - start.
 */
export function diffCalendarDaysIST(start: Date | string, end: Date | string): number {
  const startDate = typeof start === "string" ? parseDateIST(start) : start;
  const endDate = typeof end === "string" ? parseDateIST(end) : end;

  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.round(diffMs / MS_PER_DAY);
}

/**
 * Implements ADR A1: Counted days = end - start - 1.
 * Both departure and return dates are excluded.
 */
export function calculateCountedDays(startDate: Date | string, endDate: Date | string): number {
  const diff = diffCalendarDaysIST(startDate, endDate);
  const counted = diff - 1;
  return counted > 0 ? counted : 0;
}

export interface MealWindow {
  start: string; // "HH:mm" in 24-hr IST
  end: string; // "HH:mm" in 24-hr IST
}

export const DEFAULT_MEAL_WINDOWS: Record<string, MealWindow> = {
  BREAKFAST: { start: "07:00", end: "10:30" },
  LUNCH: { start: "12:00", end: "15:00" },
  SNACKS: { start: "16:30", end: "18:30" },
  DINNER: { start: "19:30", end: "22:30" },
  SPECIAL_DINNER: { start: "19:30", end: "23:00" },
};

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Parses user-provided date text deterministically (§16.2).
 * Supports ISO (2026-10-10), numeric (10/10/2026, 10-10), and textual (10 Oct, 10 October 2026).
 * Rejects invalid calendar days (e.g. 31 Feb).
 */
export function parseUserDateInput(input: string, baseYear?: number): string | null {
  const clean = input.trim().toLowerCase();
  const currentYear = baseYear ?? new Date().getFullYear();

  // 1. ISO format: YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    try {
      const y = Number(isoMatch[1]);
      const m = Number(isoMatch[2]);
      const d = Number(isoMatch[3]);
      const isoStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      parseDateIST(isoStr);
      return isoStr;
    } catch {
      return null;
    }
  }

  // 2. Numeric DD/MM/YYYY or DD-MM-YYYY
  const fullNumeric = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(clean);
  if (fullNumeric && fullNumeric[1] && fullNumeric[2] && fullNumeric[3]) {
    try {
      const d = Number(fullNumeric[1]);
      const m = Number(fullNumeric[2]);
      const y = Number(fullNumeric[3]);
      const isoStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      parseDateIST(isoStr);
      return isoStr;
    } catch {
      return null;
    }
  }

  // 3. Short numeric DD/MM or DD-MM
  const shortNumeric = /^(\d{1,2})[\/\-](\d{1,2})$/.exec(clean);
  if (shortNumeric && shortNumeric[1] && shortNumeric[2]) {
    try {
      const d = Number(shortNumeric[1]);
      const m = Number(shortNumeric[2]);
      const isoStr = `${currentYear}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      parseDateIST(isoStr);
      return isoStr;
    } catch {
      return null;
    }
  }

  // 4. Textual month formats: "10 Oct", "10 October", "10 Oct 2026", "10-Oct", "10-Oct-2026"
  const dayMonthText = /^(\d{1,2})[\s\-]+([a-z]+)(?:[\s\-]+(\d{4}))?$/.exec(clean);
  if (dayMonthText && dayMonthText[1] && dayMonthText[2]) {
    const d = Number(dayMonthText[1]);
    const monthKey = dayMonthText[2];
    const m = MONTH_MAP[monthKey];
    const y = dayMonthText[3] ? Number(dayMonthText[3]) : currentYear;
    if (m) {
      try {
        const isoStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        parseDateIST(isoStr);
        return isoStr;
      } catch {
        return null;
      }
    }
  }

  // 5. Month day format: "Oct 10", "October 10", "Oct 10 2026"
  const monthDayText = /^([a-z]+)[\s\-]+(\d{1,2})(?:[\s\-]+(\d{4}))?$/.exec(clean);
  if (monthDayText && monthDayText[1] && monthDayText[2]) {
    const monthKey = monthDayText[1];
    const d = Number(monthDayText[2]);
    const m = MONTH_MAP[monthKey];
    const y = monthDayText[3] ? Number(monthDayText[3]) : currentYear;
    if (m) {
      try {
        const isoStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        parseDateIST(isoStr);
        return isoStr;
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Returns current time in IST as HH:mm and broken down into hours and minutes.
 */
export function getCurrentISTTime(): { timeStr: string; hours: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeStr = formatter.format(new Date());
  const [hours = 0, minutes = 0] = timeStr.split(":").map(Number);
  return { timeStr, hours, minutes };
}

/**
 * Validates if a HH:mm time string is within [start, end].
 */
export function isTimeInWindow(currentTime: string, start: string, end: string): boolean {
  if (start <= end) {
    return currentTime >= start && currentTime <= end;
  }
  // Spanning midnight
  return currentTime >= start || currentTime <= end;
}

/**
 * Determines whether the current IST time is within the active meal window for a given meal.
 */
export function isMealInWindow(
  mealType: string,
  customWindows?: Record<string, MealWindow>,
  currentTimeStr?: string,
): boolean {
  const windows = { ...DEFAULT_MEAL_WINDOWS, ...customWindows };
  const window = windows[mealType];
  if (!window) return true; // Unconstrained if unknown meal type

  const current = currentTimeStr ?? getCurrentISTTime().timeStr;
  return isTimeInWindow(current, window.start, window.end);
}
