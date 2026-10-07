import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Runner, annotation, codeBlock, escapeData, escapeProperty, getInput, logLine, outputBlock } from "./gha";

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** What the runner makes of $GITHUB_OUTPUT (its heredoc form, as actions/toolkit documents it). */
function parseOutputs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^<]+)<<(.+)$/.exec(lines[i]);
    if (!m) continue;
    const value: string[] = [];
    for (i++; lines[i] !== m[2]; i++) {
      if (i >= lines.length) throw new Error(`unterminated output ${m[1]}`);
      value.push(lines[i]);
    }
    out[m[1]] = value.join("\n");
  }
  return out;
}

/** A delimiter maker that gives these, in turn. */
const picks = (...list: string[]) => () => list.shift()!;

describe("escaping", () => {
  it("escapes %, CR and LF in a message, and : and , too in a property", () => {
    expect(escapeData("100% done\r\nnext\nline")).toBe("100%25 done%0D%0Anext%0Aline");
    expect(escapeProperty("roadmap/a:b,c%\n")).toBe("roadmap/a%3Ab%2Cc%25%0A");
    // Escaped once: GitHub reads %25 back as %, so "%0A" in the text stays text.
    expect(escapeData("%0A")).toBe("%250A");
  });

  it("makes annotations no text can break out of", () => {
    expect(annotation("error", "id: \"x\" is wrong", { file: "roadmap/boxes/x.yaml", line: 3, title: "BoxOps" })).toBe(
      '::error file=roadmap/boxes/x.yaml,line=3,title=BoxOps::id: "x" is wrong',
    );
    expect(annotation("warning", "two\nlines")).toBe("::warning::two%0Alines");
    expect(annotation("notice", "x", { title: "a, b: c" })).toBe("::notice title=a%2C b%3A c::x");
    // A message that tries to end the command and start another stays on its line.
    const sneaky = annotation("error", "bad\n::set-output name=problems::0", { file: "roadmap/a,line=1.yaml" });
    expect(sneaky.split("\n")).toHaveLength(1);
    expect(sneaky).toBe("::error file=roadmap/a%2Cline=1.yaml::bad%0A::set-output name=problems::0");
  });

  it("keeps a log line on one line", () => {
    expect(logLine("a\r\n::error::x\nb")).toBe("a ::error::x b");
  });

  it("fences a code block longer than any backticks in it", () => {
    expect(codeBlock("plain")).toBe("```text\nplain\n```\n");
    expect(codeBlock("a ```` b")).toBe("`````text\na ```` b\n`````\n");
  });

  it("reads inputs as the runner names them", () => {
    const env = { INPUT_MODE: " check ", "INPUT_ON-PROBLEMS": "fail", INPUT_RELEASES_FILE: "x" };
    expect(getInput(env, "mode")).toBe("check");
    expect(getInput(env, "on-problems")).toBe("fail");
    expect(getInput(env, "releases file")).toBe("x");
    expect(getInput(env, "summary")).toBe("");
  });
});

describe("outputs", () => {
  it("writes single- and multi-line values the runner reads back exactly", () => {
    const values = { problems: "3", result: "1 departments, 2 lanes, 2 boxes — OK", multi: "line 1\nline 2\r\n\nline 4", empty: "" };
    const text = Object.entries(values)
      .map(([k, v]) => outputBlock(k, v))
      .join("");
    expect(parseOutputs(text)).toEqual({ ...values, multi: "line 1\nline 2\r\n\nline 4" });
  });

  it("picks another delimiter when the value holds one as a line", () => {
    const block = outputBlock("x", "a\nEOF\nb", picks("EOF", "EOF", "OTHER"));
    expect(block).toBe("x<<OTHER\na\nEOF\nb\nOTHER\n");
    expect(parseOutputs(block)).toEqual({ x: "a\nEOF\nb" });
    // A CRLF line counts as that line too.
    expect(outputBlock("y", "EOF\r\nz", picks("EOF", "D2"))).toBe("y<<D2\nEOF\r\nz\nD2\n");
    expect(() => outputBlock("x", "EOF", () => "EOF")).toThrow("no delimiter for output x");
  });

  it("can't be fooled into setting another output by a value", () => {
    const value = "1\nghadelimiter_0\nproblems<<X\n0\nX";
    const text = outputBlock("result", value) + outputBlock("problems", "5");
    expect(parseOutputs(text)).toEqual({ result: value, problems: "5" });
  });

  it("refuses an output name the runner wouldn't read", () => {
    expect(() => outputBlock("a<<b", "x")).toThrow('"a<<b" isn’t an output name');
    expect(() => outputBlock("a\nb", "x")).toThrow();
  });

  it("appends outputs and the summary to the runner's files, or logs them outside Actions", () => {
    const dir = mkdtempSync(join(tmpdir(), "boxops-test-"));
    temps.push(dir);
    const output = join(dir, "output");
    const summary = join(dir, "summary");
    writeFileSync(output, "earlier<<E\nkept\nE\n");
    const lines: string[] = [];
    const runner = new Runner({ GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, (l) => lines.push(l));
    runner.setOutput("site", "/tmp/site");
    runner.summary("### BoxOps");
    runner.annotate("warning", "w\nx", { title: "BoxOps" });
    runner.log("plain\n::error::not a command");
    expect(parseOutputs(readFileSync(output, "utf8"))).toEqual({ earlier: "kept", site: "/tmp/site" });
    expect(readFileSync(summary, "utf8")).toBe("### BoxOps\n");
    expect(lines).toEqual(["::warning title=BoxOps::w%0Ax", "plain ::error::not a command"]);
    expect(runner.counts).toEqual({ error: 0, warning: 1, notice: 0 });

    const bare: string[] = [];
    new Runner({}, (l) => bare.push(l)).setOutput("site", "/tmp/site");
    expect(bare).toEqual(["site=/tmp/site"]);
  });
});
