import { isMap, isScalar, parseDocument } from "yaml";
import { describe, expect, it } from "vitest";
import { FORMAT } from "../format";
import { loadRoadmap } from "../parse";
import type { RoadmapFiles } from "../types";
import { MIGRATES_FROM, MIGRATIONS, type Migration, MigrationError, planMigration, statedFormat, withFormat } from "./index";

const SETTINGS = `# Team settings for this roadmap.
title: Our roadmap   # shown in the toolbar
fiscal_year_start_month: 1
types:
  - id: project
    name: Project
    color: "#4f7cff"
`;
const ROADMAP: RoadmapFiles = {
  "settings.yaml": SETTINGS,
  "people.yaml": "people: []\n",
  "departments/eng.yaml": 'id: eng\ncode: ENG\nname: Engineering\ncolor: "#4f7cff"\nlanes:\n  - id: eng-1\n',
  "boxes/bx-1a2b-x.yaml": "id: bx-1a2b-x\ncode: K7P\ntitle: X # keep me\nlane: eng-1\nstart: 2026-11-02\nend: 2026-11-13\ntype: project\n",
};

describe("the chain", () => {
  it("runs from format 0 to this BoxOps's, one step at a time", () => {
    expect(MIGRATIONS.map((m) => [m.from, m.to])).toEqual([[0, 1]]);
    expect(MIGRATES_FROM).toBe(0);
    expect(MIGRATIONS[MIGRATIONS.length - 1].to).toBe(FORMAT);
    MIGRATIONS.forEach((m, i) => expect(m.from).toBe(i === 0 ? MIGRATES_FROM : MIGRATIONS[i - 1].to));
  });
});

describe("statedFormat", () => {
  it("reads format from settings.yaml: 0 when it isn't there", () => {
    expect(statedFormat({})).toBe(0);
    expect(statedFormat({ "settings.yaml": SETTINGS })).toBe(0);
    expect(statedFormat({ "settings.yaml": "format:\ntitle: x\n" })).toBe(0);
    expect(statedFormat({ "settings.yaml": "format: 0\n" })).toBe(0);
    expect(statedFormat({ "settings.yaml": "format: 1 # data format\n" })).toBe(1);
    expect(statedFormat({ "settings.yaml": "\uFEFFformat: 2\r\n" })).toBe(2);
    expect(statedFormat({ "settings.yaml": "" })).toBe(0);
    expect(statedFormat({ "settings.yaml": "# just a comment\n" })).toBe(0);
  });

  it("won't guess a format it can't read", () => {
    expect(() => statedFormat({ "settings.yaml": 'format: "1"\n' })).toThrow('settings.yaml: format: "1" isn’t a whole number; fix it first');
    expect(() => statedFormat({ "settings.yaml": "format: 1.5\n" })).toThrow("format: 1.5 isn’t a whole number");
    expect(() => statedFormat({ "settings.yaml": "format: -1\n" })).toThrow("format: -1 isn’t a whole number");
    expect(() => statedFormat({ "settings.yaml": "format: [1]\n" })).toThrow(MigrationError);
    expect(() => statedFormat({ "settings.yaml": "title: [unclosed\n" })).toThrow(/^settings.yaml isn’t valid YAML \(.*\); fix it first$/);
    expect(() => statedFormat({ "settings.yaml": "- a list\n" })).toThrow("settings.yaml isn’t a list of settings (`key: value` lines); fix it first");
  });
});

describe("withFormat", () => {
  it("puts format before the first setting, after the comments above it, and changes nothing else", () => {
    expect(withFormat(SETTINGS, 1)).toBe(SETTINGS.replace("title: Our", "format: 1\ntitle: Our"));
    expect(withFormat("---\ntitle: x\n", 1)).toBe("---\nformat: 1\ntitle: x\n");
  });

  it("replaces a value that's there, keeping its comment", () => {
    expect(withFormat("# c\nformat: 0 # data format\ntitle: x\n", 1)).toBe("# c\nformat: 1 # data format\ntitle: x\n");
    expect(withFormat("title: x\nformat:\n", 1)).toBe("title: x\nformat: 1\n");
    expect(withFormat("title: x\nformat:   # set me\n", 2)).toBe("title: x\nformat: 2   # set me\n");
    expect(withFormat("format: 1\n", 1)).toBe("format: 1\n");
  });

  it("keeps CRLF line ends and a BOM", () => {
    const crlf = "\uFEFF# c\r\ntitle: x\r\n";
    expect(withFormat(crlf, 1)).toBe("\uFEFF# c\r\nformat: 1\r\ntitle: x\r\n");
  });

  it("writes a file that's empty, all comments or missing", () => {
    expect(withFormat(undefined, 1)).toBe("format: 1\n");
    expect(withFormat("", 1)).toBe("format: 1\n");
    expect(withFormat("# only a comment", 1)).toBe("# only a comment\nformat: 1\n");
    expect(withFormat("# only a comment\r\n", 1)).toBe("# only a comment\r\nformat: 1\r\n");
  });

  it("handles a mapping written in braces or indented", () => {
    expect(withFormat("{title: x}\n", 1)).toBe("{format: 1, title: x}\n");
    expect(withFormat("  title: x\n  default_zoom: weeks\n", 1)).toBe("  format: 1\n  title: x\n  default_zoom: weeks\n");
  });

  it("refuses what it can't edit safely", () => {
    expect(() => withFormat("- a\n", 1)).toThrow(MigrationError);
    expect(() => withFormat("format: [1]\n", 1)).toThrow("settings.yaml: format: [1] isn’t a whole number; fix it first");
    expect(() => withFormat("format: {a: 1}\n", 1)).toThrow(MigrationError);
  });
});

