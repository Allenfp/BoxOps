// What to tell the user about a GitHubFailure, in plain English, one kind at a
// time. Every place that shows a GitHub problem uses these words.

import type { GitHubFailure } from "./api";

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
      return (
        `This token can’t see ${repo}. When you create a fine-grained token, set Resource owner to ${owner} (not your own ` +
        `account) and give it this repository. If ${owner} approves tokens, an owner must approve it first; until then it ` +
        `can’t read private repositories. Your GitHub account also needs access to the repository. An outside collaborator ` +
        `can’t use a fine-grained token: use a classic token with the repo scope (authorized for single sign-on if ${owner} uses it).`
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
        return d.resetAt
          ? `This token has used up GitHub’s hourly allowance. Try again after ${clock(d.resetAt, now)}.`
          : "This token has used up GitHub’s hourly allowance. Try again in an hour.";
      }
      return `GitHub asked BoxOps to slow down. Try again in ${seconds(d.retryAfter ?? 60)}.`;
    case "rules": {
      let text =
        `GitHub’s rules for ${branch} blocked this save: “${f.message.trim()}” BoxOps saves straight to ${branch}, so an ` +
        `admin has to let editors through: add a team you’re in (or a role you hold) to the rule’s bypass list as Always ` +
        `allow, or as Exempt (not For pull requests only), or turn the rule off for this repository.`;
      if (/sign/i.test(f.message)) text += ` ${branch} only accepts signed commits, and GitHub didn’t sign this one.`;
      if (/email|commit message/i.test(f.message)) {
        text +=
          " BoxOps commits are authored by your GitHub account (with its email privacy setting) and committed by GitHub, " +
          "so rules on author or committer email or on the message have to allow that.";
      }
      return text;
    }
    case "read-only":
      return d.push === false
        ? `Your GitHub account can’t write to ${repo}. Ask an admin for Write access.`
        : `This token can read ${repo} but not write to it. Edit the token and set Contents to Read and write.`;
    case "stale":
      return "Others kept saving while BoxOps was saving. Try again in a moment.";
    case "offline":
      return f.ambiguous
        ? "Couldn’t reach GitHub, so BoxOps can’t tell whether this save went through. Your changes are kept in this browser; trying again checks first, so nothing is saved twice."
        : "Couldn’t reach GitHub. Your changes are kept in this browser.";
    case "timeout":
      return f.ambiguous
        ? "GitHub didn’t answer in time, so BoxOps can’t tell whether this save went through. Your changes are kept in this browser; trying again checks first, so nothing is saved twice."
        : "GitHub didn’t answer in time. Your changes are kept in this browser.";
    case "server":
      return `GitHub had a problem${d.status && d.status !== 200 ? ` (HTTP ${d.status})` : ""}. Try again in a minute.${id}`;
    case "unknown":
      return `GitHub said: “${f.message}”${id}`;
  }
}
