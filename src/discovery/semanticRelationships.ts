import type { Artifact, Dependency } from "./types";
import { getParentKind, getParentLookupField } from "./artifactCatalog";

/** Resolve a semantic parent independently of the stored dependency edge direction. */
export function getSemanticParentArtifact(
  artifact: Artifact,
  artifacts: Artifact[],
  dependencies: Dependency[],
): Artifact | undefined {
  const parentKind = getParentKind(artifact.kind);
  if (!parentKind) return undefined;
  for (const dependency of dependencies) {
    let candidateId: string | undefined;
    if (dependency.sourceArtifactId === artifact.id) candidateId = dependency.targetArtifactId;
    else if (dependency.targetArtifactId === artifact.id) candidateId = dependency.sourceArtifactId;
    if (!candidateId) continue;
    const candidate = artifacts.find((item) => item.id === candidateId);
    if (candidate?.kind === parentKind) return candidate;
  }

  // Discovery can miss a relationship edge when Dataverse relationship
  // metadata is incomplete. The raw lookup value is still authoritative.
  const lookupField = getParentLookupField(artifact.kind);
  if (lookupField) {
    const rawParentId = artifact.sourceRecord[lookupField] ?? artifact.sourceRecord[`_${lookupField}_value`];
    if (typeof rawParentId === "string") {
      const parentId = rawParentId.toLowerCase();
      return artifacts.find((candidate) => candidate.kind === parentKind && candidate.recordId.toLowerCase() === parentId);
    }
  }

  // Some source rows omit the lookup column and the relationship metadata can
  // also omit the edge. If this discovery contains exactly one possible
  // semantic parent, use it rather than making the selected mapping unusable.
  const possibleParents = artifacts.filter((candidate) => candidate.kind === parentKind);
  if (possibleParents.length === 1) return possibleParents[0];
  return undefined;
}
