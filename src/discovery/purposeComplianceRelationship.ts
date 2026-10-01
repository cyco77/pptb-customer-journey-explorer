export const PURPOSE_COMPLIANCE_RELATIONSHIP = "msdynmkt_msdynmkt_purpose_msdynmkt_compliancev4";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function buildPurposesForComplianceFetchXml(complianceId: string, attributes: string[]): string {
  // The caller may pass columns selected for the Web API, including lookup
  // aliases such as _lookup_value. FetchXML requires logical attribute names;
  // only include known real Purpose columns here.
  const requested = [...new Set([
    "msdynmkt_purposeid",
    ...attributes.filter((attribute) => /^[a-z][a-z0-9_]*$/i.test(attribute) && !attribute.startsWith("_")),
  ])];
  const attributesXml = requested.map((attribute) => `<attribute name="${escapeXml(attribute)}" />`).join("");
  return `<fetch version="1.0" mapping="logical" distinct="true"><entity name="msdynmkt_purpose">${attributesXml}<link-entity name="${PURPOSE_COMPLIANCE_RELATIONSHIP}" intersect="true" visible="false" to="msdynmkt_purposeid" from="msdynmkt_purposeid"><link-entity name="msdynmkt_compliancesettings4" from="msdynmkt_compliancesettings4id" to="msdynmkt_compliancesettings4id" alias="compliance"><filter type="and"><condition attribute="msdynmkt_compliancesettings4id" operator="eq" uitype="msdynmkt_compliancesettings4" value="${escapeXml(complianceId)}" /></filter></link-entity></link-entity></entity></fetch>`;
}
