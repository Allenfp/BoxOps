import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareVersions, parseVersion, readReleasesFile, releaseNotices } from "./notices";
import { cleanUp, tempDir } from "./test-release";

afterEach(cleanUp);

const rel = (tag_name: string, name: string | null = `BoxOps ${tag_name.slice(1)}`, prerelease = tag_name.includes("-")) => ({ tag_name, name, prerelease });

describe("versions", () => {
  it("reads releases and release candidates only", () => {
    expect(parseVersion("0.1.0")).toEqual([0, 1, 0, null]);
    expect(parseVersion("v1.12.3")).toEqual([1, 12, 3, null]);
    expect(parseVersion("v0.2.0-rc.2")).toEqual([0, 2, 0, 2]);
    for (const other of ["0.1", "0.1.0-dev", "0.1.0-next", "main", "v0.1.0-beta.1", "0.1.0+abc"]) expect(parseVersion(other)).toBeNull();
  });

  it("orders them as semver does", () => {
    const sorted = ["0.1.1", "0.1.0", "0.2.0-rc.1", "0.1.0-rc.2", "0.10.0", "0.2.0", "0.1.0-rc.10", "1.0.0"]
      .map((v) => parseVersion(v)!)
      .sort(compareVersions)
      .map((v) => `${v[0]}.${v[1]}.${v[2]}${v[3] === null ? "" : `-rc.${v[3]}`}`);
    expect(sorted).toEqual(["0.1.0-rc.2", "0.1.0-rc.10", "0.1.0", "0.1.1", "0.2.0-rc.1", "0.2.0", "0.10.0", "1.0.0"]);
  });
});

