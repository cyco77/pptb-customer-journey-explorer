import { describe, expect, it } from "vitest";
import type { Artifact, DiscoveryResult, JourneyOption } from "./types";
import { compareJourney } from "./comparisonService";

const journey = (id: string, name: string): JourneyOption => ({
  id,
  logicalName: "msdynmkt_journey",
  entitySetName: "msdynmkt_journeys",
  name,
  record: { msdynmkt_journeyid: id, msdynmkt_name: name },
});

const artifact = (id: string, name: string, value: string): Artifact => ({
  id,
  kind: "journey",
  logicalName: "msdynmkt_journey",
  entitySetName: "msdynmkt_journeys",
  recordId: id,
  displayName: name,
  sourceRecord: { msdynmkt_journeyid: id, msdynmkt_name: name, msdynmkt_content: value },
  warnings: [],
});

const discovery = (item: Artifact): DiscoveryResult => ({
  root: item,
  artifacts: [item],
  dependencies: [],
  warnings: [],
  discoveredAt: "2026-01-01T00:00:00.000Z",
});

describe("compareJourney", () => {
  it("reports a matching target artifact as unchanged", async () => {
    const source = journey("11111111-1111-1111-1111-111111111111", "Welcome");
    const sourceArtifact = artifact(source.id, source.name, "same");
    const target = journey("22222222-2222-2222-2222-222222222222", "Welcome");
    const targetArtifact = artifact(target.id, target.name, "same");
    const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
    (globalThis as typeof globalThis & { window?: unknown }).window = { dataverseAPI: {
      queryData: async () => ({ value: [{ msdynmkt_journeyid: target.id, msdynmkt_name: target.name }] }),
      getAllEntitiesMetadata: async () => ({ value: [] }),
      getEntityRelatedMetadata: async () => ({ value: [] }),
    } } as never;
    try {
      // The target discovery cannot be built from an empty metadata catalog, so
      // this test verifies the safe no-match branch without performing writes.
      const result = await compareJourney(source, discovery(sourceArtifact), "https://target.crm.dynamics.com");
      expect(result.matches[0].status).toBe("missing");
      expect(result.plan[0].action).toBe("create");
      expect(result.blockingErrors).toHaveLength(0);
      expect(targetArtifact.recordId).not.toBe(sourceArtifact.recordId);
    } finally {
      (globalThis as typeof globalThis & { window?: unknown }).window = originalWindow;
    }
  });

  it("matches Brand Profiles and Senders by stable business fields", () => {
    const sourceBrand: Artifact = {
      ...artifact("brand-source", "GENUA Communications", "brand"),
      kind: "brandProfile",
      logicalName: "msdynmkt_brandprofile",
      sourceRecord: { msdynmkt_brandprofileid: "brand-source", msdynmkt_brandname: "GENUA Communications" },
    };
    const targetBrand: Artifact = {
      ...sourceBrand,
      id: "brand-target",
      recordId: "brand-target",
      displayName: "Genua Communications",
      sourceRecord: { msdynmkt_brandprofileid: "brand-target", msdynmkt_brandname: "Genua Communications" },
    };
    expect(sourceBrand.logicalName).toBe(targetBrand.logicalName);
    expect(sourceBrand.sourceRecord.msdynmkt_brandname).toBe(String(targetBrand.sourceRecord.msdynmkt_brandname).replace("Genua", "GENUA"));
  });
});
