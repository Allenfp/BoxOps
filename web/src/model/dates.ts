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

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "2026-09-14, Monday": a date as it's said, with its weekday (a Saturday is a different matter on the roadmap). */
export const spokenDay = (day: Day): string => `${formatDay(day)}, ${WEEKDAYS[dayParts(day).weekday]}`;

/** A date for display: always YYYY-MM-DD, the same as the files, everywhere in the app. */
export function prettyDay(day: Day): string {
  return formatDay(day);
}

/**
 * Quarter label for the quarter starting at `quarterStart`. Calendar years read
 * "Q4 2026"; fiscal years are named by the year they end in: "FY27 Q1".
 */
export function quarterLabel(quarterStart: Day, fyStartMonth = 1): string {
  const { year, month } = dayParts(quarterStart);
  const q = quarterName(quarterStart, fyStartMonth);
  if (fyStartMonth === 1) return `${q} ${year}`;
  const fyEndYear = month >= fyStartMonth ? year + 1 : year;
  return `FY${String(fyEndYear).slice(-2)} ${q}`;
}

/** The quarter alone, without its year: "Q4". */
export function quarterName(quarterStart: Day, fyStartMonth = 1): string {
  const monthsIntoFy = (((dayParts(quarterStart).month - fyStartMonth) % 12) + 12) % 12;
  return `Q${Math.floor(monthsIntoFy / 3) + 1}`;
}

// ---- Working days -----------------------------------------------------------
// The roadmap only has weekdays: weekends are never drawn and never counted.
// A working-day index numbers Mondays–Fridays consecutively; a weekend day maps
// to the index of the following Monday.

/** 1969-12-29, a Monday, so whole weeks line up with index multiples of 5. */
const MONDAY0 = -3;

export function workIndex(day: Day): number {
  const d = day - MONDAY0;
  const week = Math.floor(d / 7);
  return week * 5 + Math.min(d - week * 7, 5);
}

export function dayOfWorkIndex(index: number): Day {
  const week = Math.floor(index / 5);
  return MONDAY0 + week * 7 + (index - week * 5);
}

export const isWeekend = (day: Day): boolean => dayParts(day).weekday >= 5;

/** The day itself, or the Monday after a weekend. */
export const nextWorkday = (day: Day): Day => dayOfWorkIndex(workIndex(day));

/** The day itself, or the Friday before a weekend. */
export const prevWorkday = (day: Day): Day => (isWeekend(day) ? day - (dayParts(day).weekday - 4) : day);

/** Working days from `start` to `end`, both inclusive. */
export const workdays = (start: Day, end: Day): number => workIndex(end + 1) - workIndex(start);

/** Move a working day by `n` working days (a weekend counts from the Monday after). */
export const addWorkdays = (day: Day, n: number): Day => dayOfWorkIndex(workIndex(day) + n);

// ---- The calendar's keys -----------------------------------------------------
// A date field's calendar (DateInput.tsx) can't pick a weekend, so its keys
// only ever land on a working day, and the month shown is the one they land in.

/** The day itself, or the nearest working day in its month: a Saturday's Friday, a Sunday's Monday, or the other way when that leaves the month. */
export function workdayInMonth(day: Day): Day {
  const { weekday, month } = dayParts(day);
  if (weekday < 5) return day;
  const near = weekday === 5 ? day - 1 : day + 1;
  if (dayParts(near).month === month) return near;
  return weekday === 5 ? day + 2 : day - 2;
}

/** The same day of the month `n` months on (the month's last day, if it's shorter), as a working day in that month. */
export function sameDayMonthsOn(day: Day, n: number): Day {
  const { year, month, day: date } = dayParts(day);
  const length = dayParts(makeDay(year, month + n + 1, 0)).day;
  return workdayInMonth(makeDay(year, month + n, Math.min(date, length)));
}

/**
 * Where a key takes the calendar from `day`: ← → the working day before or
 * after, ↑ ↓ the same weekday a week before or after, Home and End that
 * week's Monday and Friday, Page Up and Page Down the same day a month
 * before or after (with Shift, a year). Null for any other key.
 */
export function calendarMove(day: Day, key: string, shift = false): Day | null {
  switch (key) {
    case "ArrowLeft":
      return prevWorkday(day - 1);
    case "ArrowRight":
      return nextWorkday(day + 1);
    case "ArrowUp":
      return day - 7;
    case "ArrowDown":
      return day + 7;
    case "Home":
      return startOfWeek(day);
    case "End":
      return startOfWeek(day) + 4;
    case "PageUp":
      return sameDayMonthsOn(day, shift ? -12 : -1);
    case "PageDown":
      return sameDayMonthsOn(day, shift ? 12 : 1);
    default:
      return null;
  }
}
