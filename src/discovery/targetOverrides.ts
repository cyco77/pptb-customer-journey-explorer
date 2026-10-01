import type { Artifact, DiscoveryResult, MigrationPlanItem } from "./types";
import { getSemanticParentArtifact } from "./semanticRelationships";

export function createTargetOverride(
  sourceArtifact: Artifact,
  targetRecordId: string | undefined,
  targetArtifact?: Artifact,
): Artifact | undefined {
  if (!targetRecordId) return undefined;
  return {
    ...(targetArtifact ?? sourceArtifact),
    id: targetArtifact?.id ?? `${sourceArtifact.logicalName.toLowerCase()}:${targetRecordId.toLowerCase()}`,
    recordId: targetRecordId,
    logicalName: targetArtifact?.logicalName ?? sourceArtifact.logicalName,
    entitySetName: targetArtifact?.entitySetName || sourceArtifact.entitySetName,
  };
}

export function createSemanticTargetOverrides(
  sourceArtifact: Artifact,
  source: DiscoveryResult,
  plan: MigrationPlanItem[],
  targetArtifacts: Artifact[],
): Map<string, Artifact> {
  const overrides = new Map<string, Artifact>();
  const visited = new Set<string>([sourceArtifact.id]);
  let current = sourceArtifact;
  while (true) {
    const parent = getSemanticParentArtifact(current, source.artifacts, source.dependencies);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    const parentPlan = plan.find((item) => item.sourceArtifactId === parent.id);
    if (parentPlan?.targetRecordId) {
      const targetArtifact = parentPlan.targetArtifactId
        ? targetArtifacts.find((artifact) => artifact.id === parentPlan.targetArtifactId)
        : undefined;
      const override = createTargetOverride(parent, parentPlan.targetRecordId, targetArtifact);
      if (override) overrides.set(parent.id, override);
    }
    current = parent;
  }
  return overrides;
}
