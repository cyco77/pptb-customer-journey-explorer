import { beforeEach, describe, expect, it, vi } from "vitest";
import { artifactDepth, discoverJourney, discoverSupportedArtifacts, escapeODataString, getAttributes, getEntityCatalog, getValue, loadJourneys, queryAll, recordDisplayName, selectedColumns } from "./discoveryService.ts";
import type { EntityInfo, JourneyOption } from "./types";

const sampleJourneyEntity: EntityInfo = {
  logicalName: "msdynmkt_journey",
  entitySetName: "msdynmkt_journeys",
  primaryIdAttribute: "msdynmkt_journeyid",
  primaryNameAttribute: "msdynmkt_name",
  displayName: "Customer Journey",
  kind: "journey",
  score: 100,
  canCreate: true,
};

const sampleJourney: JourneyOption = {
  id: "journey-1",
  logicalName: "msdynmkt_journey",
  entitySetName: "msdynmkt_journeys",
  primaryNameAttribute: "msdynmkt_name",
  name: "Welcome Journey",
  record: { msdynmkt_journeyid: "journey-1", msdynmkt_name: "Welcome Journey" },
};

function metadata(logicalName: string, label: string, idAttribute = `${logicalName}id`, nameAttribute = "name") {
  return {
    MetadataId: `${logicalName}-metadata-id`,
    LogicalName: logicalName,
    DisplayName: { LocalizedLabels: [{ Label: label, LanguageCode: 1033 }] },
    EntitySetName: `${logicalName}s`,
    PrimaryIdAttribute: idAttribute,
    PrimaryNameAttribute: nameAttribute,
  };
}

function wireJourneyEnvironment(options: {
  entities?: DataverseAPI.EntityMetadata[];
  attributes?: Record<string, Array<Record<string, unknown>>>;
  records?: Record<string, Array<Record<string, unknown>>>;
  related?: Record<string, Array<Record<string, unknown>>>;
  queryData?: ReturnType<typeof vi.fn>;
  getEntityRelatedMetadata?: ReturnType<typeof vi.fn>;
} = {}) {
  const entities = options.entities ?? [metadata("msdynmkt_journey", "Journey", "msdynmkt_journeyid", "msdynmkt_name") as DataverseAPI.EntityMetadata];
  const related = options.related ?? {};
  const records = options.records ?? {};
  const queryData = options.queryData ?? vi.fn(async (query: string) => {
    const entitySet = query.split("?")[0] ?? "";
    return { value: records[entitySet] ?? [] };
  });
  const getEntityRelatedMetadata = options.getEntityRelatedMetadata ?? vi.fn(async (entity: string, path: string) => ({
    value: related[`${entity}:${path}`] ?? (path === "Attributes" ? options.attributes?.[entity] ?? [] : []),
  }));
  vi.stubGlobal("window", {
    dataverseAPI: {
      getAllEntitiesMetadata: vi.fn().mockResolvedValue({ value: entities }),
      getEntityRelatedMetadata,
      queryData,
    },
  });
  return { queryData, getEntityRelatedMetadata };
}

describe("Dataverse discovery value helpers", () => {
  it("escapes apostrophes in OData string values", () => {
    expect(escapeODataString("Lars' Journey")).toBe("Lars'' Journey");
  });

  it("reads the first string or numeric value from candidate fields", () => {
    expect(getValue({ first: null, second: 42 }, "first", "second", "third")).toBe("42");
    expect(getValue({ first: false }, "first")).toBeUndefined();
  });

  it("calculates semantic artifact depths", () => {
    expect(artifactDepth("journey")).toBe(0);
    expect(artifactDepth("purpose")).toBe(1);
    expect(artifactDepth("topic")).toBe(2);
  });
});

