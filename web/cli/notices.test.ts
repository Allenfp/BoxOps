import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareVersions, newestRelease, parseVersion, readReleasesFile, releaseNotices } from "./notices";
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
    const { notices, annotations } = releaseNotices("0.1.0", [rel("v0.1.1", "Security: BoxOps 0.1.1"), rel("v0.1.3", "Security: BoxOps 0.1.3"), rel("v0.1.4")]);
    expect(notices).toEqual([
      { level: "security", text: "BoxOps v0.1.3 fixes a security problem; this site runs v0.1.0. Ask a repository admin to merge the upgrade pull request." },
    ]);
    expect(annotations.map((a) => a.level)).toEqual(["warning"]);
  });

  describe("a security fix also released as a patch of the minor before (docs/releasing.md)", () => {
    // 0.2.0 raised the data format; its fix, 0.2.1, came out first, then 0.1.1 with the same fix.
    const dated = (entry: ReturnType<typeof rel>, published_at: string) => ({ ...entry, published_at });
    const list = [
      dated(rel("v0.2.1", "Security: BoxOps 0.2.1"), "2027-01-11T10:00:00Z"),
      dated(rel("v0.1.1", "Security: BoxOps 0.1.1"), "2027-01-11T10:30:00Z"),
      dated(rel("v0.2.0"), "2026-12-07T09:00:00Z"),
      dated(rel("v0.1.0"), "2026-11-02T09:00:00Z"),
    ];
    const upgradeNote = (tag: string, own: string) => ({
      level: "notice",
      message: `BoxOps ${tag} is available; this run used v${own}: merge the BoxOps upgrade pull request, or run \`node .boxops/boxops.mjs upgrade ${tag}\`.`,
    });

    it("a site on that patch has the fix: the newer minor is only available, in the run and the app", () => {
      expect(releaseNotices("0.1.1", list)).toEqual({
        notices: [{ level: "info", text: "BoxOps v0.2.1 is available; this site runs v0.1.1." }],
        annotations: [upgradeNote("v0.2.1", "0.1.1")],
      });
    });

    it("a site before it is pointed to that patch, which needs no migration, and told of the newer minor", () => {
      expect(releaseNotices("0.1.0", list)).toEqual({
        notices: [{ level: "security", text: "BoxOps v0.1.1 fixes a security problem; this site runs v0.1.0. Ask a repository admin to upgrade it to v0.1.1." }],
        annotations: [
          {
            level: "warning",
            message:
              "BoxOps v0.1.1 fixes a security problem (“Security: BoxOps 0.1.1”); this run used v0.1.0: run `node .boxops/boxops.mjs upgrade v0.1.1`, a patch of this minor release that needs no migration.",
          },
          upgradeNote("v0.2.1", "0.1.0"),
        ],
      });
      // Without dates too: which fix to name is by version.
      expect(releaseNotices("0.1.0", list.map(({ published_at: _, ...r }) => r))).toEqual(releaseNotices("0.1.0", list));
    });

    it("a site on the newer minor takes its own fix through the upgrade pull request", () => {
      expect(releaseNotices("0.2.0", list).annotations).toEqual([
        {
          level: "warning",
          message: "BoxOps v0.2.1 fixes a security problem (“Security: BoxOps 0.2.1”); this run used v0.2.0: merge the BoxOps upgrade pull request, or run `node .boxops/boxops.mjs upgrade v0.2.1`.",
        },
      ]);
    });

    it("a later security release is still one the patch lacks", () => {
      const later = [dated(rel("v0.2.2", "Security: BoxOps 0.2.2"), "2027-02-01T09:00:00Z"), ...list];
      expect(releaseNotices("0.1.1", later).notices).toEqual([
        { level: "security", text: "BoxOps v0.2.2 fixes a security problem; this site runs v0.1.1. Ask a repository admin to merge the upgrade pull request." },
      ]);
      // Once its patch is out, that's the one named.
      const patched = [dated(rel("v0.1.2", "Security: BoxOps 0.1.2"), "2027-02-01T09:30:00Z"), ...later];
      expect(releaseNotices("0.1.1", patched).notices).toEqual([
        { level: "security", text: "BoxOps v0.1.2 fixes a security problem; this site runs v0.1.1. Ask a repository admin to upgrade it to v0.1.2." },
      ]);
      expect(releaseNotices("0.1.2", patched).notices).toEqual([{ level: "info", text: "BoxOps v0.2.2 is available; this site runs v0.1.2." }]);
    });

    it("without both dates, or with the patch out first, it warns, unless the patch names the fix it carries", () => {
      const warned = (r: ReturnType<typeof releaseNotices>) => r.notices.map((n) => `${n.level} ${n.text.split(";")[0]}`);
      const undated = list.map(({ published_at: _, ...r }) => r);
      const noneOfItsOwn = list.map((r) => (r.tag_name === "v0.1.1" ? { ...r, published_at: null } : r));
      const notListed = list.filter((r) => r.tag_name !== "v0.1.1");
      const patchFirst = list.map((r) => (r.tag_name === "v0.1.1" ? { ...r, published_at: "2027-01-11T09:00:00Z" } : r));
      for (const releases of [undated, noneOfItsOwn, notListed, patchFirst]) {
        expect(warned(releaseNotices("0.1.1", releases))).toEqual(["security BoxOps v0.2.1 fixes a security problem"]);
        expect(warned(releaseNotices("0.1.1", releases, ["v0.2.1"]))).toEqual(["info BoxOps v0.2.1 is available"]);
      }
      // A date that isn't one is no date.
      expect(warned(releaseNotices("0.1.1", list.map((r) => ({ ...r, published_at: r.tag_name === "v0.2.1" ? "soon" : r.published_at }))))).toEqual([
        "security BoxOps v0.2.1 fixes a security problem",
      ]);
      expect(warned(releaseNotices("0.1.1", list.map((r) => ({ ...r, published_at: 5 }))))).toEqual(["security BoxOps v0.2.1 fixes a security problem"]);
    });
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

describe("newestRelease", () => {
  it("is the newest vX.Y.Z, by version, that isn't a release candidate, a draft or withdrawn: what upgrade moves to", () => {
    const list = [
      rel("v0.1.9"),
      rel("v0.1.10"),
      rel("v0.2.0-rc.1"),
      { ...rel("v0.3.0"), draft: true },
      rel("v0.2.0", "Withdrawn: BoxOps 0.2.0"),
      rel("v1.0.0", "BoxOps 1.0.0", true),
      rel("0.9.0"),
      rel("v0.4.0-beta"),
    ];
    expect(newestRelease(list)).toBe("v0.1.10");
    expect(newestRelease([rel("v0.2.0", null), rel("v0.1.0")])).toBe("v0.2.0");
    for (const none of [[], [rel("v0.2.0", "Withdrawn: x")], { message: "Not Found" }, null]) expect(newestRelease(none)).toBeUndefined();
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
