import { describe, expect, it } from "vitest";
import { buildPurposesForComplianceFetchXml, PURPOSE_COMPLIANCE_RELATIONSHIP } from "./purposeComplianceRelationship";

describe("Purpose and Compliance Profile relationship query", () => {
  it("uses the documented N:N intersect table and Compliance Profile table", () => {
    const fetchXml = buildPurposesForComplianceFetchXml("8f272879-6dbd-f111-aaad-70a8a57abd2a", ["msdynmkt_name", "statecode"]);

    expect(fetchXml).toContain(`<entity name="msdynmkt_purpose">`);
    expect(fetchXml).toContain(`<link-entity name="${PURPOSE_COMPLIANCE_RELATIONSHIP}" intersect="true"`);
    expect(fetchXml).toContain(`<link-entity name="msdynmkt_compliancesettings4" from="msdynmkt_compliancesettings4id" to="msdynmkt_compliancesettings4id"`);
    expect(fetchXml).toContain(`attribute="msdynmkt_compliancesettings4id" operator="eq" uitype="msdynmkt_compliancesettings4" value="8f272879-6dbd-f111-aaad-70a8a57abd2a"`);
    expect(fetchXml).toContain(`<attribute name="msdynmkt_purposeid" />`);
  });

  it("escapes values inserted into FetchXML", () => {
    expect(buildPurposesForComplianceFetchXml(`id"<&`, ["name"])).toContain(`value="id&quot;&lt;&amp;"`);
  });

  it("does not emit OData lookup aliases as FetchXML attributes", () => {
    const fetchXml = buildPurposesForComplianceFetchXml("compliance-id", [
      "msdynmkt_name",
      "_msdynmkt_extendedentityid_value",
      "_msdynmkt_compliancesettingsid_value",
    ]);

    expect(fetchXml).toContain(`<attribute name="msdynmkt_name" />`);
    expect(fetchXml).not.toContain("_msdynmkt_extendedentityid_value");
    expect(fetchXml).not.toContain("_msdynmkt_compliancesettingsid_value");
  });
});
