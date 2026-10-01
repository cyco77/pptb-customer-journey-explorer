import { describe, expect, it } from "vitest";
import type { Artifact, MigrationComparison, MigrationPlanItem } from "../discovery/types";
import { buildArtifactPayload } from "./transferService";

describe("buildArtifactPayload", () => {
  it("uses an edited target name on the entity primary name attribute", () => {
    const artifact: Artifact = {
      id: "msdynmkt_email:source-id",
      kind: "email",
      logicalName: "msdynmkt_email",
      entitySetName: "msdynmkt_emails",
      primaryNameAttribute: "msdynmkt_name",
      recordId: "source-id",
      displayName: "Original email name",
      sourceRecord: {
        msdynmkt_emailid: "source-id",
        msdynmkt_name: "Original email name",
        subject: "Welcome",
      },
      warnings: [],
    };
    const item: MigrationPlanItem = {
      sourceArtifactId: artifact.id,
      status: "ambiguous",
      action: "create",
      selected: true,
      createName: "Edited target email name",
      dependencySourceIds: [],
      warnings: [],
    };
    const comparison: MigrationComparison = {
      source: { root: artifact, artifacts: [artifact], dependencies: [], warnings: [], discoveredAt: "2026-01-01T00:00:00.000Z" },
      matches: [],
      plan: [item],
      warnings: [],
      blockingErrors: [],
    };

    const payload = buildArtifactPayload(item, artifact, comparison, new Map());

    expect(payload.msdynmkt_emailid).toBeUndefined();
    expect(payload.msdynmkt_name).toBe("Edited target email name");
    expect(payload.subject).toBe("Welcome");
  });
});
