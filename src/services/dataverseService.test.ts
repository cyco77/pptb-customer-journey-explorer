import { beforeEach, describe, expect, it, vi } from "vitest";
import { countRecords, countRecordsBatch, loadAllViews, loadEntities, loadSolutions, loadViewsForEntity } from "./dataverseService";
import { resolveSolution } from "./solutionResolution";
import type { Solution } from "../types/solution";

const solution: Solution = {
  solutionid: "solution-1",
  friendlyname: "Customer Insights Base",
  uniquename: "CustomerInsightsBase",
  version: "1.0.0.0",
  publisherName: "Contoso",
  publisherUniqueName: "contoso",
};

describe("resolveSolution", () => {
  it("requires an explicit choice when no selector is supplied", () => {
    expect(resolveSolution([solution], {})).toEqual({
      status: "selection-required",
      solutions: [],
      suggestions: [],
    });
  });

  it("resolves a unique name regardless of case and punctuation", () => {
    expect(resolveSolution([solution], { solutionName: "customer-insights base" })).toEqual({
      status: "resolved",
      solution,
    });
  });

  it("asks for a choice when multiple exact matches exist", () => {
    const second = { ...solution, solutionid: "solution-2" };

    const result = resolveSolution([solution, second], { publisher: "contoso" });

    expect(result.status).toBe("selection-required");
    if (result.status === "selection-required") {
      expect(result.solutions).toEqual([solution, second]);
      expect(result.suggestions.map(({ score }) => score)).toEqual([1, 1]);
    }
  });

  it("asks for a choice when fuzzy matches are too close to distinguish", () => {
    const second = { ...solution, solutionid: "solution-2", friendlyname: "Customer Insights Baze", uniquename: "CustomerInsightsBaze" };
    const result = resolveSolution([solution, second], { solutionName: "Customer Insights Bas" });

    expect(result.status).toBe("selection-required");
    if (result.status === "selection-required") {
      expect(result.suggestions[0]?.solution).toEqual(solution);
      expect(result.suggestions[0]?.score).toBeGreaterThanOrEqual(0.65);
      expect(result.suggestions).toHaveLength(2);
    }
  });
});

