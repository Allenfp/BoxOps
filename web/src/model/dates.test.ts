import { describe, expect, it } from "vitest";
import { calendarMove, formatDay, parseDay, sameDayMonthsOn, spokenDay, workdayInMonth } from "./dates";

const d = (s: string) => parseDay(s)!;
/** Where `key` (with Shift, if `shift`) takes the calendar from `from`, as YYYY-MM-DD. */
const move = (from: string, key: string, shift = false) => {
  const to = calendarMove(d(from), key, shift);
  return to === null ? null : formatDay(to);
};

describe("the calendar's keys", () => {
  it("move a working day with ← →, skipping weekends, across months and years", () => {
    expect(move("2026-10-02", "ArrowRight")).toBe("2026-10-05"); // Fri → Mon
    expect(move("2026-10-05", "ArrowLeft")).toBe("2026-10-02"); // Mon → Fri
    expect(move("2026-10-06", "ArrowRight")).toBe("2026-10-07");
    expect(move("2026-09-30", "ArrowRight")).toBe("2026-10-01");
    expect(move("2026-10-30", "ArrowRight")).toBe("2026-11-02"); // Fri the 30th → Mon the 2nd
    expect(move("2026-12-31", "ArrowRight")).toBe("2027-01-01");
    expect(move("2027-01-01", "ArrowLeft")).toBe("2026-12-31");
  });

  it("move a week with ↑ ↓, to the same weekday", () => {
    expect(move("2026-09-14", "ArrowDown")).toBe("2026-09-21");
    expect(move("2026-09-14", "ArrowUp")).toBe("2026-09-07");
    expect(move("2026-12-28", "ArrowDown")).toBe("2027-01-04");
    expect(move("2027-01-04", "ArrowUp")).toBe("2026-12-28");
  });

  it("go to the week's Monday and Friday with Home and End", () => {
    expect(move("2026-10-07", "Home")).toBe("2026-10-05");
    expect(move("2026-10-07", "End")).toBe("2026-10-09");
    expect(move("2026-10-05", "Home")).toBe("2026-10-05");
    expect(move("2026-10-09", "End")).toBe("2026-10-09");
    // A week across two months or years: still that week's Monday and Friday.
    expect(move("2026-10-01", "Home")).toBe("2026-09-28");
    expect(move("2026-12-31", "End")).toBe("2027-01-01");
  });

  it("go to the same day a month on with Page Up and Page Down, on a working day in that month", () => {
    expect(move("2026-09-07", "PageDown")).toBe("2026-10-07");
    expect(move("2026-12-15", "PageDown")).toBe("2027-01-15");
    expect(move("2027-01-15", "PageUp")).toBe("2026-12-15");
    // A Saturday goes back to the Friday, a Sunday on to the Monday…
    expect(move("2026-09-11", "PageDown")).toBe("2026-10-12"); // 2026-10-11 is a Sunday
    expect(move("2026-10-07", "PageDown")).toBe("2026-11-06"); // 2026-11-07 is a Saturday
    expect(move("2026-10-01", "PageDown")).toBe("2026-11-02"); // 2026-11-01 is a Sunday
    // …unless that leaves the month.
    expect(move("2026-07-01", "PageDown")).toBe("2026-08-03"); // Saturday the 1st: not Friday 07-31
    // A shorter month: its last day (then a working day in it).
    expect(move("2026-01-30", "PageDown")).toBe("2026-02-27"); // 02-28 is a Saturday
    expect(move("2025-03-31", "PageUp")).toBe("2025-02-28");
  });

  it("go to the same day a year on with Shift and Page Up or Page Down", () => {
    expect(move("2026-10-07", "PageDown", true)).toBe("2027-10-07");
    expect(move("2026-10-07", "PageUp", true)).toBe("2025-10-07");
    expect(move("2027-05-31", "PageUp", true)).toBe("2026-05-29"); // Sunday the 31st: not Monday 06-01
  });

  it("know leap years", () => {
    expect(move("2028-01-31", "PageDown")).toBe("2028-02-29");
    expect(move("2024-03-29", "PageUp")).toBe("2024-02-29");
    expect(move("2028-02-29", "PageDown", true)).toBe("2029-02-28");
    expect(move("2024-02-29", "PageUp", true)).toBe("2023-02-28");
    expect(move("2028-02-28", "ArrowRight")).toBe("2028-02-29");
    expect(move("2028-02-29", "ArrowRight")).toBe("2028-03-01");
    expect(move("2027-02-26", "ArrowRight")).toBe("2027-03-01"); // Fri 02-26; no 29th, 28th a Sunday
  });

  it("leave other keys alone", () => {
    for (const key of ["Enter", " ", "Escape", "Tab", "a"]) expect(move("2026-10-07", key)).toBeNull();
  });
});

describe("working days in a month", () => {
  it("are a weekday itself, or a weekend's nearest weekday in the same month", () => {
    expect(formatDay(workdayInMonth(d("2026-10-07")))).toBe("2026-10-07");
    expect(formatDay(workdayInMonth(d("2026-10-10")))).toBe("2026-10-09"); // Saturday → Friday
    expect(formatDay(workdayInMonth(d("2026-10-11")))).toBe("2026-10-12"); // Sunday → Monday
    expect(formatDay(workdayInMonth(d("2026-08-01")))).toBe("2026-08-03"); // Saturday the 1st → Monday
    expect(formatDay(workdayInMonth(d("2026-05-31")))).toBe("2026-05-29"); // Sunday the 31st → Friday
  });

  it("keep the day of the month a month or a year on, where there is one", () => {
    expect(formatDay(sameDayMonthsOn(d("2026-10-07"), 0))).toBe("2026-10-07");
    expect(formatDay(sameDayMonthsOn(d("2026-10-07"), -10))).toBe("2025-12-08"); // 2025-12-07 is a Sunday
    expect(formatDay(sameDayMonthsOn(d("2026-10-07"), 24))).toBe("2028-10-06"); // 2028-10-07 is a Saturday
  });
});

describe("dates said aloud", () => {
  it("come with their weekday", () => {
    expect(spokenDay(d("2026-09-14"))).toBe("2026-09-14, Monday");
    expect(spokenDay(d("2026-10-10"))).toBe("2026-10-10, Saturday");
  });
});
