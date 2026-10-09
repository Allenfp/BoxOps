// What to tell the user about a GitHubFailure, in plain English, one kind at a
// time. Every place that shows a GitHub problem uses these words.

import type { FailureKind, GitHubFailure } from "./api";

/** Failures a different token fixes: where one is shown, a different token is offered, with how to make it. */
export const TOKEN_KINDS: readonly FailureKind[] = ["no-access", "read-only", "token-policy", "sso"];

/** Where the failed call was going. */
export interface FailurePlace {
  /** "owner/repo" */
  repo: string;
  branch: string;
}

const two = (n: number) => String(n).padStart(2, "0");

/** "14:05", or "2026-10-05 14:05" when that isn't today. */
function clock(at: number, now: number): string {
  const d = new Date(at);
  const day = (x: Date) => `${x.getFullYear()}-${two(x.getMonth() + 1)}-${two(x.getDate())}`;
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return day(d) === day(new Date(now)) ? time : `${day(d)} ${time}`;
}

function seconds(n: number): string {
  if (n < 90) return `${Math.max(1, Math.ceil(n))} seconds`;
  return `${Math.ceil(n / 60)} minutes`;
}

/** One message per failure kind; `now` is for the time a rate limit lifts. */
export function failureMessage(f: GitHubFailure, { repo, branch }: FailurePlace, now = Date.now()): string {
  const owner = repo.split("/")[0];
  const d = f.detail;
  const id = d.requestId ? ` (GitHub request id ${d.requestId})` : "";
  switch (f.kind) {
    case "unauthorized":
      return "GitHub rejected this token. Check it was copied fully and hasn’t expired or been revoked.";
    case "no-access":
      // GET /repos, asked after the save was refused, says this token sees the repository: it's about writing.
      if (d.visible) {
        return d.push === false
          ? `Your GitHub account can’t write to ${repo}. Ask an admin for Write access.`
          : `This token can see ${repo} but can’t save to it. Edit the token: give it this repository, with Contents set to Read and write.`;
      }
      return (
        `This token can’t see ${repo}. When you create a fine-grained token, set Resource owner to ${owner} (not your own ` +
        `account) and give it this repository. If ${owner} approves tokens, an owner must approve it first; until then it ` +
        `can’t read private repositories. Your GitHub account also needs access to the repository. An outside collaborator ` +
        `can’t use a fine-grained token: use a classic token with the repo scope.`
      );
    case "missing":
      return `${repo} has no branch “${branch}”.`;
    case "sso":
      return (
        `${owner} uses single sign-on. Authorize this token for ${owner} (Configure SSO, next to the token in your GitHub ` +
        `settings${d.ssoUrl ? `, or ${d.ssoUrl}` : ""}), then try again.`
      );
    case "token-policy":
      return (
        `${owner} doesn’t accept this token: “${f.message}” Create the kind of token ${owner} allows (fine-grained or ` +
        `classic), with a lifetime within its limit, then try again.`
      );
    case "ip-blocked":
      return `${owner} only allows GitHub access from approved networks. Connect to the company network or VPN, then try again.`;
    case "rate-limited":
      if (!d.secondary) {
        const spent = d.anonymous
          ? "This network has used up GitHub’s hourly allowance for calls without a token (60 an hour per IP address)."
          : "This token has used up GitHub’s hourly allowance.";
        return `${spent} Try again ${d.resetAt ? `after ${clock(d.resetAt, now)}` : "in an hour"}.`;
      }
      return `GitHub asked BoxOps to slow down. Try again in ${seconds(d.retryAfter ?? 60)}.`;
    case "rules": {
      let text =
        `GitHub’s rules for ${branch} blocked this save: “${f.message.trim()}” BoxOps saves straight to ${branch}, so an ` +
        `admin has to let editors through: add a team you’re in, a role you hold, or an app to the rule’s bypass list as ` +
        `Always allow or Exempt (not For pull requests only), or turn the rule off for this repository. (A bypass list ` +
        `takes teams, roles and apps, not individual people.)`;
      // A rule about signatures: what it asks, not why this save didn't meet it, which isn't known: GitHub
      // signs a save's commit (github/save.ts).
      if (/signature|signed commit/i.test(f.message)) text += ` ${branch} only accepts signed commits.`;
      if (/email|commit message/i.test(f.message)) {
        text +=
          " BoxOps commits are authored by your GitHub account (with its email privacy setting) and committed by GitHub, " +
          "so rules on author or committer email or on the message have to allow that.";
      }
      return text;
    }
    case "read-only":
      if (d.read) {
        return (
          `This token can see ${repo} but not read its files. Edit the token and give it Contents access: Read and ` +
          "write to save (Read-only is enough to view)."
        );
      }
      return d.push === false
        ? `Your GitHub account can’t write to ${repo}. Ask an admin for Write access.`
        : `This token can read ${repo} but not write to it. Edit the token and set Contents to Read and write.`;
    case "stale":
      return "Others kept saving while BoxOps was saving. Try again in a moment.";
    // Not where the changes are kept: the save dialog says that, knowing whether this browser keeps them.
    case "offline":
      return f.ambiguous
        ? "Couldn’t reach GitHub, so BoxOps can’t tell whether this save went through. Trying again checks first, so nothing is saved twice."
        : "Couldn’t reach GitHub: you may be offline, or a network filter may be blocking api.github.com. Save again once you’re connected.";
    case "timeout":
      return f.ambiguous
        ? "GitHub didn’t answer in time, so BoxOps can’t tell whether this save went through. Trying again checks first, so nothing is saved twice."
        : "GitHub didn’t answer in time. Try again in a moment.";
    case "server":
      return `GitHub had a problem${d.status && d.status !== 200 ? ` (HTTP ${d.status})` : ""}. Try again in a minute.${id}`;
    case "unknown":
      return `GitHub said: “${f.message}”${id}`;
  }
}
