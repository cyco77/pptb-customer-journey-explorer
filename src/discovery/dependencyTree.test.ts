import { describe, expect, it } from "vitest";
import { buildDependencyTree } from "./dependencyTree";
import type { Artifact, Dependency, DiscoveryResult } from "./types";

function artifact(id: string, kind: Artifact["kind"], logicalName: string = kind, sourceRecord: Record<string, unknown> = {}): Artifact {
  return {
    id,
    kind,
    logicalName,
    entitySetName: `${logicalName}s`,
    recordId: id,
    displayName: id,
    sourceRecord,
    warnings: [],
  };
}

function edge(id: string, sourceArtifactId: string, targetArtifactId: string): Dependency {
  return {
    id,
    sourceArtifactId,
    targetArtifactId,
    relationType: "lookup",
    label: id,
    resolved: true,
    warnings: [],
  };
}

function discovery(artifacts: Artifact[], dependencies: Dependency[]): DiscoveryResult {
  const root = artifacts[0];
  if (!root) throw new Error("A discovery fixture must include a root artifact.");
  return { root, artifacts, dependencies, warnings: [], discoveredAt: "2026-01-01T00:00:00.000Z" };
}

describe("buildDependencyTree", () => {
  it("groups ordinary dependencies by source and exposes multiply referenced assets once", () => {
    const artifacts = [
      artifact("journey", "journey"),
      artifact("email", "email"),
      artifact("task", "task"),
      artifact("asset", "asset"),
    ];
    const dependencies = [
      edge("journey-email", "journey", "email"),
      edge("email-asset", "email", "asset"),
      edge("task-asset", "task", "asset"),
    ];

    const model = buildDependencyTree(discovery(artifacts, dependencies));

    expect(model.dependenciesBySource.get("journey")).toEqual([dependencies[0]]);
    expect(model.promotedArtifactIds).toEqual(new Set(["asset"]));
  });

  it("recovers a Purpose → Compliance path from an email raw lookup when metadata edges are missing", () => {
    const journey = artifact("journey", "journey");
    const email = artifact("email", "email", "msdynmkt_email", { _purposeid_value: "purpose", _complianceid_value: "compliance" });
    const purpose = artifact("purpose", "purpose");
    const compliance = artifact("compliance", "compliance");

    const model = buildDependencyTree(discovery([journey, email, purpose, compliance], []));

    expect(model.dependenciesBySource.get("compliance")?.map((dependency) => dependency.targetArtifactId)).toEqual(["purpose"]);
    expect(model.dependenciesBySource.get("purpose")).toBeUndefined();
  });

  it("renders shared Compliance under each email and does not also render it under an embedded email action", () => {
    const journey = artifact("journey", "journey");
    const actionA = artifact("action-a", "email", "journey-embedded");
    const actionB = artifact("action-b", "email", "journey-embedded");
    const emailA = artifact("email-a", "email");
    const emailB = artifact("email-b", "email");
    const compliance = artifact("compliance", "compliance");
    const dependencies = [
      edge("journey-action-a", "journey", "action-a"),
      edge("journey-action-b", "journey", "action-b"),
      edge("action-email-a", "action-a", "email-a"),
      edge("action-email-b", "action-b", "email-b"),
      edge("email-compliance-a", "email-a", "compliance"),
      edge("email-compliance-b", "email-b", "compliance"),
      edge("action-compliance-a", "action-a", "compliance"),
    ];

    const model = buildDependencyTree(discovery([journey, actionA, actionB, emailA, emailB, compliance], dependencies));

    expect(model.dependenciesBySource.get("email-a")?.some((dependency) => dependency.targetArtifactId === "compliance")).toBe(true);
    expect(model.dependenciesBySource.get("email-b")?.some((dependency) => dependency.targetArtifactId === "compliance")).toBe(true);
    expect(model.dependenciesBySource.get("action-a")?.some((dependency) => dependency.targetArtifactId === "compliance")).toBe(false);
    expect(model.promotedArtifactIds.has("compliance")).toBe(true);
  });

  it("keeps only Purpose → Topic pairs used by an email record", () => {
    const journey = artifact("journey", "journey");
    const email = artifact("email", "email", "msdynmkt_email", { _purposeid_value: "purpose", _topicid_value: "topic" });
    const purpose = artifact("purpose", "purpose");
    const topic = artifact("topic", "topic");
    const unusedTopic = artifact("unused-topic", "topic");
    const dependencies = [
      edge("email-purpose", "email", "purpose"),
      edge("email-topic", "email", "topic"),
      edge("purpose-topic", "purpose", "topic"),
      edge("purpose-unused-topic", "purpose", "unused-topic"),
    ];

    const model = buildDependencyTree(discovery([journey, email, purpose, topic, unusedTopic], dependencies));

    expect(model.dependenciesBySource.get("purpose")?.map((dependency) => dependency.targetArtifactId)).toEqual(["topic"]);
  });

  it("returns empty tree structures when discovery has not run", () => {
    expect(buildDependencyTree(null)).toEqual({ dependenciesBySource: new Map(), promotedArtifactIds: new Set() });
  });
});