describe("releaseNotices", () => {
  it("nothing when this is the newest release", () => {
    expect(releaseNotices("0.1.1", [rel("v0.1.1"), rel("v0.1.0", "Security: BoxOps 0.1.0")])).toEqual({ notices: [], annotations: [] });
  });

  it("the newest Security: release beats a newer plain one", () => {
    const { notices, annotations } = releaseNotices("0.1.0", [rel("v0.1.1", "Security: BoxOps 0.1.1"), rel("v0.1.3", "Security: BoxOps 0.1.3"), rel("v0.2.0")]);
    expect(notices).toEqual([
      { level: "security", text: "BoxOps v0.1.3 fixes a security problem; this site runs v0.1.0. Ask a repository admin to merge the upgrade pull request." },
    ]);
    expect(annotations.map((a) => a.level)).toEqual(["warning"]);
  });

  it("titles are matched without regard to case", () => {
    expect(releaseNotices("0.1.0", [rel("v0.1.1", "security: x")]).notices[0].level).toBe("security");
    expect(releaseNotices("0.1.0", [rel("v0.1.0", "WITHDRAWN: x")]).notices[0].level).toBe("warning");
  });

  it("ignores pre-releases and odd tags unless running a pre-release", () => {
    const list = [rel("v0.2.0-rc.1", "Security: rc"), rel("v0.2.0", "BoxOps 0.2.0", true), rel("0.3.0"), rel("v0.4.0-beta"), rel("release-0.5.0")];
    expect(releaseNotices("0.1.0", list).notices).toEqual([]);
    // Running 0.2.0-rc.0: rc.1 and the (oddly marked) 0.2.0 count; the newest is 0.2.0, but rc.1 is a security fix.
    expect(releaseNotices("0.2.0-rc.0", list).notices).toEqual([
      { level: "security", text: "BoxOps v0.2.0-rc.1 fixes a security problem; this site runs v0.2.0-rc.0. Ask a repository admin to merge the upgrade pull request." },
    ]);
  });

  it("says when this release was withdrawn, with what to move to", () => {
    const { notices, annotations } = releaseNotices("0.1.0", [rel("v0.1.0", "Withdrawn: BoxOps 0.1.0")]);
    expect(notices).toEqual([{ level: "warning", text: "This site runs BoxOps v0.1.0, which was withdrawn. Ask a repository admin to upgrade it." }]);
    expect(annotations).toEqual([{ level: "warning", message: "BoxOps v0.1.0 was withdrawn (“Withdrawn: BoxOps 0.1.0”): upgrade to a newer release." }]);
    // A newer release that was withdrawn too isn't the one to move to.
    const both = releaseNotices("0.1.0", [rel("v0.1.1", "Withdrawn: BoxOps 0.1.1"), rel("v0.1.0", "Withdrawn: BoxOps 0.1.0")]);
    expect(both).toEqual({ notices, annotations });
    const fixed = releaseNotices("0.1.0", [rel("v0.1.2"), rel("v0.1.1", "Withdrawn: BoxOps 0.1.1"), rel("v0.1.0", "Withdrawn: BoxOps 0.1.0")]);
    expect(fixed.annotations).toContainEqual({ level: "warning", message: "BoxOps v0.1.0 was withdrawn (“Withdrawn: BoxOps 0.1.0”): upgrade to a newer release (v0.1.2)." });
  });

  it("never offers a withdrawn release, though it's the newest until the one that fixes it is out", () => {
    // Withdrawn, and nothing newer yet: nothing to offer.
    expect(releaseNotices("0.1.0", [rel("v0.1.1", "Withdrawn: BoxOps 0.1.1"), rel("v0.1.0")])).toEqual({ notices: [], annotations: [] });
    expect(releaseNotices("0.1.0", [rel("v0.1.1", "withdrawn: Security: BoxOps 0.1.1")])).toEqual({ notices: [], annotations: [] });
    // The fix is out: that one.
    const fixed = releaseNotices("0.1.0", [rel("v0.1.2"), rel("v0.1.1", "Withdrawn: BoxOps 0.1.1")]);
    expect(fixed.notices).toEqual([{ level: "info", text: "BoxOps v0.1.2 is available; this site runs v0.1.0." }]);
    expect(fixed.annotations).toEqual([
      { level: "notice", message: "BoxOps v0.1.2 is available; this run used v0.1.0: merge the BoxOps upgrade pull request, or run `node .boxops/boxops.mjs upgrade v0.1.2`." },
    ]);
    // A release before it that wasn't withdrawn, still newer than this one: that one.
    const older = releaseNotices("0.1.0", [rel("v0.1.2", "Withdrawn: BoxOps 0.1.2"), rel("v0.1.1", "Security: BoxOps 0.1.1")]);
    expect(older.notices).toEqual([
      { level: "security", text: "BoxOps v0.1.1 fixes a security problem; this site runs v0.1.0. Ask a repository admin to merge the upgrade pull request." },
    ]);
    expect(older.annotations.map((a) => a.message)).toEqual([expect.stringMatching(/run `node \.boxops\/boxops\.mjs upgrade v0\.1\.1`\.$/)]);
  });

  it("leaves drafts out", () => {
    expect(releaseNotices("0.1.0", [{ ...rel("v0.2.0", "Security: BoxOps 0.2.0"), draft: true }])).toEqual({ notices: [], annotations: [] });
    expect(releaseNotices("0.1.0", [{ ...rel("v0.2.0"), draft: false }]).notices).toEqual([{ level: "info", text: "BoxOps v0.2.0 is available; this site runs v0.1.0." }]);
  });

  it("ignores what isn't a list of releases, and builds without a release version", () => {
    for (const junk of [null, {}, "x", [1, null, { tag_name: 3 }, { tag_name: "v9.0.0" }, { tag_name: "v9.0.0", name: 1, prerelease: false }]]) {
      expect(releaseNotices("0.1.0", junk)).toEqual({ notices: [], annotations: [] });
    }
    expect(releaseNotices("0.1.0-next", [rel("v9.0.0", "Security: x")])).toEqual({ notices: [], annotations: [] });
    // A release without a title (name: null) still counts.
    expect(releaseNotices("0.1.0", [rel("v0.1.1", null)]).notices).toEqual([{ level: "info", text: "BoxOps v0.1.1 is available; this site runs v0.1.0." }]);
  });
});

describe("readReleasesFile", () => {
  it("reads the lookup step's JSON, and says why when it can't", () => {
    const dir = tempDir();
    const file = join(dir, "releases.json");
    writeFileSync(file, JSON.stringify([rel("v0.1.0")]));
    expect(readReleasesFile(file)).toEqual({ releases: [rel("v0.1.0")] });
    expect(readReleasesFile("")).toEqual({ skipped: "no releases-file given" });
    expect(readReleasesFile(join(dir, "none.json"))).toEqual({ skipped: `no releases-file at ${join(dir, "none.json")} (the lookup step didn’t run or failed)` });
    expect(readReleasesFile(dir)).toEqual({ skipped: `${dir} isn’t a file` });
    writeFileSync(file, "x".repeat(1024 * 1024 + 1));
    expect(readReleasesFile(file)).toEqual({ skipped: `${file} is over 1 MiB` });
    writeFileSync(file, "");
    expect(readReleasesFile(file)).toMatchObject({ skipped: expect.stringContaining("isn’t a list of releases") });
  });
});
