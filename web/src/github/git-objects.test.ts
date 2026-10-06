import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TestRepo } from "../../cli/test-repo";
import { type GitTreeEntry, gitBlobSha, gitTreeSha, textBlobSha, utf8Text, utf8ToBase64 } from "./git-objects";

const repo = new TestRepo();
afterAll(() => repo.remove());
const utf8 = new TextEncoder();

describe("gitBlobSha", () => {
  const cases: Record<string, Uint8Array> = {
    empty: new Uint8Array(),
    yaml: utf8.encode("id: a\ntitle: A\n"),
    "a BOM": utf8.encode("\uFEFFid: a\n"),
    "CRLF line ends": utf8.encode("id: a\r\ntitle: A\r\n"),
    "bytes that aren't UTF-8": Uint8Array.from([0x69, 0x64, 0x3a, 0x20, 0xe9, 0x0a]),
    "NUL bytes": Uint8Array.from([0, 1, 2, 0, 255]),
    "1 MiB": Uint8Array.from({ length: 1024 * 1024 }, (_, i) => (i * 31) % 251),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    it(`matches git hash-object: ${name}`, async () => {
      expect(await gitBlobSha(bytes)).toBe(repo.git(["hash-object", "--stdin"], { input: bytes }));
    });
  }
});

describe("gitTreeSha", () => {
  it("matches git for a checked-out folder with subfolders, an executable and a symlink", async () => {
    const work = new TestRepo();
    try {
      const files: Record<string, string> = {
        "roadmap/settings.yaml": "format: 1\n",
        "roadmap/boxes/b1.yaml": "id: b1\n",
        "roadmap/boxes/deep/x.yaml": "x: 1\n",
        "roadmap/run.sh": "#!/bin/sh\n",
        "README.md": "outside\n",
      };
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(work.dir, path, ".."), { recursive: true });
        writeFileSync(join(work.dir, path), text);
      }
      chmodSync(join(work.dir, "roadmap/run.sh"), 0o755);
      symlinkSync("settings.yaml", join(work.dir, "roadmap/link.yaml"));
      work.git(["add", "-A"]);
      work.git(["commit", "-q", "-m", "x"]);

      const entries: GitTreeEntry[] = [
        { path: "settings.yaml", mode: "100644", sha: await gitBlobSha(utf8.encode(files["roadmap/settings.yaml"])) },
        { path: "boxes/b1.yaml", mode: "100644", sha: await gitBlobSha(utf8.encode(files["roadmap/boxes/b1.yaml"])) },
        { path: "boxes/deep/x.yaml", mode: "100644", sha: await gitBlobSha(utf8.encode(files["roadmap/boxes/deep/x.yaml"])) },
        { path: "run.sh", mode: "100755", sha: await gitBlobSha(utf8.encode(files["roadmap/run.sh"])) },
        { path: "link.yaml", mode: "120000", sha: await gitBlobSha(utf8.encode("settings.yaml")) },
      ];
      expect(await gitTreeSha(entries)).toBe(work.git(["rev-parse", "HEAD:roadmap"]));
      expect(await gitTreeSha(entries.filter((e) => e.path.startsWith("boxes/")).map((e) => ({ ...e, path: e.path.slice(6) })))).toBe(
        work.git(["rev-parse", "HEAD:roadmap/boxes"]),
      );
    } finally {
      work.remove();
    }
  });

  it("sorts like git: a folder as if its name ended in '/', names by UTF-8 bytes; submodules too", async () => {
    const texts: Record<string, string> = {
      "b-c": "1\n", // '-' sorts before the folder b/
      "b.yaml": "2\n", // '.' too
      "b/x.yaml": "3\n",
      b0: "4\n", // '0' after it
      "ｚ.yaml": "5\n", // U+FF5A: before U+1F600 in UTF-8, after it in UTF-16
      "😀.yaml": "6\n",
      "Z.yaml": "7\n",
    };
    const entries: GitTreeEntry[] = [];
    for (const [path, text] of Object.entries(texts)) entries.push({ path, mode: "100644", sha: await gitBlobSha(utf8.encode(text)) });
    const sub = repo.commit({ "a.txt": "submodule's own commit\n" });
    entries.push({ path: "b/sub", mode: "160000", sha: sub });

    const commit = repo.commit({
      ...Object.fromEntries(Object.entries(texts).map(([p, t]) => [`roadmap/${p}`, t])),
      "roadmap/b/sub": { mode: "160000", sha: sub },
    });
    expect(await gitTreeSha(entries)).toBe(repo.git(["rev-parse", `${commit}:roadmap`]));
    // Order in doesn't matter.
    expect(await gitTreeSha([...entries].reverse())).toBe(repo.git(["rev-parse", `${commit}:roadmap`]));
  });

  it("of nothing is git's empty tree", async () => {
    expect(await gitTreeSha([])).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  });

  it("refuses entries git couldn't store", async () => {
    const sha = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
    await expect(gitTreeSha([{ path: "a", mode: "100644", sha: "abc" }])).rejects.toThrow("isn’t a git object id");
    await expect(gitTreeSha([{ path: "a", mode: "100664" as "100644", sha }])).rejects.toThrow("isn’t a git file mode");
    await expect(gitTreeSha([{ path: "a/../b", mode: "100644", sha }])).rejects.toThrow("isn’t a path git can store");
    await expect(gitTreeSha([{ path: "a", mode: "100644", sha }, { path: "a/b", mode: "100644", sha }])).rejects.toThrow("is a file");
    await expect(gitTreeSha([{ path: "a/b", mode: "100644", sha }, { path: "a", mode: "100644", sha }])).rejects.toThrow("listed twice");
  });
});

describe("text", () => {
  it("hashes text as its UTF-8 bytes, BOM included", async () => {
    for (const text of ["", "title: Zoë\n", "\uFEFFid: a\r\n"]) {
      expect(await textBlobSha(text)).toBe(repo.git(["hash-object", "--stdin"], { input: utf8.encode(text) }));
    }
  });

  it("decodes UTF-8 exactly: a BOM kept, anything else refused", () => {
    expect(utf8Text(utf8.encode("\uFEFFid: a\n"))).toBe("\uFEFFid: a\n");
    expect(utf8Text(Uint8Array.from([0x69, 0x64, 0x3a, 0x20, 0xe9, 0x0a]))).toBeNull();
  });

  it("encodes base64 as RFC 4648 asks (padded), for big files and any character", () => {
    for (const text of ["", "a", "ab", "abc", "Zoë’s café 🚀\n", "\uFEFFid: a\n"]) {
      expect(utf8ToBase64(text)).toBe(Buffer.from(text, "utf8").toString("base64"));
    }
    const big = "title: Zoë’s café 🚀\n".repeat(150_000); // over 3 MB
    expect(utf8ToBase64(big)).toBe(Buffer.from(big, "utf8").toString("base64"));
  });
});
