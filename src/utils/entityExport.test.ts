import { describe, expect, it } from "vitest";
import { buildEntitiesCsv, buildEntitiesMarkdown } from "./entityExport";

describe("entity export formatting", () => {
  const rows = [{
    displayName: 'Customer, "VIP"',
    logicalName: "account",
    view: "Active | Current\nAccounts",
    recordCount: "12",
  }];

  it("escapes CSV quotes, commas, and newlines", () => {
    expect(buildEntitiesCsv(rows)).toBe([
      "Display Name,Logical Name,View,Record Count",
      '"Customer, ""VIP""",account,"Active | Current\nAccounts",12',
    ].join("\n"));
  });

  it("escapes Markdown table delimiters and normalizes multiline cells", () => {
    expect(buildEntitiesMarkdown(rows)).toBe([
      "| Display Name | Logical Name | View | Record Count |",
      "| --- | --- | --- | ---: |",
      '| Customer, "VIP" | account | Active \\| Current Accounts | 12 |',
    ].join("\n"));
  });

  it("exports headers when there are no entities", () => {
    expect(buildEntitiesCsv([])).toBe("Display Name,Logical Name,View,Record Count");
    expect(buildEntitiesMarkdown([])).toContain("| --- | --- | --- | ---: |");
  });
});
