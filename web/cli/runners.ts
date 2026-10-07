// Runner labels GitHub has retired: a job asking for one never starts (or,
// for a while before, fails at times on purpose). The action warns about them
// in a roadmap repository's workflows and `doctor` lists them, since pins
// freeze BoxOps but not the runner images the workflows ask for.

import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";

/** Label → the day GitHub stopped running it (YYYY-MM-DD) and what to use instead. */
export const RETIRED_RUNNERS: Readonly<Record<string, { retired: string; use: string }>> = {
  "macos-12": { retired: "2024-12-03", use: "macos-15" },
  "ubuntu-20.04": { retired: "2025-04-15", use: "ubuntu-24.04" },
  "windows-2019": { retired: "2025-06-30", use: "ubuntu-24.04 (BoxOps doesn’t support Windows runners)" },
  "macos-13": { retired: "2025-12-04", use: "macos-15" },
};

export interface RunnerWarning {
  line: number;
  label: string;
  message: string;
}

/**
 * Retired labels a workflow asks for: in a job's `runs-on` (a label, a list,
 * or `labels:`) or in a matrix list a `runs-on` may take from. `today`
 * (YYYY-MM-DD) decides whether one is retired yet or only retiring.
 */
export function retiredRunners(text: string, today: string): RunnerWarning[] {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  if (doc.errors.length || !isMap(doc.contents)) return [];
  const out: RunnerWarning[] = [];
  const seen = new Set<string>();
  const check = (node: unknown) => {
    if (isScalar(node) && typeof node.value === "string") {
      const label = node.value.trim();
      const r = RETIRED_RUNNERS[label];
      const line = node.range ? lines.linePos(node.range[0]).line : 0;
      if (!r || seen.has(`${line}:${label}`)) return;
      seen.add(`${line}:${label}`);
      const when = r.retired <= today ? `GitHub retired it on ${r.retired}: jobs on it don’t start` : `GitHub retires it on ${r.retired}`;
      out.push({ line, label, message: `runs on ${label}; ${when}. Use ${r.use}.` });
    } else if (isSeq(node)) node.items.forEach(check);
    else if (isMap(node)) check(node.get("labels", true));
  };
  const jobs = doc.contents.get("jobs", true);
  if (!isMap(jobs)) return out;
  for (const pair of jobs.items) {
    const job = pair.value as Node | null;
    if (!isMap(job)) continue;
    check(job.get("runs-on", true));
    const matrix = (job.getIn(["strategy", "matrix"], true) ?? null) as Node | null;
    if (isMap(matrix)) for (const item of matrix.items) if (isSeq(item.value)) item.value.items.forEach(check);
  }
  return out.sort((a, b) => a.line - b.line);
}
