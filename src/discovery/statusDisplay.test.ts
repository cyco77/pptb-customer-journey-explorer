import { describe, expect, it } from "vitest";
import { getCombinedStatusLabel } from "./statusDisplay";

describe("combined status label", () => {
  it("shows a matching state and status reason only once", () => {
    expect(getCombinedStatusLabel({
      state: "0",
      status: "1",
      stateLabels: { "0": "Active" },
      statusLabels: { "1": "Active" },
    })).toBe("Active");
  });

  it("combines different state and status reason labels in one tag", () => {
    expect(getCombinedStatusLabel({
      state: "0",
      status: "1",
      stateLabels: { "0": "Active" },
      statusLabels: { "1": "In Progress" },
    })).toBe("Active · In Progress");
  });

  it("uses formatted values and falls back to whichever value is available", () => {
    expect(getCombinedStatusLabel({
      state: "0",
      status: "1",
      stateDisplay: "Open",
      statusDisplay: " open ",
    })).toBe("open");
    expect(getCombinedStatusLabel({ state: "0", stateLabels: { "0": "Active" } })).toBe("Active");
    expect(getCombinedStatusLabel({})).toBeUndefined();
  });
});
