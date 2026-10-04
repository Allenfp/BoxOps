import type { Day } from "./dates";

export type ZoomLevel = "weeks" | "months" | "quarters";
export const ZOOM_LEVELS: ZoomLevel[] = ["weeks", "months", "quarters"];

export interface BoxType {
  id: string;
  name: string;
  color: string;
}

/** A status flag such as "At risk"; a box has at most one, or none. */
export interface BoxStatus {
  id: string;
  name: string;
}

export interface Settings {
  title: string;
  fiscal_year_start_month: number;
  default_zoom: ZoomLevel;
  types: BoxType[];
  statuses: BoxStatus[];
}

/** A lane is anonymous capacity, e.g. one FTE — not a named person. */
export interface Lane {
  id: string;
  name?: string;
  fte: number;
  /** First day the lane holds capacity (inclusive); open since forever when not set. */
  start?: Day;
  /** Last day the lane holds capacity (inclusive); open-ended when not set. */
  end?: Day;
}

export interface Department {
  id: string;
  /** Short code that prefixes its boxes' codes, e.g. "DE" in DE-A1F. */
  code: string;
  name: string;
  color: string;
  order: number;
  collapsed: boolean;
  lanes: Lane[];
}

/** FTE a box can take; it sets how many lanes the box covers. */
export const BOX_FTE_OPTIONS = [0.5, 1, 1.5, 2] as const;

/** A stretch of paid time off (PTO). Inclusive weekday dates, like a box. */
export interface TimeOff {
  start: Day;
  end: Day;
  note?: string;
}

/** An engineer who can be assigned to boxes (roadmap/people.yaml). */
export interface Person {
  id: string;
  name: string;
  /** Department they usually work in, to list them first there. */
  department?: string;
  /** Job title, e.g. "Senior Data Engineer". */
  role?: string;
  email?: string;
  /** Their manager's name (free text: managers needn't be on the roster). */
  manager?: string;
  notes?: string;
  /** Time off; shown as blocks on the timeline and rows in the table, and edited there. */
  pto?: TimeOff[];
}

/** How one box should sit in time relative to another. */
export type RelationType = "before" | "after" | "during" | "starts_with" | "ends_with" | "overlaps" | "apart";

export interface Relation {
  type: RelationType;
  /** The other box's 3-character code. */
  box: string;
}

export interface Box {
  id: string;
  /** 3 capital letters/digits, unique across the roadmap, never changes. Shown as <department code>-<code>. */
  code: string;
  title: string;
  /** The lane the box sits in; boxes over 1 FTE also cover the lanes below. */
  lane: string;
  /** Inclusive. */
  start: Day;
  /** Inclusive. */
  end: Day;
  type: string;
  /**
   * A flag that needs attention (an id from settings `statuses`, such as
   * at_risk, late or blocked); absent when the box is on track. Progress
   * (not started, under way, finished) comes from the dates instead.
   */
  status?: string;
  /** 0.5, 1, 1.5 or 2; 1 when not set. */
  fte: number;
  /** Ids of the engineers expected to work on it. */
  engineers?: string[];
  /** Rules relating this box to others (warnings when broken, never blocking). */
  relations?: Relation[];
  /** URL of the epic / ticket this box tracks (Jira, Linear, GitHub…). */
  epic?: string;
  description?: string;
  tags?: string[];
  links?: string[];
}

export interface Roadmap {
  settings: Settings;
  /** Sorted by `order`, then name. */
  departments: Department[];
  boxes: Box[];
  people: Person[];
}

/** Raw roadmap files keyed by path relative to `roadmap/`, e.g. `boxes/bx-1.yaml`. */
export type RoadmapFiles = Record<string, string>;

export interface Issue {
  path: string;
  message: string;
}
