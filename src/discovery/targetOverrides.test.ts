import { describe, expect, it } from "vitest";
import type { Artifact, DiscoveryResult, MigrationPlanItem } from "./types";
import { createSemanticTargetOverrides, createTargetOverride } from "./targetOverrides";

const sourceCompliance: Artifact = {
  id: "msdynmkt_compliancesettings:source-id",
  kind: "compliance",
  logicalName: "msdynmkt_compliancesettings",
  entitySetName: "msdynmkt_compliancesettingses",
  recordId: "source-id",
  displayName: "gena - Whitepaper",
  sourceRecord: {},
  warnings: [],
};

describe("manual mapping target overrides", () => {
  it("uses the mapped target ID even when its artifact is missing from the target result", () => {
    expect(createTargetOverride(sourceCompliance, "8f272879-6dbd-f111-aaad-123456789abc")).toMatchObject({
      id: "msdynmkt_compliancesettings:8f272879-6dbd-f111-aaad-123456789abc",
      logicalName: sourceCompliance.logicalName,
      entitySetName: sourceCompliance.entitySetName,
      recordId: "8f272879-6dbd-f111-aaad-123456789abc",
    });
  });

  it("uses the mapped artifact metadata while honoring the plan's selected record ID", () => {
    const target: Artifact = {
      ...sourceCompliance,
      id: "msdynmkt_compliancesettings:target-id",
      recordId: "stale-target-id",
      entitySetName: "target_complianceprofiles",
    };

    expect(createTargetOverride(sourceCompliance, "selected-target-id", target)).toMatchObject({
      id: target.id,
      recordId: "selected-target-id",
      entitySetName: "target_complianceprofiles",
    });
  });

  it("creates the Compliance override from the automatically mapped plan ID without a dependency edge", () => {
    const purpose: Artifact = {
      id: "msdynmkt_purpose:source-purpose",
      kind: "purpose",
      logicalName: "msdynmkt_purpose",
      entitySetName: "msdynmkt_purposes",
      recordId: "source-purpose",
      displayName: "Transactional",
      sourceRecord: {},
      warnings: [],
    };
    const source: DiscoveryResult = {
      root: sourceCompliance,
      artifacts: [sourceCompliance, purpose],
      dependencies: [],
      warnings: [],
      discoveredAt: "2026-01-01T00:00:00.000Z",
    };
    const plan: MigrationPlanItem[] = [{
      sourceArtifactId: sourceCompliance.id,
      status: "exact-match",
      action: "automatically-mapped",
      selected: false,
      targetRecordId: "selected-compliance-target-id",
      dependencySourceIds: [],
      warnings: [],
    }];

    const overrides = createSemanticTargetOverrides(purpose, source, plan, []);

    expect(overrides.get(sourceCompliance.id)).toMatchObject({
      id: "msdynmkt_compliancesettings:selected-compliance-target-id",
      recordId: "selected-compliance-target-id",
      logicalName: sourceCompliance.logicalName,
    });
  });
});
