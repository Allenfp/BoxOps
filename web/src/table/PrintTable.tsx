// What the table and People print (⌘P, Ctrl+P): every row as shown on
// screen (the search, dates, sort and collapsed departments), drawn or not,
// as plain text in a table of its own. The interactive table is hidden on
// paper, and this one on screen (styles.css, @media print). Dates are
// YYYY-MM-DD, as everywhere.

import { Fragment } from "react";
import { type Day, formatDay, workdays } from "../model/dates";
import { jiraKey } from "../model/jira";
import { boxScale } from "../model/scale";
import { flagName } from "../model/status";
import type { Settings } from "../model/types";
import type { PeopleRow, TableRow } from "./tableModel";
import type { LaneInfo } from "./TableRows";

const BOX_COLUMNS = [
  "Code",
  "Title",
  "Department / lane",
  "Start",
  "End",
  "Working days",
  "FTE",
  "Scale",
  "Engineers",
  "Type",
  "Flag",
  "Epic link",
  "Tags",
  "Description",
];

/** A date, never broken across lines (a narrow column would break it at a hyphen). */
const PrintDay = ({ day }: { day: Day }) => <span className="print-date">{formatDay(day)}</span>;

/** The table's rows as they're shown, on paper. */
export function PrintBoxes({
  rows,
  lanes,
  names,
  settings,
  totals,
  collapsed,
}: {
  rows: readonly TableRow[];
  lanes: ReadonlyMap<string, LaneInfo>;
  names: ReadonlyMap<string, string>;
  settings: Settings;
  /** Each department's boxes, by its id. */
  totals: ReadonlyMap<string, number>;
  /** Departments shown collapsed. */
  collapsed(id: string): boolean;
}) {
  const typeName = new Map(settings.types.map((t) => [t.id, t.name]));
  return (
    <table className="print-table">
      <thead>
        <tr>
          {BOX_COLUMNS.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          switch (r.kind) {
            case "group": {
              const n = totals.get(r.dept.id) ?? 0;
              return (
                <tr key={r.key} className="print-group">
                  <th colSpan={BOX_COLUMNS.length} scope="rowgroup">
                    {r.dept.name} · {n} box{n === 1 ? "" : "es"}
                    {collapsed(r.dept.id) ? " (collapsed)" : ""}
                  </th>
                </tr>
              );
            }
            case "box": {
              const b = r.box;
              const lane = lanes.get(b.lane);
              return (
                <tr key={r.key}>
                  <td>{`${lane?.deptCode}-${b.code}`}</td>
                  <td>{b.title}</td>
                  <td>{lane?.option ?? b.lane}</td>
                  <td>
                    <PrintDay day={b.start} />
                  </td>
                  <td>
                    <PrintDay day={b.end} />
                  </td>
                  <td>{workdays(b.start, b.end)}</td>
                  <td>{b.fte.toFixed(1)}</td>
                  <td>{boxScale(b)}</td>
                  <td>{(b.engineers ?? []).map((id) => names.get(id) ?? id).join(", ")}</td>
                  <td>{typeName.get(b.type) ?? b.type}</td>
                  <td>{flagName(settings, b.status)}</td>
                  <td>{jiraKey(b.epic) ?? b.epic}</td>
                  <td>{(b.tags ?? []).join(", ")}</td>
                  <td className="print-text">{b.description}</td>
                </tr>
              );
            }
            case "pto": {
              const { person, pto } = r.entry;
              return (
                <tr key={r.key}>
                  <td>PTO</td>
                  <td>{person.name}</td>
                  <td>{pto.note}</td>
                  <td>
                    <PrintDay day={pto.start} />
                  </td>
                  <td>
                    <PrintDay day={pto.end} />
                  </td>
                  <td>{workdays(pto.start, pto.end)}</td>
                  <td colSpan={BOX_COLUMNS.length - 6} />
                </tr>
              );
            }
            case "empty":
              return (
                <tr key={r.key}>
                  <td colSpan={BOX_COLUMNS.length}>No boxes in {r.dept.name} yet.</td>
                </tr>
              );
            default:
              return null;
          }
        })}
      </tbody>
    </table>
  );
}

const PEOPLE_COLUMNS = ["Name", "Department", "Role", "Email", "Manager", "PTO", "Notes"];

/** People's rows as they're shown, on paper. */
export function PrintPeople({ rows, collapsed }: { rows: readonly PeopleRow[]; collapsed(id: string): boolean }) {
  // Each row's department, by the heading above it ("" for No department).
  const departments: string[] = [];
  for (const [i, r] of rows.entries()) departments.push(r.kind === "group" ? (r.id ? r.name : "") : (departments[i - 1] ?? ""));
  return (
    <table className="print-table">
      <thead>
        <tr>
          {PEOPLE_COLUMNS.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          switch (r.kind) {
            case "group":
              return (
                <tr key={r.key} className="print-group">
                  <th colSpan={PEOPLE_COLUMNS.length} scope="rowgroup">
                    {r.name} · {r.total} engineer{r.total === 1 ? "" : "s"}
                    {r.id && collapsed(r.id) ? " (collapsed)" : ""}
                  </th>
                </tr>
              );
            case "person": {
              const p = r.person;
              return (
                <tr key={r.key}>
                  <td>{p.name}</td>
                  <td>{departments[i]}</td>
                  <td>{p.role}</td>
                  <td>{p.email}</td>
                  <td>{p.manager}</td>
                  <td className="print-text">
                    {(p.pto ?? [])
                      .toSorted((a, b) => a.start - b.start)
                      .map((t, k) => (
                        <Fragment key={k}>
                          {k > 0 && "\n"}
                          <PrintDay day={t.start} />
                          {t.end !== t.start && (
                            <>
                              {" – "}
                              <PrintDay day={t.end} />
                            </>
                          )}
                          {t.note && ` · ${t.note}`}
                        </Fragment>
                      ))}
                  </td>
                  <td className="print-text">{p.notes}</td>
                </tr>
              );
            }
            case "empty":
              return (
                <tr key={r.key}>
                  <td colSpan={PEOPLE_COLUMNS.length}>No engineers in {r.name} yet.</td>
                </tr>
              );
            default:
              return null;
          }
        })}
      </tbody>
    </table>
  );
}
