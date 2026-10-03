import type { Day } from "./dates";

export type ZoomLevel = "weeks" | "months" | "quarters";
export const ZOOM_LEVELS: ZoomLevel[] = ["weeks", "months", "quarters"];

export interface BoxType {
  id: string;
  name: string;
  color: string;
}

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
}

export interface Department {
  id: string;
  name: string;
  color: string;
  order: number;
  collapsed: boolean;
  lanes: Lane[];
}

export interface Box {
  id: string;
  title: string;
  lane: string;
  /** Inclusive. */
  start: Day;
  /** Inclusive. */
  end: Day;
  type: string;
  status: string;
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
}

/** Raw roadmap files keyed by path relative to `roadmap/`, e.g. `boxes/bx-1.yaml`. */
export type RoadmapFiles = Record<string, string>;

export interface Issue {
  path: string;
  message: string;
}
