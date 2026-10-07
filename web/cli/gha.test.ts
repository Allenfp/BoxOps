import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Runner, annotation, clip, codeBlock, escapeData, escapeProperty, getInput, logLine, outputBlock } from "./gha";
import { NASTY, NASTY_SHOWN, obeyed, runnerCommand } from "./test-release";

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

  it("keeps a log line from being read as either form of workflow command", () => {
    const lines = [
      "roadmap/zz ##[stop-commands]x.txt: unexpected file",
      "roadmap/a.yaml: lane: \"##[set-output name=site]x\" does not exist",
      "##[add-mask]secret",
      "a ##[ADD-MATCHER]roadmap/matcher.json b ##[error]forged",
      "###[warning]x",
      "::error::forged",
      " \t::set-output name=site::x",
      "\u00a0\u3000\u2028::warning::x",
      "\u0085::notice::x",
      "\u200b::debug::x",
    ];
    // The runner (as runnerCommand reads it) would take each as a command…
    for (const line of lines.slice(0, -1)) expect(runnerCommand(line), line).not.toBeNull();
    // …and takes none once it's a log line.
    for (const line of lines) expect(runnerCommand(logLine(line)), logLine(line)).toBeNull();
    expect(logLine(lines[0])).toBe("roadmap/zz ## [stop-commands]x.txt: unexpected file");
    expect(logLine("###[warning]x ##[##[y")).toBe("### [warning]x ## [## [y");
    expect(logLine(" \t::set-output name=site::x")).toBe(" \t: :set-output name=site::x");
    expect(logLine("\u200b::debug::x")).toBe("\u200b: :debug::x");
    // Text that isn't a command stays as it is.
    expect(logLine("roadmap/a.yaml:3: title: \"a::b #[1]\" ## [x]")).toBe("roadmap/a.yaml:3: title: \"a::b #[1]\" ## [x]");
  });

  it("shows control characters as escapes in a log line, an annotation and a code block: the log viewer obeys ESC", () => {
    const lines = [
      logLine(`a ${NASTY}\r\nb`),
      annotation("error", `x ${NASTY}\ny`, { file: `roadmap/${NASTY}.txt`, title: `t ${NASTY}` }),
      ...codeBlock(`one ${NASTY}\ntwo`).split("\n"),
    ];
    expect(lines.flatMap(obeyed)).toEqual([]);
    expect(lines).toEqual([
      // CR, and line breaks, a space in a log line; in an annotation, line breaks stay (%0A).
      `a ${NASTY_SHOWN.replace("\\r", " ")} b`,
      `::error file=roadmap/${NASTY_SHOWN}.txt,title=t ${NASTY_SHOWN}::x ${NASTY_SHOWN}%0Ay`,
      "```text",
      `one ${NASTY_SHOWN}`,
      "two",
      "```",
      "",
    ]);
  });

  it("fences a code block longer than any backticks in it", () => {
    expect(codeBlock("plain")).toBe("```text\nplain\n```\n");
    expect(codeBlock("a ```` b")).toBe("`````text\na ```` b\n`````\n");
    // More runs of backticks than a call takes arguments, as one value under the 1 MiB a file may be can hold.
    const many = `${"`a".repeat(200_000)} \`\`\`\`\``;
    expect(codeBlock(many)).toBe(`\`\`\`\`\`\`text\n${many}\n\`\`\`\`\`\`\n`);
  });

  it("clips a line of the summary to 1,000 characters, never inside one", () => {
    expect(clip("short")).toBe("short");
    expect(clip("x".repeat(1000))).toBe("x".repeat(1000));
    expect(clip("x".repeat(400_000))).toBe(`${"x".repeat(999)}…`);
    // An emoji, two UTF-16 code units, where the cut falls: left out whole.
    expect(clip(`${"x".repeat(998)}😀yz`)).toBe(`${"x".repeat(998)}…`);
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
    runner.log("::warning::nor this ##[stop-commands]x");
    expect(parseOutputs(readFileSync(output, "utf8"))).toEqual({ earlier: "kept", site: "/tmp/site" });
    expect(readFileSync(summary, "utf8")).toBe("### BoxOps\n");
    expect(lines).toEqual(["::warning title=BoxOps::w%0Ax", "plain ::error::not a command", ": :warning::nor this ## [stop-commands]x"]);
    expect(runner.counts).toEqual({ error: 0, warning: 1, notice: 0 });

    const bare: string[] = [];
    new Runner({}, (l) => bare.push(l)).setOutput("site", "/tmp/site");
    expect(bare).toEqual(["site=/tmp/site"]);
  });
});
