import { describe, expect, it } from "vitest";
import { jiraKey } from "./jira";

describe("jiraKey", () => {
  it("reads the key from common Jira links", () => {
    expect(jiraKey("https://acme.atlassian.net/browse/DATA-123")).toBe("DATA-123");
    expect(jiraKey("https://acme.atlassian.net/browse/data-7")).toBe("DATA-7");
    expect(jiraKey("https://acme.atlassian.net/jira/software/projects/DATA/boards/4?selectedIssue=DATA-42")).toBe("DATA-42");
    expect(jiraKey("https://acme.atlassian.net/jira/software/projects/DATA/issues/DATA-9")).toBe("DATA-9");
    expect(jiraKey("https://jira.acme.com/browse/PLAT_OPS-1001/")).toBe("PLAT_OPS-1001");
  });

  it("is undefined when there's no key", () => {
    expect(jiraKey(undefined)).toBeUndefined();
    expect(jiraKey("not a link")).toBeUndefined();
    expect(jiraKey("https://github.com/Allenfp/BoxOps/issues/1")).toBeUndefined();
    expect(jiraKey("https://acme.atlassian.net/jira/software/projects/DATA/boards/4")).toBeUndefined();
  });

  it("labels only Jira's (and Linear's) issue links, not any link that ends in something key-shaped", () => {
    expect(jiraKey("https://github.com/acme/api-2")).toBeUndefined();
    expect(jiraKey("https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Q3-2026")).toBeUndefined();
    expect(jiraKey("https://reports.acme.com/reports/FY-2027")).toBeUndefined();
    expect(jiraKey("https://www.rfc-editor.org/rfc/RFC-9110")).toBeUndefined();
    expect(jiraKey("https://gitlab.acme.com/group/repo/-/issues/ABC-1")).toBeUndefined();
    // An issue path names its project: a key from another one isn't it.
    expect(jiraKey("https://acme.atlassian.net/jira/software/projects/DATA/issues/OPS-9")).toBeUndefined();
    expect(jiraKey("https://linear.app/acme/issue/ENG-12/fix-the-thing")).toBe("ENG-12");
    expect(jiraKey("https://example.com/acme/issue/ENG-12")).toBeUndefined();
  });

  it("never throws on a malformed %-escape, and still finds a key beside one", () => {
    expect(jiraKey("https://x.com/100%")).toBeUndefined();
    expect(jiraKey("https://x.com/%")).toBeUndefined();
    expect(jiraKey("https://x.com/%zz")).toBeUndefined();
    expect(jiraKey("https://x.com/a%E0%A4%A")).toBeUndefined();
    expect(jiraKey("https://drive.example.com/Q3%20100%/x")).toBeUndefined();
    expect(jiraKey("https://acme.atlassian.net/browse/DATA-12/Save%2050%")).toBe("DATA-12");
    expect(jiraKey("https://acme.atlassian.net/browse/DATA%2D5")).toBe("DATA-5");
  });
});