describe("queryAll", () => {
  it("stops when Dataverse repeats a page link and reports the warning", async () => {
    const repeatedLink = "https://org.crm.dynamics.com/api/data/v9.2/accounts?$skiptoken=repeat";
    const queryData = vi.fn()
      .mockResolvedValueOnce({ value: [{ accountid: "a1" }], "@odata.nextLink": repeatedLink })
      .mockResolvedValueOnce({ value: [{ accountid: "a2" }], "@odata.nextLink": repeatedLink });
    vi.stubGlobal("window", { dataverseAPI: { queryData } });
    const warnings: string[] = [];

    const records = await queryAll("accounts?$top=1", warnings, "test", "account");

    expect(records).toEqual([{ accountid: "a1" }, { accountid: "a2" }]);
    expect(queryData).toHaveBeenCalledTimes(2);
    expect(warnings).toEqual(["The account query returned a repeated page link; pagination stopped to avoid an infinite loop."]);
  });

  it("retries a query after removing a column that is not available in the current schema", async () => {
    const queryData = vi.fn()
      .mockRejectedValueOnce(new Error("Could not find a property named 'missing_field' on type 'Entity'."))
      .mockResolvedValueOnce({ value: [{ accountid: "a1", name: "Sample" }] });
    vi.stubGlobal("window", { dataverseAPI: { queryData } });

    await expect(queryAll("accounts?$select=accountid,missing_field,name", undefined, "metadata-probe", "account"))
      .resolves.toEqual([{ accountid: "a1", name: "Sample" }]);
    expect(queryData).toHaveBeenNthCalledWith(2, "accounts?$select=accountid,name", "primary");
  });
});

describe("metadata discovery", () => {
  it("classifies supported metadata and omits unusable or unsupported records", async () => {
    const getAllEntitiesMetadata = vi.fn().mockResolvedValue({ value: [
      {
        LogicalName: "msdynmkt_journey",
        DisplayName: { UserLocalizedLabel: { Label: "Customer Journey" } },
        EntitySetName: "msdynmkt_journeys",
        PrimaryIdAttribute: "msdynmkt_journeyid",
        PrimaryNameAttribute: "msdynmkt_name",
      },
      {
        LogicalName: "msdynmkt_email",
        DisplayName: { UserLocalizedLabel: { Label: "Email" } },
        EntitySetName: "msdynmkt_emails",
        PrimaryIdAttribute: "msdynmkt_emailid",
        PrimaryNameAttribute: "msdynmkt_name",
      },
      { LogicalName: "msdynmkt_broken", EntitySetName: "", PrimaryIdAttribute: "id" },
    ] });
    vi.stubGlobal("window", { dataverseAPI: { getAllEntitiesMetadata } });

    await expect(getEntityCatalog()).resolves.toEqual([sampleJourneyEntity, expect.objectContaining({
      logicalName: "msdynmkt_email",
      displayName: "Email",
      kind: "email",
    })]);
    expect(getAllEntitiesMetadata).toHaveBeenCalledWith(
      ["LogicalName", "DisplayName", "EntitySetName", "PrimaryIdAttribute", "PrimaryNameAttribute"],
      "primary",
    );
  });

  it("throws when entity metadata cannot be read", async () => {
    vi.stubGlobal("window", { dataverseAPI: { getAllEntitiesMetadata: vi.fn().mockRejectedValue(new Error("metadata unavailable")) } });
    await expect(getEntityCatalog()).rejects.toThrow("metadata unavailable");
  });

  it("keeps readable fields and state fields when lookup metadata is unavailable", async () => {
    const attributes = { value: [
        { LogicalName: "name", AttributeType: "String", DisplayName: { UserLocalizedLabel: { Label: "Name" } } },
        { LogicalName: "statecode", AttributeType: "State", IsValidForRead: false, DisplayName: { UserLocalizedLabel: { Label: "State" } } },
        { LogicalName: "secret", IsValidForRead: false },
      ] };
    const getEntityRelatedMetadata = vi.fn((_logicalName: string, path: string) =>
      path === "ManyToOneRelationships"
        ? Promise.reject(new Error("relationship metadata denied"))
        : Promise.resolve(attributes));
    vi.stubGlobal("window", { dataverseAPI: { getEntityRelatedMetadata } });

    await expect(getAttributes(sampleJourneyEntity)).resolves.toEqual([
      expect.objectContaining({ logicalName: "name", displayName: "Name", targets: [] }),
      expect.objectContaining({ logicalName: "statecode", displayName: "State", targets: [] }),
    ]);
    expect(getEntityRelatedMetadata).toHaveBeenCalledTimes(3);
  });

  it("throws when attribute metadata and its fallback both fail", async () => {
    const getEntityRelatedMetadata = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("window", { dataverseAPI: { getEntityRelatedMetadata } });
    await expect(getAttributes(sampleJourneyEntity)).rejects.toThrow("denied");
    expect(getEntityRelatedMetadata).toHaveBeenCalledTimes(3);
  });
});