describe("Dataverse record loading", () => {
  beforeEach(() => {
    vi.stubGlobal("dataverseAPI", { queryData: vi.fn() });
  });

  it("follows absolute OData next links as relative Dataverse queries", async () => {
    const queryData = vi.fn()
      .mockResolvedValueOnce({
        value: [{ solutionid: "solution-1", friendlyname: "Base", uniquename: "base", version: "1" }],
        "@odata.nextLink": "https://org.crm.dynamics.com/api/data/v9.2/solutions?$skiptoken=next",
      })
      .mockResolvedValueOnce({ value: [{ solutionid: "solution-2", friendlyname: "Add-on", uniquename: "addon", version: "2" }] })
      .mockResolvedValueOnce({ value: [] });
    vi.stubGlobal("dataverseAPI", { queryData });

    const solutions = await loadSolutions();

    expect(solutions.map(({ solutionid }) => solutionid)).toEqual(["solution-1", "solution-2"]);
    expect(queryData).toHaveBeenNthCalledWith(2, "solutions?$skiptoken=next");
  });

  it("maps batch counts and defaults missing entities to zero", async () => {
    vi.stubGlobal("dataverseAPI", {
      queryData: vi.fn().mockResolvedValue({
        EntityRecordCountCollection: { Keys: ["account"], Values: [12] },
      }),
    });

    await expect(countRecordsBatch(["account", "contact"])).resolves.toEqual({
      account: 12,
      contact: 0,
    });
  });

  it("retries a batch after removing an entity that is not valid for read", async () => {
    const queryData = vi.fn()
      .mockRejectedValueOnce(new Error("Entity 'contact' is not valid for read"))
      .mockResolvedValueOnce({
        EntityRecordCountCollection: { Keys: ["account"], Values: [8] },
      });
    vi.stubGlobal("dataverseAPI", { queryData });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(countRecordsBatch(["account", "contact"])).resolves.toEqual({
      account: 8,
      contact: 0,
    });
    expect(queryData).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("throws for unrelated batch errors and for invalid entities missing from the request", async () => {
    vi.stubGlobal("dataverseAPI", { queryData: vi.fn().mockRejectedValueOnce(new Error("network unavailable")) });
    await expect(countRecordsBatch(["account"])).rejects.toThrow("network unavailable");

    vi.stubGlobal("dataverseAPI", { queryData: vi.fn().mockRejectedValueOnce(new Error("Entity 'contact' is not valid for read")) });
    await expect(countRecordsBatch(["account"])).rejects.toThrow("Entity 'contact' is not valid for read");
  });

  it("normalizes missing, unexpected, and invalid count response values", async () => {
    vi.stubGlobal("dataverseAPI", {
      queryData: vi.fn().mockResolvedValue({
        EntityRecordCountCollection: { Keys: ["account", 12], Values: ["bad", 42] },
      }),
    });

    await expect(countRecordsBatch(["account", "contact"])).resolves.toEqual({ account: 0, contact: 0 });
  });

  it("returns an empty result without querying for an empty batch", async () => {
    const queryData = vi.fn();
    vi.stubGlobal("dataverseAPI", { queryData });
    await expect(countRecordsBatch([])).resolves.toEqual({});
    expect(queryData).not.toHaveBeenCalled();
  });
});

describe("entity and view loading", () => {
  it("filters virtual entities and limits custom entities to selected solution components", async () => {
    const queryData = vi.fn()
      .mockResolvedValueOnce({ value: [
        { LogicalName: "account", EntitySetName: "accounts", DisplayName: { UserLocalizedLabel: { Label: "Account" } } },
        { LogicalName: "virtualtable", EntitySetName: "virtualtables", DataProviderId: "provider" },
        { LogicalName: "contact", EntitySetName: "contacts", DisplayName: { LocalizedLabels: [{ Label: "Contact", LanguageCode: 1033 }] } },
      ] })
      .mockResolvedValueOnce({ value: [{ objectid: "{ABC-123}" }] })
      .mockResolvedValueOnce({ value: [
        { LogicalName: "account", MetadataId: "abc-123" },
        { LogicalName: "contact", MetadataId: "contact-id" },
      ] });
    vi.stubGlobal("dataverseAPI", { queryData });

    await expect(loadEntities("solution-1")).resolves.toEqual([
      { logicalname: "account", displayname: "Account", entitysetname: "accounts" },
    ]);
    expect(queryData).toHaveBeenCalledTimes(3);
  });

  it("maps and groups views while skipping malformed records", async () => {
    vi.stubGlobal("dataverseAPI", {
      queryData: vi.fn().mockResolvedValue({ value: [
        { savedqueryid: "view-1", returnedtypecode: "account", name: "Active", fetchxml: "<fetch />" },
        { savedqueryid: "view-2", returnedtypecode: "account" },
        { savedqueryid: "view-missing-entity", returnedtypecode: "" },
      ] }),
    });

    const views = await loadAllViews();

    expect(views.get("account")).toEqual([
      { savedqueryid: "view-1", returnedtypecode: "account", name: "Active", fetchxml: "<fetch />" },
      { savedqueryid: "view-2", returnedtypecode: "account", name: "view-2", fetchxml: undefined },
    ]);
  });

  it("loads views for an entity and handles query failures", async () => {
    const queryData = vi.fn()
      .mockResolvedValueOnce({ value: [{ savedqueryid: "view-1", returnedtypecode: "contact", name: "All Contacts" }] })
      .mockRejectedValueOnce(new Error("saved query unavailable"));
    vi.stubGlobal("dataverseAPI", { queryData });

    await expect(loadViewsForEntity("contact")).resolves.toEqual([
      { savedqueryid: "view-1", returnedtypecode: "contact", name: "All Contacts", fetchxml: undefined },
    ]);
    await expect(loadViewsForEntity("account")).resolves.toEqual([]);
  });
});

describe("record counts", () => {
  it("counts FetchXML pages and replaces prior page/count/paging cookie attributes", async () => {
    const queryData = vi.fn()
      .mockResolvedValueOnce({ value: Array.from({ length: 5000 }, (_, index) => ({ id: index })) })
      .mockResolvedValueOnce({ value: [{ id: 5000 }, { id: 5001 }] });
    vi.stubGlobal("dataverseAPI", { queryData });

    await expect(countRecords("accounts", "account", '<fetch page="9" count="20" paging-cookie="old"><entity name="account" /></fetch>')).resolves.toBe(5002);
    const firstQuery = String(queryData.mock.calls[0]?.[0]);
    const fetchXml = new URLSearchParams(firstQuery.split("?")[1]).get("fetchXml");
    expect(fetchXml).toContain('<fetch page="1" count="5000">');
    expect(fetchXml).not.toContain("paging-cookie");
    expect(queryData).toHaveBeenCalledTimes(2);
  });

  it("returns zero for an empty entity name and delegates unfiltered counting to the batch API", async () => {
    const queryData = vi.fn().mockResolvedValue({ EntityRecordCountCollection: { Keys: ["account"], Values: [6] } });
    vi.stubGlobal("dataverseAPI", { queryData });

    await expect(countRecords("accounts", "")).resolves.toBe(0);
    await expect(countRecords("accounts", "account")).resolves.toBe(6);
    expect(queryData).toHaveBeenCalledTimes(1);
  });

  it("returns zero when the count query fails", async () => {
    vi.stubGlobal("dataverseAPI", { queryData: vi.fn().mockRejectedValue(new Error("count failed")) });
    await expect(countRecords("accounts", "account", "<fetch />")).resolves.toBe(0);
  });
});
