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
});
