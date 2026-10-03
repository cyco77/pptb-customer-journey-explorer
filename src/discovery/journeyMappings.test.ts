import { describe, expect, it } from "vitest";
import { describeBinding, getActionFieldMappings, getActionTargetEntity } from "./journeyMappings";

describe("describeBinding", () => {
  it("formats common data sources, nested selected records, and output paths", () => {
    expect(describeBinding({
      source: "DataverseDataSource",
      inputs: {
        sourceType: { value: "contact" },
        recordId: {
          binding: { source: "EventDataSource", inputs: { sourceType: "Registration" }, outputPath: "contactId" },
        },
      },
      outputPath: "emailaddress1",
    })).toBe("Dataverse contact (record: Event Registration → contactId) → emailaddress1");
  });

  it("supports profile, event, generic, and missing-source dynamic values", () => {
    expect(describeBinding({ source: "CdsProfileDataSource", inputs: { sourceType: { value: "Contact" } } })).toBe("Profile Contact");
    expect(describeBinding({ source: "EventDataSource", inputs: { sourceType: "Purchase" } })).toBe("Event Purchase");
    expect(describeBinding({ source: "CustomDataSource", inputs: { sourceType: "custom" } })).toBe("CustomDataSource custom");
    expect(describeBinding({ outputPath: "field" })).toBe("Dynamic value → field");
  });

  it("returns undefined for non-object values and ignores blank text fields", () => {
    expect(describeBinding(null)).toBeUndefined();
    expect(describeBinding([])).toBeUndefined();
    expect(describeBinding({ source: "  ", outputPath: "  " })).toBe("Dynamic value");
  });
});

describe("action field mappings", () => {
  it("formats static, lookup-like, rich, dynamic, and unknown values", () => {
    const mappings = getActionFieldMappings({ parameters: { mappingDefinitions: {
      plain: { type: "static", value: "hello" },
      lookup: { type: "static", value: '{"logicalName":"contact","id":"contact-1"}' },
      rich: { type: "rich", value: { html: "<b>hello</b>" } },
      dynamic: { type: "dynamic", placeholder: { binding: { source: "DataverseDataSource", outputPath: "email" } } },
      unknown: { type: "expression", value: "input" },
      scalar: "raw value",
    } } });

    expect(mappings).toEqual([
      { field: "plain", value: "hello" },
      { field: "lookup", value: "contact (contact-1)" },
      { field: "rich", value: '{"html":"<b>hello</b>"}' },
      { field: "dynamic", value: "Dataverse → email" },
      { field: "unknown", value: '{"type":"expression","value":"input"}' },
      { field: "scalar", value: "raw value" },
    ]);
  });

  it("handles malformed mapping containers and static JSON that is not a lookup", () => {
    expect(getActionFieldMappings({ parameters: { mappingDefinitions: [] } })).toEqual([]);
    expect(getActionFieldMappings({ parameters: { mappingDefinitions: null } })).toEqual([]);
    expect(getActionFieldMappings({ parameters: { mappingDefinitions: { payload: { type: "static", value: "{bad json" } } } }))
      .toEqual([{ field: "payload", value: "{bad json" }]);
  });

  it("reads the target entity only when it is a non-empty string", () => {
    expect(getActionTargetEntity({ parameters: { entityName: " task " } })).toBe("task");
    expect(getActionTargetEntity({ parameters: { entityName: "  " } })).toBeUndefined();
    expect(getActionTargetEntity({ parameters: { entityName: 4 } })).toBeUndefined();
    expect(getActionTargetEntity({ parameters: [] })).toBeUndefined();
  });
});