describe("selectedColumns", () => {
  it("includes supported lookups, required payloads, and Journey JSON while excluding aliases", () => {
    const catalog = vi.fn().mockResolvedValue({ value: [
      {
        LogicalName: "msdynmkt_journey",
        DisplayName: { UserLocalizedLabel: { Label: "Journey" } },
        EntitySetName: "msdynmkt_journeys",
        PrimaryIdAttribute: "msdynmkt_journeyid",
        PrimaryNameAttribute: "msdynmkt_name",
      },
      {
        LogicalName: "msdynmkt_email",
        DisplayName: { UserLocalizedLabel: { Label: "Email" } },
        EntitySetName: "msdynmkt_emails",
        PrimaryIdAttribute: "msdynmkt_emailid",
        PrimaryNameAttribute: "msdynmkt_name",
      },
    ] });
    vi.stubGlobal("window", { dataverseAPI: { getAllEntitiesMetadata: catalog } });

    const attributes = [
      { logicalName: "msdynmkt_emailid", displayName: "Email", targets: ["msdynmkt_email"] },
      { logicalName: "statecode", displayName: "State", targets: [] },
      { logicalName: "_ownerid_value", displayName: "Owner", targets: [] },
      { logicalName: "owneridname", displayName: "Owner name", targets: [] },
      { logicalName: "msdynmkt_journeyjson", displayName: "Journey JSON", attributeType: "Memo", targets: [] },
      { logicalName: "msdynmkt_customrequired", displayName: "Required", requiredLevel: "ApplicationRequired", targets: [] },
    ];

    return getEntityCatalog().then((entities) => {
      const journeyEntity = entities.find((entity) => entity.kind === "journey");
      expect(journeyEntity).toBeDefined();
      expect(selectedColumns(journeyEntity!, attributes)).toEqual([
        "msdynmkt_journeyid",
        "msdynmkt_name",
        "statecode",
        "_msdynmkt_emailid_value",
        "msdynmkt_journeyjson",
        "msdynmkt_customrequired",
      ]);
    });
  });
});

