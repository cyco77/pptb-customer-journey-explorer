export function createRecordUrl(
  organizationUrl: string,
  logicalName: string,
  recordId: string,
): string | undefined {
  try {
    const baseUrl = new URL(organizationUrl);
    const normalizedId = recordId.replace(/[{}]/g, "");
    baseUrl.pathname = "/main.aspx";
    baseUrl.search = new URLSearchParams({
      etn: logicalName,
      id: normalizedId,
      pagetype: "entityrecord",
    }).toString();
    baseUrl.hash = "";
    return baseUrl.toString();
  } catch {
    return undefined;
  }
}
