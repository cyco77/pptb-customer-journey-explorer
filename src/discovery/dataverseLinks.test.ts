import { describe, expect, it } from "vitest";
import { createRecordUrl } from "./dataverseLinks";

describe("createRecordUrl", () => {
  it("builds a model-driven record URL and removes braces from the ID", () => {
    const url = createRecordUrl("https://org.crm.dynamics.com/custom/path?old=value#section", "account", "{abc-123}");

    expect(url).toBe("https://org.crm.dynamics.com/main.aspx?etn=account&id=abc-123&pagetype=entityrecord");
  });

  it("returns undefined when the organization URL is invalid", () => {
    expect(createRecordUrl("not a URL", "account", "abc-123")).toBeUndefined();
  });
});
