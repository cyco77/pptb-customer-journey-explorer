import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact, AttributeInfo, Dependency, DiscoveryResult, EntityInfo } from "./types";

const mocks = vi.hoisted(() => ({
  getEntityCatalog: vi.fn(),
  getAttributes: vi.fn(),
  queryAll: vi.fn(),
  selectedColumns: vi.fn(),
  queryableColumns: vi.fn(),
}));

vi.mock("./discoveryService", () => ({
  artifactDepth: (kind: string) => ({ brandProfile: 0, compliance: 0, purpose: 1, topic: 2, sender: 1 }[kind] ?? 0),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
  escapeODataString: (value: string) => value.replace(/'/g, "''"),
  getAttributes: mocks.getAttributes,
  getEntityCatalog: mocks.getEntityCatalog,
  getValue: (record: Record<string, unknown>, ...keys: Array<string | undefined>) => {
    for (const key of keys) if (key && (typeof record[key] === "string" || typeof record[key] === "number")) return String(record[key]);
    return undefined;
  },
  queryAll: mocks.queryAll,
  queryableColumns: mocks.queryableColumns,
  recordDisplayName: (record: Record<string, unknown>, entity: EntityInfo) => String(record[entity.primaryNameAttribute ?? ""] ?? entity.displayName),
  selectedColumns: mocks.selectedColumns,
}));

import { discoverArtifactsByIdentity } from "./targetArtifactDiscovery";

function entity(logicalName: string, kind: EntityInfo["kind"], primaryNameAttribute = "name"): EntityInfo {
  return {
    logicalName,
    entitySetName: `${logicalName}s`,
    primaryIdAttribute: `${logicalName}id`,
    primaryNameAttribute,
    displayName: logicalName,
    kind,
    score: 100,
    canCreate: true,
  };
}

function artifact(id: string, kind: Artifact["kind"], logicalName: string, displayName: string, sourceRecord: Record<string, unknown> = {}): Artifact {
  return {
    id,
    kind,
    logicalName,
    entitySetName: `${logicalName}s`,
    primaryIdAttribute: `${logicalName}id`,
    primaryNameAttribute: "name",
    recordId: id,
    displayName,
    sourceRecord,
    warnings: [],
  };
}

function sourceDiscovery(artifacts: Artifact[], dependencies: DiscoveryResult["dependencies"] = []): DiscoveryResult {
  const root = artifacts[0];
  if (!root) throw new Error("Test source discovery requires a root artifact.");
  return { root, artifacts, dependencies, warnings: [], discoveredAt: "2026-01-01T00:00:00.000Z" };
}

const stringAttribute = (logicalName: string, targets: string[] = []): AttributeInfo => ({ logicalName, displayName: logicalName, targets });

describe("discoverArtifactsByIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEntityCatalog.mockResolvedValue([]);
    mocks.getAttributes.mockResolvedValue([]);
    mocks.queryAll.mockResolvedValue([]);
    mocks.selectedColumns.mockReturnValue(["recordid", "name"]);
    mocks.queryableColumns.mockImplementation((columns: string[]) => columns);
    vi.stubGlobal("window", { dataverseAPI: { fetchXmlQuery: vi.fn().mockResolvedValue({ value: [] }) } });
  });

  it("returns an empty target result when no supported source artifact needs querying", async () => {
    const journey = artifact("source-journey", "journey", "msdynmkt_journey", "Journey");
    const embedded = artifact("embedded", "email", "journey-embedded", "Email action");
    mocks.getEntityCatalog.mockResolvedValue([entity("msdynmkt_journey", "journey")]);

    const result = await discoverArtifactsByIdentity(sourceDiscovery([journey, embedded]), "https://org.crm.dynamics.com");

    expect(result.artifacts).toEqual([]);
    expect(result.root.displayName).toBe("Target artifact matches");
    expect(result.warnings).toEqual([]);
    expect(mocks.queryAll).not.toHaveBeenCalled();
  });

  it("queries root candidate rows by escaped display name and creates display metadata", async () => {
    const sourceEmail = artifact("source-email", "email", "msdynmkt_email", "Bob's welcome");
    const emailEntity = entity("msdynmkt_email", "email", "msdynmkt_name");
    mocks.getEntityCatalog.mockResolvedValue([emailEntity]);
    mocks.getAttributes.mockResolvedValue([stringAttribute("msdynmkt_emailid"), stringAttribute("msdynmkt_name")]);
    mocks.selectedColumns.mockReturnValue(["msdynmkt_emailid", "msdynmkt_name"]);
    mocks.queryAll.mockResolvedValue([{ msdynmkt_emailid: "target-email", msdynmkt_name: "Bob's welcome" }]);

    const result = await discoverArtifactsByIdentity(sourceDiscovery([sourceEmail]), "https://org.crm.dynamics.com");

    expect(mocks.queryAll).toHaveBeenCalledWith(
      expect.stringContaining("msdynmkt_name%20eq%20'Bob''s%20welcome'"),
      expect.any(Array),
      "target-artifact-match",
      "msdynmkt_email",
      "secondary",
      expect.objectContaining({ sourceArtifactId: sourceEmail.id }),
    );
    expect(result.artifacts).toEqual([expect.objectContaining({
      id: "msdynmkt_email:target-email",
      recordId: "target-email",
      displayName: "Bob's welcome",
      dataverseUrl: expect.stringContaining("etn=msdynmkt_email"),
    })]);
  });

  it("loads semantic parents before children and filters child candidates by target parent", async () => {
    const brand = artifact("source-brand", "brandProfile", "msdynmkt_brandprofile", "Northwind");
    const sender = artifact("source-sender", "sender", "msdynmkt_sender", "Newsletter", { _msdynmkt_brandprofileid_value: brand.recordId });
    const brandEntity = entity("msdynmkt_brandprofile", "brandProfile");
    const senderEntity = entity("msdynmkt_sender", "sender");
    const parentEdge: Dependency = {
      id: "sender-brand", sourceArtifactId: sender.id, targetArtifactId: brand.id, relationType: "lookup", label: "Brand", resolved: true, warnings: [],
    };
    mocks.getEntityCatalog.mockResolvedValue([brandEntity, senderEntity]);
    mocks.getAttributes.mockImplementation(async (item: EntityInfo) => item.kind === "sender"
      ? [stringAttribute("msdynmkt_senderid"), stringAttribute("name"), stringAttribute("msdynmkt_brandprofileid", [brand.logicalName])]
      : [stringAttribute("msdynmkt_brandprofileid"), stringAttribute("name")]);
    mocks.queryAll.mockImplementation(async (query: string) => query.startsWith("msdynmkt_brandprofiles")
      ? [{ msdynmkt_brandprofileid: "target-brand", name: "Northwind" }]
      : [{ msdynmkt_senderid: "target-sender", name: "Newsletter" }]);

    const result = await discoverArtifactsByIdentity(sourceDiscovery([sender, brand], [parentEdge]), "https://org.crm.dynamics.com");

    expect(mocks.queryAll.mock.calls.map(([query]) => String(query).split("?")[0])).toEqual([
      "msdynmkt_brandprofiles",
      "msdynmkt_senders",
    ]);
    expect(mocks.queryAll.mock.calls[1]?.[0]).toContain("_msdynmkt_brandprofileid_value%20eq%20target-brand");
    expect(result.artifacts.map((item) => item.recordId)).toEqual(["target-brand", "target-sender"]);
  });

  it("loads Purpose candidates through the Compliance N:N FetchXML relationship", async () => {
    const compliance = artifact("source-compliance", "compliance", "msdynmkt_compliancesettings", "Consent");
    const purpose = artifact("source-purpose", "purpose", "msdynmkt_purpose", "Marketing");
    const targetCompliance = artifact("target-compliance", "compliance", "msdynmkt_compliancesettings", "Consent");
    const fetchXmlQuery = vi.fn().mockResolvedValue({ value: [
      { msdynmkt_purposeid: "target-purpose", msdynmkt_name: "Marketing" },
      { msdynmkt_name: "Missing ID" },
    ] });
    vi.stubGlobal("window", { dataverseAPI: { fetchXmlQuery } });
    mocks.getEntityCatalog.mockResolvedValue([entity("msdynmkt_purpose", "purpose")]);
    mocks.getAttributes.mockResolvedValue([stringAttribute("msdynmkt_purposeid"), stringAttribute("msdynmkt_name")]);

    const result = await discoverArtifactsByIdentity(
      sourceDiscovery([compliance, purpose], [{ id: "purpose-compliance", sourceArtifactId: purpose.id, targetArtifactId: compliance.id, relationType: "lookup", label: "Compliance", resolved: true, warnings: [] }]),
      "https://org.crm.dynamics.com",
      "secondary",
      new Map([[compliance.id, targetCompliance]]),
    );

    expect(fetchXmlQuery).toHaveBeenCalledWith(expect.stringContaining("msdynmkt_msdynmkt_purpose_msdynmkt_compliancev4"), "secondary");
    expect(result.artifacts.map((item) => item.recordId)).toContain("target-purpose");
    expect(result.artifacts.some((item) => item.recordId === "Missing ID")).toBe(false);
  });

  it("skips missing entity metadata and returns warnings on query failures", async () => {
    const email = artifact("source-email", "email", "msdynmkt_email", "Email");
    mocks.getEntityCatalog.mockResolvedValue([entity("msdynmkt_email", "email"), entity("msdynmkt_missingname", "email", "")]);
    mocks.queryAll.mockRejectedValue(new Error("target query failed"));
    const missing = artifact("source-missing", "email", "msdynmkt_missing", "Missing");
    const noName = artifact("source-noname", "email", "msdynmkt_missingname", "No name");

    const result = await discoverArtifactsByIdentity(sourceDiscovery([email, missing, noName]), "https://org.crm.dynamics.com");

    expect(result.warnings).toEqual(["Could not query target msdynmkt_email by name: target query failed"]);
    expect(result.artifacts).toHaveLength(0);
  });

  it("includes all target candidates without a name filter and carries parent overrides", async () => {
    const parent = artifact("source-brand", "brandProfile", "msdynmkt_brandprofile", "Brand");
    const sender = artifact("source-sender", "sender", "msdynmkt_sender", "One", { _msdynmkt_brandprofileid_value: parent.recordId });
    const targetParent = artifact("target-brand", "brandProfile", "msdynmkt_brandprofile", "Brand");
    mocks.getEntityCatalog.mockResolvedValue([entity("msdynmkt_sender", "sender")]);
    mocks.getAttributes.mockResolvedValue([stringAttribute("msdynmkt_senderid"), stringAttribute("name"), stringAttribute("msdynmkt_brandprofileid", [parent.logicalName])]);
    mocks.queryAll.mockResolvedValue([{ msdynmkt_senderid: "candidate-sender", name: "Any sender" }]);

    const result = await discoverArtifactsByIdentity(
      sourceDiscovery([parent, sender], [{ id: "sender-brand", sourceArtifactId: sender.id, targetArtifactId: parent.id, relationType: "lookup", label: "Brand", resolved: true, warnings: [] }]),
      "https://org.crm.dynamics.com",
      "secondary",
      new Map([[parent.id, targetParent]]),
      true,
    );

    const query = String(mocks.queryAll.mock.calls[0]?.[0]);
    expect(query).not.toContain("$filter=name");
    expect(query).toContain("eq%20target-brand");
    expect(result.artifacts.map((item) => item.id)).toEqual([targetParent.id, "msdynmkt_sender:candidate-sender"]);
  });
});