describe("discoverJourney", () => {
  it("returns the selected root and a clear error when its entity is missing", async () => {
    wireJourneyEnvironment({ entities: [] });
    await expect(discoverJourney(sampleJourney, "https://org.crm.dynamics.com"))
      .rejects.toThrow("The selected Journey table is no longer available in the metadata.");
  });

  it("uses the list row when the root reread fails and reports a dependency-free Journey", async () => {
    const attributes = [
      { LogicalName: "msdynmkt_journeyid", AttributeType: "Uniqueidentifier", IsValidForRead: true },
      { LogicalName: "msdynmkt_name", AttributeType: "String", IsValidForRead: true },
    ];
    const queryData = vi.fn().mockRejectedValue(new Error("query unavailable"));
    wireJourneyEnvironment({ attributes: { msdynmkt_journey: attributes }, queryData });

    const result = await discoverJourney(sampleJourney, "https://org.crm.dynamics.com");

    expect(result.root.displayName).toBe("Welcome Journey");
    expect(result.artifacts).toHaveLength(1);
    expect(result.dependencies).toEqual([]);
    expect(result.warnings).toContain("No resolvable Dataverse dependencies were found for this Journey. Embedded or unsupported reference formats may still be present.");
  });

  it("adds embedded email-action artifacts extracted from the Journey definition", async () => {
    const emailId = "11111111-1111-1111-1111-111111111111";
    const entities = [
      metadata("msdynmkt_journey", "Journey", "msdynmkt_journeyid", "msdynmkt_name"),
      metadata("msdynmkt_email", "Email", "msdynmkt_emailid", "msdynmkt_name"),
    ] as DataverseAPI.EntityMetadata[];
    const attributes = {
      msdynmkt_journey: [
        { LogicalName: "msdynmkt_journeyid", AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_name", AttributeType: "String" },
        { LogicalName: "msdynmkt_journeyjson", AttributeType: "Memo", IsValidForRead: true },
      ],
      msdynmkt_email: [
        { LogicalName: "msdynmkt_emailid", AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_name", AttributeType: "String" },
      ],
    };
    const root = { ...sampleJourney.record, msdynmkt_journeyjson: { actions: [{ type: "Email", parameters: { contentId: emailId } }] } };
    const queryData = vi.fn(async (query: string) => {
      if (query.startsWith("msdynmkt_journeys?")) return { value: [root] };
      return { value: [] };
    });
    wireJourneyEnvironment({ entities, attributes, queryData });

    const result = await discoverJourney(sampleJourney, "https://org.crm.dynamics.com");

    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "email", recordId: "actions[0]", logicalName: "journey-embedded", displayName: "Email" }),
    ]));
    expect(result.dependencies.some((dependency) => dependency.targetLogicalName === "journey-embedded")).toBe(true);
  });

  it("keeps an unresolved embedded email action in the discovered tree", async () => {
    const emailId = "11111111-1111-1111-1111-111111111111";
    const entities = [
      metadata("msdynmkt_journey", "Journey", "msdynmkt_journeyid", "msdynmkt_name"),
      metadata("msdynmkt_email", "Email", "msdynmkt_emailid", "msdynmkt_name"),
    ] as DataverseAPI.EntityMetadata[];
    const attributes = {
      msdynmkt_journey: [
        { LogicalName: "msdynmkt_journeyid", AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_name", AttributeType: "String" },
        { LogicalName: "msdynmkt_journeyjson", AttributeType: "Memo", IsValidForRead: true },
      ],
      msdynmkt_email: [
        { LogicalName: "msdynmkt_emailid", AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_name", AttributeType: "String" },
      ],
    };
    const queryData = vi.fn(async (query: string) => query.startsWith("msdynmkt_journeys?")
      ? { value: [{ ...sampleJourney.record, msdynmkt_journeyjson: { actions: [{ type: "Email", parameters: { contentId: emailId } }] } }] }
      : { value: [] });
    wireJourneyEnvironment({ entities, attributes, queryData });

    const result = await discoverJourney(sampleJourney, "https://org.crm.dynamics.com");

    expect(result.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "email", logicalName: "journey-embedded", recordId: "actions[0]" }),
    ]));
    expect(result.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetRecordId: "actions[0]", targetLogicalName: "journey-embedded", relationType: "embedded-in-json" }),
    ]));
  });

  it("resolves a trigger event name to its Dataverse trigger record", async () => {
    const eventName = "msdynmkt_customer_registered";
    const entities = [
      metadata("msdynmkt_journey", "Journey", "msdynmkt_journeyid", "msdynmkt_name"),
      metadata("msdynmkt_customtrigger", "Trigger", "msdynmkt_customtriggerid", "msdynmkt_eventname"),
    ] as DataverseAPI.EntityMetadata[];
    const attributes = {
      msdynmkt_journey: [
        { LogicalName: "msdynmkt_journeyid", AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_name", AttributeType: "String" },
        { LogicalName: "msdynmkt_journeyjson", AttributeType: "Memo", IsValidForRead: true },
      ],
      msdynmkt_customtrigger: [
        { LogicalName: "msdynmkt_customtriggerid", AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_eventname", AttributeType: "String" },
      ],
    };
    const triggerRecord = { msdynmkt_customtriggerid: "trigger-1", msdynmkt_eventname: eventName };
    const queryData = vi.fn(async (query: string) => {
      if (query.startsWith("msdynmkt_journeys?")) {
        return { value: [{ ...sampleJourney.record, msdynmkt_journeyjson: { trigger: { type: "Event", parameters: { eventName } }, actions: {} } }] };
      }
      if (query.startsWith("msdynmkt_customtriggers?")) return { value: [triggerRecord] };
      return { value: [] };
    });
    wireJourneyEnvironment({ entities, attributes, queryData });

    const result = await discoverJourney(sampleJourney, "https://org.crm.dynamics.com");

    expect(result.artifacts.some((item) => item.kind === "trigger" && item.recordId === "trigger-1" && item.displayName === eventName)).toBe(true);
    expect(result.dependencies.some((dependency) => dependency.relationType === "triggers" && dependency.targetRecordId === "trigger-1")).toBe(true);
  });

  it("warns when a Journey trigger event cannot be resolved", async () => {
    const entities = [
      metadata("msdynmkt_journey", "Journey", "msdynmkt_journeyid", "msdynmkt_name"),
      metadata("msdynmkt_customtrigger", "Trigger", "msdynmkt_customtriggerid", "msdynmkt_eventname"),
    ] as DataverseAPI.EntityMetadata[];
    const attributes = {
      msdynmkt_journey: [
        { LogicalName: "msdynmkt_journeyid", AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_name", AttributeType: "String" },
        { LogicalName: "msdynmkt_journeyjson", AttributeType: "Memo", IsValidForRead: true },
      ],
      msdynmkt_customtrigger: [
        { LogicalName: "msdynmkt_customtriggerid", AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_eventname", AttributeType: "String" },
      ],
    };
    const queryData = vi.fn(async (query: string) => query.startsWith("msdynmkt_journeys?")
      ? { value: [{ ...sampleJourney.record, msdynmkt_journeyjson: { trigger: { type: "Event", parameters: { eventName: "unpublished-event" } }, actions: {} } }] }
      : { value: [] });
    wireJourneyEnvironment({ entities, attributes, queryData });

    const result = await discoverJourney(sampleJourney, "https://org.crm.dynamics.com");

    expect(result.warnings).toContain("Could not resolve Journey trigger event 'unpublished-event' to a Dataverse trigger record.");
  });

  it("reports a missing root when the Journey record has no readable ID", async () => {
    const queryData = vi.fn().mockResolvedValue({ value: [{ msdynmkt_name: "No ID" }] });
    wireJourneyEnvironment({ attributes: { msdynmkt_journey: [] }, queryData });
    await expect(discoverJourney(sampleJourney, "https://org.crm.dynamics.com")).rejects.toThrow("The selected Journey could not be loaded.");
  });
});

describe("discoverSupportedArtifacts", () => {
  it("loads non-Journey supported artifacts and skips rows without IDs", async () => {
    const emailMetadata = metadata("msdynmkt_email", "Email", "msdynmkt_emailid", "msdynmkt_name") as DataverseAPI.EntityMetadata;
    const queryData = vi.fn().mockResolvedValue({ value: [
      { msdynmkt_emailid: "EMAIL-1", msdynmkt_name: "Welcome", statecode: 0 },
      { msdynmkt_name: "Missing ID" },
    ] });
    wireJourneyEnvironment({
      entities: [emailMetadata],
      attributes: { msdynmkt_email: [
        { LogicalName: "msdynmkt_emailid", DisplayName: { UserLocalizedLabel: { Label: "Email ID" } }, AttributeType: "Uniqueidentifier" },
        { LogicalName: "msdynmkt_name", DisplayName: { UserLocalizedLabel: { Label: "Name" } }, AttributeType: "String" },
      ] },
      queryData,
    });

    const result = await discoverSupportedArtifacts("https://org.crm.dynamics.com");

    expect(result.artifacts).toHaveLength(1);
    expect(result.root).toMatchObject({ id: "msdynmkt_email:email-1", displayName: "Welcome", state: "0" });
    expect(result.root.fieldDisplayNames).toEqual({ msdynmkt_emailid: "Email ID", msdynmkt_name: "Name" });
    expect(result.root.dataverseUrl).toContain("etn=msdynmkt_email");
    expect(queryData).toHaveBeenCalledWith(expect.stringContaining("msdynmkt_emails?"), "primary");
  });

  it("returns an empty target-catalog placeholder and a warning if entity reading fails", async () => {
    const emailMetadata = metadata("msdynmkt_email", "Email", "msdynmkt_emailid", "msdynmkt_name") as DataverseAPI.EntityMetadata;
    const getEntityRelatedMetadata = vi.fn().mockRejectedValue(new Error("attributes denied"));
    wireJourneyEnvironment({ entities: [emailMetadata], getEntityRelatedMetadata });

    const result = await discoverSupportedArtifacts("https://org.crm.dynamics.com");

    expect(result.root.id).toBe("target-catalog");
    expect(result.artifacts).toEqual([]);
    expect(result.warnings).toEqual(["Could not read target Email (msdynmkt_email): attributes denied"]);
  });
});

describe("recordDisplayName", () => {
  it("prefers known configured name fields and falls back to a named field or record ID", () => {
    expect(recordDisplayName({ msdynmkt_name: "Configured", subject: "Subject" }, sampleJourneyEntity, [
      { logicalName: "msdynmkt_name", displayName: "Name", targets: [] },
      { logicalName: "subject", displayName: "Subject", targets: [] },
    ])).toBe("Configured");
    expect(recordDisplayName({ arbitraryTitle: "Inferred title" }, sampleJourneyEntity, [])).toBe("Inferred title");
    expect(recordDisplayName({ msdynmkt_journeyid: "123456789" }, sampleJourneyEntity, [])).toBe("Customer Journey 12345678");
  });
});

describe("loadJourneys pagination", () => {
  beforeEach(() => {
    const firstPage = Array.from({ length: 5000 }, (_, index) => ({
      msdynmkt_journeyid: `journey-${index}`,
      msdynmkt_name: `Journey ${index}`,
    }));
    const secondPage = Array.from({ length: 101 }, (_, index) => ({
      msdynmkt_journeyid: `journey-${5000 + index}`,
      msdynmkt_name: `Journey ${5000 + index}`,
    }));
    const queryData = vi.fn()
      .mockResolvedValueOnce({
        value: firstPage,
        "@odata.nextLink": "https://org.crm.dynamics.com/api/data/v9.2/msdynmkt_journeys?$skiptoken=page-2",
      })
      .mockResolvedValueOnce({ value: secondPage });

    vi.stubGlobal("window", {
      dataverseAPI: {
        getAllEntitiesMetadata: vi.fn().mockResolvedValue({ value: [{
          LogicalName: "msdynmkt_journey",
          DisplayName: { UserLocalizedLabel: { Label: "Journey" } },
          EntitySetName: "msdynmkt_journeys",
          PrimaryIdAttribute: "msdynmkt_journeyid",
          PrimaryNameAttribute: "msdynmkt_name",
        }] }),
        getEntityRelatedMetadata: vi.fn().mockResolvedValue({ value: [] }),
        queryData,
      },
    });
  });

  it("loads Journey records from pages beyond the 5,000-record Dataverse limit", async () => {
    const { journeys, warnings } = await loadJourneys();

    expect(journeys).toHaveLength(5101);
    expect(journeys.some((journey) => journey.id === "journey-5000")).toBe(true);
    expect(warnings).toEqual([]);
    expect(window.dataverseAPI.queryData).toHaveBeenCalledTimes(2);
    expect(window.dataverseAPI.queryData).toHaveBeenLastCalledWith(
      "msdynmkt_journeys?$skiptoken=page-2",
      "primary",
    );
  });
});
