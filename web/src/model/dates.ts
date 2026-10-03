// Calendar dates as integer day numbers (days since 1970-01-01, UTC).
// Roadmap dates are plain calendar days, so we never let local-time `Date`
// arithmetic near them: that is where off-by-one time-zone bugs come from.

export type Day = number;

const MS_PER_DAY = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function makeDay(year: number, month: number, day: number): Day {
  return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Parse `YYYY-MM-DD`; returns null for anything malformed or impossible (2026-02-30). */
export function parseDay(text: string): Day | null {
  const m = ISO_DAY.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = makeDay(y, mo, d);
  const back = dayParts(day);
  return back.year === y && back.month === mo && back.day === d ? day : null;
}

export function formatDay(day: Day): string {
  const { year, month, day: d } = dayParts(day);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface DayParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0 = Monday … 6 = Sunday
}

export function dayParts(day: Day): DayParts {
  const date = new Date(day * MS_PER_DAY);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: (date.getUTCDay() + 6) % 7,
  };
}

/** Today in the viewer's local calendar. */
export function today(now: Date = new Date()): Day {
  return makeDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function startOfWeek(day: Day): Day {
  return day - dayParts(day).weekday;
}

export function startOfMonth(day: Day): Day {
  const { year, month } = dayParts(day);
  return makeDay(year, month, 1);
}

/** First day of the month `n` months after the month containing `day`. */
export function addMonths(day: Day, n: number): Day {
  const { year, month } = dayParts(day);
  return makeDay(year, month + n, 1);
}

/** First day of the (fiscal) quarter containing `day`. */
export function startOfQuarter(day: Day, fyStartMonth = 1): Day {
  const { year, month } = dayParts(day);
  const offset = (((month - fyStartMonth) % 3) + 3) % 3;
  return makeDay(year, month - offset, 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

/** Human date such as "Oct 3, 2026". */
export function prettyDay(day: Day): string {
  const { year, month, day: d } = dayParts(day);
  return `${monthName(month)} ${d}, ${year}`;
}

/**
 * Quarter label for the quarter starting at `quarterStart`. Calendar years read
 * "Q4 2026"; fiscal years are named by the year they end in: "FY27 Q1".
 */
export function quarterLabel(quarterStart: Day, fyStartMonth = 1): string {
  const { year, month } = dayParts(quarterStart);
  const monthsIntoFy = (((month - fyStartMonth) % 12) + 12) % 12;
  const q = Math.floor(monthsIntoFy / 3) + 1;
  if (fyStartMonth === 1) return `Q${q} ${year}`;
  const fyEndYear = month >= fyStartMonth ? year + 1 : year;
  return `FY${String(fyEndYear).slice(-2)} Q${q}`;
}
