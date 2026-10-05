// Git object ids, computed exactly as git computes them, so the app, the build
// and GitHub agree on which files changed by comparing SHAs. A blob's id is the
// SHA-1 of "blob <size>\0" plus its bytes; a tree's, of its sorted entries.
// Runs in browsers (WebCrypto; Pages serves https, a secure context) and in
// Node 22+ (globalThis.crypto), with no dependencies.

/** The file modes git records: a plain file, an executable, a symlink, a submodule. */
export type GitFileMode = "100644" | "100755" | "120000" | "160000";

/** A file in a tree; `path` may name subfolders ("boxes/a.yaml"). */
export interface GitTreeEntry {
  path: string;
  mode: GitFileMode;
  sha: string;
}

const SHA = /^[0-9a-f]{40}$/;
const MODES = new Set<string>(["100644", "100755", "120000", "160000"]);
const utf8 = new TextEncoder();

async function objectSha(type: "blob" | "tree", body: Uint8Array): Promise<string> {
  const head = utf8.encode(`${type} ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What `git hash-object` prints for a file with these bytes. */
export function gitBlobSha(bytes: Uint8Array): Promise<string> {
  return objectSha("blob", bytes);
}

/** git sorts a tree by name bytes, comparing a subfolder as if its name ended in "/". */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

interface Folder {
  files: Map<string, { mode: GitFileMode; sha: string }>;
  folders: Map<string, Folder>;
}

async function folderSha(folder: Folder): Promise<string> {
  const entries: { key: Uint8Array; head: Uint8Array; sha: string }[] = [];
  for (const [name, { mode, sha }] of folder.files) {
    entries.push({ key: utf8.encode(name), head: utf8.encode(`${mode} ${name}\0`), sha });
  }
  for (const [name, sub] of folder.folders) {
    entries.push({ key: utf8.encode(`${name}/`), head: utf8.encode(`40000 ${name}\0`), sha: await folderSha(sub) });
  }
  entries.sort((a, b) => compareBytes(a.key, b.key));
  const parts: Uint8Array[] = entries.flatMap((e) => [e.head, Uint8Array.from(e.sha.match(/../g)!, (h) => parseInt(h, 16))]);
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    body.set(p, at);
    at += p.length;
  }
  return objectSha("tree", body);
}

/**
 * The id of the tree holding these files (subfolders become nested trees):
 * what `git rev-parse <commit>:roadmap` prints when they are exactly the
 * files under roadmap/ at that commit.
 */
export async function gitTreeSha(entries: GitTreeEntry[]): Promise<string> {
  const root: Folder = { files: new Map(), folders: new Map() };
  for (const { path, mode, sha } of entries) {
    if (!SHA.test(sha)) throw new Error(`${path}: "${sha}" isn't a git object id`);
    if (!MODES.has(mode)) throw new Error(`${path}: "${mode}" isn't a git file mode`);
    const names = path.split("/");
    if (names.some((n) => n === "" || n === "." || n === "..")) throw new Error(`"${path}" isn't a path git can store`);
    const file = names.pop()!;
    let folder = root;
    for (const name of names) {
      if (folder.files.has(name)) throw new Error(`"${path}": ${name} is a file, not a folder`);
      if (!folder.folders.has(name)) folder.folders.set(name, { files: new Map(), folders: new Map() });
      folder = folder.folders.get(name)!;
    }
    if (folder.files.has(file) || folder.folders.has(file)) throw new Error(`"${path}" is listed twice`);
    folder.files.set(file, { mode, sha });
  }
  return folderSha(root);
}