describe("planMigration", () => {
  it("brings a format 0 roadmap to format 1, touching only settings.yaml, and it validates", () => {
    const before = loadRoadmap(ROADMAP);
    expect(before.formatStatus).toBe("older");
    const plan = planMigration(ROADMAP);
    expect([plan.from, plan.to, plan.steps.map((s) => s.summary), plan.changed]).toEqual([0, 1, ["stamps format: 1 in settings.yaml"], ["settings.yaml"]]);
    expect(plan.files).toEqual({ ...ROADMAP, "settings.yaml": SETTINGS.replace("title: Our", "format: 1\ntitle: Our") });
    const after = loadRoadmap(plan.files);
    expect([after.formatStatus, after.issues]).toEqual(["current", []]);
  });

  it("is idempotent: a migrated roadmap, or a current one, comes back as it was", () => {
    const once = planMigration(ROADMAP).files;
    const twice = planMigration(once);
    expect([twice.from, twice.steps, twice.changed]).toEqual([1, [], []]);
    expect(twice.files).toEqual(once);
  });

  it("creates settings.yaml for a roadmap that has none", () => {
    const { "settings.yaml": _, ...rest } = ROADMAP;
    const plan = planMigration(rest);
    expect(plan.changed).toEqual(["settings.yaml"]);
    expect(plan.files["settings.yaml"]).toBe("format: 1\n");
  });

  it("stops on a newer format, or one the chain doesn't reach", () => {
    expect(() => planMigration({ "settings.yaml": "format: 2\n" })).toThrow(
      "This roadmap is in data format 2, newer than this BoxOps reads (1): upgrade BoxOps rather than migrating",
    );
    const fromOne: Migration = { from: 1, to: 2, summary: "x", files: (f) => f };
    expect(() => planMigration({ "settings.yaml": "title: x\n" }, [fromOne], 2)).toThrow(
      "No migration from data format 0: this BoxOps migrates format 1 and later",
    );
  });

  // A made-up format 2 that renames a setting, the way a real migration would: with the
  // Document API, editing text in place, idempotent, and leaving `format` to the chain.
  const rename: Migration = {
    from: 1,
    to: 2,
    summary: "renames default_zoom to zoom",
    files: (files) => {
      const text = files["settings.yaml"];
      if (text === undefined) return files;
      const doc = parseDocument(text);
      const pair = isMap(doc.contents) ? doc.contents.items.find((p) => isScalar(p.key) && p.key.value === "default_zoom") : undefined;
      const range = pair && isScalar(pair.key) ? pair.key.range : null;
      if (!range) return files;
      return { ...files, "settings.yaml": `${text.slice(0, range[0])}zoom${text.slice(range[1])}` };
    },
  };

  it("runs every step in order and stamps the last format once, keeping comments and order", () => {
    const old = "# Settings\ntitle: X # the title\ndefault_zoom: weeks # how far\nfiscal_year_start_month: 2\n";
    const plan = planMigration({ "settings.yaml": old }, [...MIGRATIONS, rename], 2);
    expect(plan.steps.map((s) => s.to)).toEqual([1, 2]);
    expect(plan.files["settings.yaml"]).toBe("# Settings\nformat: 2\ntitle: X # the title\nzoom: weeks # how far\nfiscal_year_start_month: 2\n");
    // Again, and from the middle of the chain: nothing more changes.
    expect(planMigration(plan.files, [...MIGRATIONS, rename], 2).changed).toEqual([]);
    const fromOne = planMigration({ "settings.yaml": "format: 1\ndefault_zoom: weeks\n" }, [...MIGRATIONS, rename], 2);
    expect([fromOne.steps.length, fromOne.files["settings.yaml"]]).toEqual([1, "format: 2\nzoom: weeks\n"]);
  });

  it("reports files a step added or deleted as changed", () => {
    const split: Migration = { from: 1, to: 2, summary: "x", files: ({ "people.yaml": _, ...rest }) => ({ ...rest, "teams.yaml": "teams: []\n" }) };
    const plan = planMigration({ "settings.yaml": "format: 1\n", "people.yaml": "people: []\n" }, [...MIGRATIONS, split], 2);
    expect(plan.changed).toEqual(["people.yaml", "settings.yaml", "teams.yaml"]);
    expect(Object.keys(plan.files).sort()).toEqual(["settings.yaml", "teams.yaml"]);
  });
});
