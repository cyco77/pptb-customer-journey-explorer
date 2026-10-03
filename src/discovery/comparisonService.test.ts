import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artifact, ArtifactKind, Dependency, DiscoveryResult, JourneyOption } from "./types";

const mocks = vi.hoisted(() => ({
  discoverJourney: vi.fn(),
  loadJourneys: vi.fn(),
  discoverArtifactsByIdentity: vi.fn(),
}));

vi.mock("./discoveryService", () => ({
  artifactDepth: (kind: ArtifactKind) => ({ compliance: 0, purpose: 1, topic: 2, sender: 1 } as Partial<Record<ArtifactKind, number>>)[kind] ?? 0,
  discoverJourney: mocks.discoverJourney,
  loadJourneys: mocks.loadJourneys,
}));

vi.mock("./targetArtifactDiscovery", () => ({ discoverArtifactsByIdentity: mocks.discoverArtifactsByIdentity }));

import { compareJourney } from "./comparisonService";

const day = "2026-01-01T00:00:00.000Z";

function journey(id: string, name: string): JourneyOption {
  return {
    id,
    logicalName: "msdynmkt_journey",
    entitySetName: "msdynmkt_journeys",
    primaryNameAttribute: "msdynmkt_name",
    name,
    record: { msdynmkt_journeyid: id, msdynmkt_name: name },
  };
}

