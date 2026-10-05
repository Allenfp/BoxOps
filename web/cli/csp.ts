// The built page's Content-Security-Policy, which vite.config.ts adds to
// index.html. Node-only.

import { createHash } from "node:crypto";

/**
 * The source allowing an inline script, by the hash of its text as a browser
 * hashes it: after the HTML parser has turned every CR LF and lone CR into LF.
 * So an index.html checked out with CRLF line ends (Git for Windows' default)
 * gets hashes its scripts still run under.
 */
export const scriptHash = (text: string) =>
  `'sha256-${createHash("sha256").update(text.replace(/\r\n?/g, "\n")).digest("base64")}'`;

/**
 * index.html with its Content-Security-Policy, as a meta tag (Pages can't
 * send headers): scripts and styles only from the site, except index.html's
 * inline scripts, allowed by their hashes; network calls only to the site,
 * the GitHub API and raw.githubusercontent.com (anonymous reads of a public
 * repository). React's style props go through the CSSOM, which style-src
 * doesn't govern. It goes straight after <meta charset>, which must stay in
 * the first 1024 bytes, and before anything it governs.
 */
export function withContentSecurityPolicy(html: string): string {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => scriptHash(m[1]));
  const policy = [
    "default-src 'none'",
    `script-src 'self' ${inline.join(" ")}`.trim(),
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' https://api.github.com https://raw.githubusercontent.com",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  const charset = /<meta charset="[^"]*"\s*\/?>/i;
  if (!charset.test(html)) throw new Error("index.html has no <meta charset> to put the Content-Security-Policy after.");
  return html.replace(charset, (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
}
