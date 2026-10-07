// GitHub Actions' side of the action (cli/action.ts): workflow commands
// (annotations), step outputs and the job summary, with the escaping each
// needs. Node-only.
//
// Everything here may carry roadmap text, which anyone who can push to the
// roadmap controls, so none of it can end a command early or start one of
// its own: a message's %, CR and LF are escaped (a property's : and , too),
// a log line never holds a line break, an output's heredoc delimiter is one
// its value doesn't hold, and the summary shows text in a code block whose
// fence is longer than any run of backticks in it.

import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";

/** A workflow command's message: GitHub reads %25, %0D and %0A back as %, CR and LF. */
export const escapeData = (text: string) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** A workflow command's property value (`file=…`, `title=…`): its : and , are escaped too. */
export const escapeProperty = (text: string) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** One line for the log: line breaks become spaces, so no text can start a line of its own (a workflow command). */
export const logLine = (text: string) => text.replace(/[\r\n]+/g, " ");

export type Level = "error" | "warning" | "notice";

export interface Where {
  /** Path from the repository's top level. */
  file?: string;
  line?: number;
  title?: string;
}

/** `::error file=…,line=…,title=…::message`: an annotation on the run, and on the file's line in a pull request. */
export function annotation(level: Level, message: string, where: Where = {}): string {
  const props = [
    where.file !== undefined && `file=${escapeProperty(where.file)}`,
    where.line !== undefined && `line=${where.line}`,
    where.title !== undefined && `title=${escapeProperty(where.title)}`,
  ].filter(Boolean);
  return `::${level}${props.length ? ` ${props.join(",")}` : ""}::${escapeData(message)}`;
}

const OUTPUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * A step output as $GITHUB_OUTPUT takes it: `name<<DELIMITER`, the value,
 * then the delimiter, each on a line of its own. The delimiter is random and
 * never a line of the value (`delimiter` picks it, for tests), so no value
 * can end the output early and set another.
 */
export function outputBlock(name: string, value: string, delimiter = () => `ghadelimiter_${randomBytes(16).toString("hex")}`): string {
  if (!OUTPUT_NAME.test(name)) throw new Error(`"${name}" isn’t an output name`);
  const lines = new Set(value.split(/\r?\n/));
  let d = delimiter();
  for (let tries = 0; lines.has(d) || name === d; tries++) {
    if (tries === 10) throw new Error(`no delimiter for output ${name}`);
    d = delimiter();
  }
  return `${name}<<${d}\n${value}\n${d}\n`;
}

/**
 * Text as a fenced code block in the job summary (Markdown): nothing in it is
 * read as Markdown or HTML, whatever the roadmap's names hold.
 */
export function codeBlock(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}\n`;
}

export type Env = Record<string, string | undefined>;

/**
 * An action input as the runner passes it: `INPUT_<NAME>`, upper-cased with
 * spaces as "_" (a hyphen stays: `INPUT_ON-PROBLEMS`), trimmed. "" when unset.
 */
export function getInput(env: Env, name: string): string {
  return (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}

/** Where the action writes: the log (stdout), $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY. */
export class Runner {
  /** Annotations made, by level, for the summary and tests. */
  readonly counts: Record<Level, number> = { error: 0, warning: 0, notice: 0 };

  constructor(
    private env: Env,
    private out: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  ) {}

  log(text: string): void {
    this.out(logLine(text));
  }

  annotate(level: Level, message: string, where: Where = {}): void {
    this.counts[level]++;
    this.out(annotation(level, message, where));
  }

  /** Sets a step output; outside Actions (no $GITHUB_OUTPUT) it's logged instead. */
  setOutput(name: string, value: string): void {
    const file = this.env.GITHUB_OUTPUT;
    if (file) appendFileSync(file, outputBlock(name, value));
    else this.log(`${name}=${value}`);
  }

  /** Adds Markdown to the job summary, if there is one. */
  summary(markdown: string): void {
    const file = this.env.GITHUB_STEP_SUMMARY;
    if (file) appendFileSync(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  }
}