function artifact(id: string, kind: ArtifactKind, logicalName: string, displayName: string, sourceRecord: Record<string, unknown> = {}): Artifact {
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

function edge(id: string, sourceArtifactId: string, targetArtifactId: string, relationType: Dependency["relationType"] = "lookup"): Dependency {
  return { id, sourceArtifactId, targetArtifactId, relationType, label: id, resolved: true, warnings: [] };
}

function discovery(artifacts: Artifact[], dependencies: Dependency[] = []): DiscoveryResult {
  const root = artifacts[0];
  if (!root) throw new Error("Discovery test fixture requires a root artifact.");
  return { root, artifacts, dependencies, warnings: [], discoveredAt: day };
}

const sourceJourney = journey("source-journey", "Spring Campaign");

function setupJourneyLoad(targetJourneys: JourneyOption[], warnings: string[] = []): void {
  mocks.loadJourneys.mockResolvedValue({ journeys: targetJourneys, warnings });
}

describe("compareJourney", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns an ambiguous root match if more than one target Journey has the same name", async () => {
    const root = artifact(sourceJourney.id, "journey", sourceJourney.logicalName, sourceJourney.name);
    setupJourneyLoad([journey("target-a", sourceJourney.name), journey("target-b", sourceJourney.name)], ["target list warning"]);

    const result = await compareJourney(sourceJourney, discovery([root]), "https://target.crm.dynamics.com");

    expect(result.matches).toEqual([expect.objectContaining({ sourceArtifactId: root.id, status: "ambiguous" })]);
    expect(result.plan[0]).toMatchObject({ action: "manual", selected: false });
    expect(result.blockingErrors).toContain(`${root.id}: target match requires manual confirmation.`);
    expect(result.warnings).toEqual(["target list warning"]);
    expect(mocks.discoverJourney).not.toHaveBeenCalled();
  });

  it("matches direct and duplicate target rows by normalized identity without false ambiguity", async () => {
    const root = artifact(sourceJourney.id, "journey", sourceJourney.logicalName, sourceJourney.name);
    const sourceEmail = artifact("source-email", "email", "msdynmkt_email", "Welcome Email", { emailaddress: "a@example.com" });
    const source = discovery([root, sourceEmail]);
    const targetJourney = journey("target-journey", sourceJourney.name);
    const targetRoot = artifact("target-journey", "journey", sourceJourney.logicalName, sourceJourney.name);
    const targetEmail = artifact("target-email", "email", "msdynmkt_email", "welcome-email", { emailaddress: "different@example.com" });
    setupJourneyLoad([targetJourney]);
    mocks.discoverJourney.mockResolvedValue(discovery([targetRoot, targetEmail, { ...targetEmail }]));

    const result = await compareJourney(sourceJourney, source, "https://target.crm.dynamics.com");

    expect(result.matches.map(({ status }) => status)).toEqual(["exact-match", "exact-match"]);
    expect(result.matches[1]).toMatchObject({ targetArtifactId: targetEmail.id, targetRecordId: targetEmail.recordId, differences: [] });
    expect(result.plan.map(({ action }) => action)).toEqual(["automatically-mapped", "automatically-mapped"]);
    expect(result.blockingErrors).toEqual([]);
  });

  it("marks duplicate target identities ambiguous and missing identities createable", async () => {
    const root = artifact(sourceJourney.id, "journey", sourceJourney.logicalName, sourceJourney.name);
    const ambiguous = artifact("source-email", "email", "msdynmkt_email", "Newsletter");
    const missing = artifact("source-asset", "asset", "msdynmkt_asset", "Hero image");
    const targetJourney = journey("target-journey", sourceJourney.name);
    setupJourneyLoad([targetJourney]);
    mocks.discoverJourney.mockResolvedValue(discovery([
      artifact("target-journey", "journey", sourceJourney.logicalName, sourceJourney.name),
      artifact("email-a", "email", ambiguous.logicalName, "Newsletter"),
      artifact("email-b", "email", ambiguous.logicalName, "News letter"),
    ]));

    const result = await compareJourney(sourceJourney, discovery([root, ambiguous, missing]), "https://target.crm.dynamics.com");

    expect(result.matches.find((match) => match.sourceArtifactId === ambiguous.id)?.status).toBe("ambiguous");
    expect(result.matches.find((match) => match.sourceArtifactId === missing.id)?.status).toBe("missing");
    expect(result.plan.find((item) => item.sourceArtifactId === ambiguous.id)).toMatchObject({ action: "manual", selected: false });
    expect(result.plan.find((item) => item.sourceArtifactId === missing.id)).toMatchObject({ action: "create", selected: true });
    expect(result.blockingErrors).toContain(`${ambiguous.id}: target match requires manual confirmation.`);
  });

  it("compares children only beneath their matched semantic parent", async () => {
    const root = artifact(sourceJourney.id, "journey", sourceJourney.logicalName, sourceJourney.name);
    const compliance = artifact("source-compliance", "compliance", "msdynmkt_compliancesettings", "Consent");
    const purpose = artifact("source-purpose", "purpose", "msdynmkt_purpose", "Marketing", { _msdynmkt_compliancesettingsid_value: compliance.recordId });
    const source = discovery([root, compliance, purpose], [
      edge("purpose-parent", purpose.id, compliance.id),
      edge("parent-dependency", compliance.id, purpose.id),
    ]);
    const targetJourney = journey("target-journey", sourceJourney.name);
    const targetCompliance = artifact("target-compliance", "compliance", compliance.logicalName, "Consent");
    const matchingPurpose = artifact("purpose-match", "purpose", purpose.logicalName, "Marketing", { _msdynmkt_compliancesettingsid_value: targetCompliance.recordId });
    const otherPurpose = artifact("purpose-other", "purpose", purpose.logicalName, "Marketing", { _msdynmkt_compliancesettingsid_value: "unrelated-parent" });
    setupJourneyLoad([targetJourney]);
    mocks.discoverJourney.mockResolvedValue(discovery([
      artifact("target-journey", "journey", sourceJourney.logicalName, sourceJourney.name),
      targetCompliance,
      matchingPurpose,
      otherPurpose,
    ], [edge("purpose-match-parent", matchingPurpose.id, targetCompliance.id)]));

    const result = await compareJourney(sourceJourney, source, "https://target.crm.dynamics.com");

    expect(result.matches.find((match) => match.sourceArtifactId === compliance.id)?.status).toBe("exact-match");
    expect(result.matches.find((match) => match.sourceArtifactId === purpose.id)).toMatchObject({ status: "exact-match", targetArtifactId: matchingPurpose.id });
  });

  it("blocks selected child creation when its prerequisite match is manual", async () => {
    const root = artifact(sourceJourney.id, "journey", sourceJourney.logicalName, sourceJourney.name);
    const compliance = artifact("source-compliance", "compliance", "msdynmkt_compliancesettings", "Consent");
    const purpose = artifact("source-purpose", "purpose", "msdynmkt_purpose", "Marketing");
    const source = discovery([root, compliance, purpose], [
      edge("purpose-parent", purpose.id, compliance.id),
      edge("parent-dependency", compliance.id, purpose.id),
    ]);
    const targetJourney = journey("target-journey", sourceJourney.name);
    setupJourneyLoad([targetJourney]);
    mocks.discoverJourney.mockResolvedValue(discovery([
      artifact("target-journey", "journey", sourceJourney.logicalName, sourceJourney.name),
      artifact("comp-a", "compliance", compliance.logicalName, "Consent"),
      artifact("comp-b", "compliance", compliance.logicalName, "Consent"),
    ]));

    const result = await compareJourney(sourceJourney, source, "https://target.crm.dynamics.com");

    expect(result.plan.find((item) => item.sourceArtifactId === compliance.id)?.action).toBe("manual");
    expect(result.plan.find((item) => item.sourceArtifactId === purpose.id)?.action).toBe("blocked");
    expect(result.blockingErrors).toContain(`${purpose.id}: a required dependency still needs a manual mapping.`);
  });

  it("compares artifacts by name if target Journey does not exist and prefixes target warnings", async () => {
    const root = artifact(sourceJourney.id, "journey", sourceJourney.logicalName, sourceJourney.name);
    const email = artifact("source-email", "email", "msdynmkt_email", "Welcome email");
    const source = discovery([root, email]);
    const targetCatalog = discovery([artifact("target-email", "email", email.logicalName, email.displayName)]);
    setupJourneyLoad([], ["Journey catalog unavailable"]);
    mocks.discoverArtifactsByIdentity.mockResolvedValue({ ...targetCatalog, warnings: ["target metadata partial"] });
    const progress: string[] = [];

    const result = await compareJourney(sourceJourney, source, "https://target.crm.dynamics.com", "secondary", (message) => progress.push(message));

    expect(progress).toEqual(["Loading Journeys from target…", "Journey not found. Loading target artifacts by name…"]);
    expect(result.target?.artifacts).toEqual(targetCatalog.artifacts);
    expect(result.matches.find((match) => match.sourceArtifactId === root.id)).toMatchObject({ status: "missing", strategy: "target Journey not found" });
    expect(result.matches.find((match) => match.sourceArtifactId === email.id)?.status).toBe("exact-match");
    expect(result.warnings).toEqual(["Journey catalog unavailable", "Target discovery: target metadata partial"]);
    expect(mocks.discoverArtifactsByIdentity).toHaveBeenCalledWith(source, "https://target.crm.dynamics.com", "secondary");
  });

  it("loads the matched target Journey and warns if target dependency discovery is incomplete", async () => {
    const root = artifact(sourceJourney.id, "journey", sourceJourney.logicalName, sourceJourney.name);
    const email = artifact("source-email", "email", "msdynmkt_email", "Welcome email");
    const source = discovery([root, email]);
    const targetJourney = journey("target-journey", sourceJourney.name);
    const target = discovery([artifact("target-journey", "journey", sourceJourney.logicalName, sourceJourney.name)]);
    target.warnings.push("target warning");
    setupJourneyLoad([targetJourney]);
    mocks.discoverJourney.mockResolvedValue(target);
    const progress: string[] = [];

    const result = await compareJourney(sourceJourney, source, "https://target.crm.dynamics.com", "secondary", (message) => progress.push(message));

    expect(mocks.discoverJourney).toHaveBeenCalledWith(targetJourney, "https://target.crm.dynamics.com", "secondary");
    expect(progress).toEqual(["Loading Journeys from target…", "Journey found. Loading its related target artifacts…"]);
    expect(result.targetJourney).toEqual(targetJourney);
    expect(result.warnings).toContain("Target discovery: target warning");
    expect(result.warnings).toContain("Target discovery returned 1 artifact(s) for a source with 2; dependency reads may be incomplete.");
  });
});
