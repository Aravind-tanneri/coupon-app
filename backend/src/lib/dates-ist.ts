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
