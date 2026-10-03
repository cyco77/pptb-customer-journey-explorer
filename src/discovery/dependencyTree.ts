import type { Artifact, Dependency, DiscoveryResult } from "./types";
import { getArtifactLabel } from "./artifactCatalog";

export type DependencyTreeModel = {
  dependenciesBySource: Map<string, Dependency[]>;
  promotedArtifactIds: Set<string>;
};

const PARENT_KIND: Partial<Record<Artifact["kind"], Artifact["kind"]>> = {
  compliance: "email",
  purpose: "compliance",
  topic: "purpose",
  sender: "brandProfile",
};

function recordReferences(record: Record<string, unknown>, recordId: string): boolean {
  const expected = recordId.toLowerCase();
  return Object.entries(record).some(([key, value]) => /^_.*_value$/i.test(key) && typeof value === "string" && value.toLowerCase() === expected);
}

function makeEdge(parent: Artifact, child: Artifact, reason: string): Dependency {
  return {
    id: `tree:${reason}:${parent.id}->${child.id}`,
    sourceArtifactId: parent.id,
    targetArtifactId: child.id,
    targetRecordId: child.recordId,
    targetLogicalName: child.logicalName,
    relationType: "lookup",
    label: child.entityDisplayName ?? getArtifactLabel(child.kind),
    resolved: true,
    warnings: [],
  };
}

function parentsFromEdges(child: Artifact, kind: Artifact["kind"], edges: Dependency[], byId: Map<string, Artifact>): Map<string, Artifact> {
  const result = new Map<string, Artifact>();
  for (const edge of edges) {
    if (!edge.targetArtifactId) continue;
    const source = byId.get(edge.sourceArtifactId);
    const target = byId.get(edge.targetArtifactId);
    const parent = source?.id === child.id ? target : target?.id === child.id ? source : undefined;
    if (parent?.kind === kind) result.set(parent.id, parent);
  }
  return result;
}

function parentsFromRecordLookups(child: Artifact, kind: Artifact["kind"], artifacts: Artifact[]): Map<string, Artifact> {
  return new Map(artifacts.flatMap((parent) => parent.kind === kind &&
    (recordReferences(child.sourceRecord, parent.recordId) || recordReferences(parent.sourceRecord, child.recordId))
    ? [[parent.id, parent] as const]
    : []));
}

function relatedRecords(child: Artifact, artifacts: Artifact[], edges: Dependency[]): Artifact[] {
  return artifacts.filter((record) => (record.kind === "email" || record.kind === "marketingForm") &&
    (edges.some((edge) => edge.sourceArtifactId === record.id && edge.targetArtifactId === child.id) ||
      recordReferences(record.sourceRecord, child.recordId)));
}

function parentsFromEmailLookups(child: Artifact, kind: Artifact["kind"], artifacts: Artifact[], edges: Dependency[]): Map<string, Artifact> {
  const candidates = artifacts.filter((artifact) => artifact.kind === kind);
  const result = new Map<string, Artifact>();
  for (const record of relatedRecords(child, artifacts, edges)) {
    for (const parent of candidates) {
      if (edges.some((edge) => edge.sourceArtifactId === record.id && edge.targetArtifactId === parent.id && edge.relationType === "lookup") ||
        recordReferences(record.sourceRecord, parent.recordId)) result.set(parent.id, parent);
    }
  }
  return result;
}

function parentsFromUniqueCandidate(child: Artifact, kind: Artifact["kind"], artifacts: Artifact[]): Map<string, Artifact> {
  const candidates = artifacts.filter((artifact) => artifact.kind === kind);
  const onlyPurpose = child.kind !== "purpose" || artifacts.filter((artifact) => artifact.kind === "purpose").length === 1;
  const parent = onlyPurpose && candidates.length === 1 ? candidates[0] : undefined;
  return parent ? new Map([[parent.id, parent]]) : new Map();
}

function semanticParents(discovery: DiscoveryResult, child: Artifact, kind: Artifact["kind"], byId: Map<string, Artifact>): Map<string, Artifact> {
  const strategies = [
    () => parentsFromEdges(child, kind, discovery.dependencies, byId),
    () => parentsFromRecordLookups(child, kind, discovery.artifacts),
    () => parentsFromEmailLookups(child, kind, discovery.artifacts, discovery.dependencies),
    () => parentsFromUniqueCandidate(child, kind, discovery.artifacts),
  ];
  for (const resolve of strategies) {
    const parents = resolve();
    if (parents.size) return parents;
  }
  return new Map();
}

function canonicalEdges(discovery: DiscoveryResult, byId: Map<string, Artifact>): { edges: Dependency[]; childIds: Set<string>; parentsByChild: Map<string, Set<string>> } {
  const edges: Dependency[] = [];
  const childIds = new Set<string>();
  const parentsByChild = new Map<string, Set<string>>();
  for (const child of discovery.artifacts) {
    const kind = PARENT_KIND[child.kind];
    if (!kind) continue;
    const parents = [...semanticParents(discovery, child, kind, byId).values()];
    if (!parents.length) continue;
    childIds.add(child.id);
    parentsByChild.set(child.id, new Set(parents.map((parent) => parent.id)));
    for (const parent of child.kind === "compliance" ? parents : parents.slice(0, 1)) {
      edges.push(makeEdge(parent, child, "semantic"));
    }
  }
  return { edges, childIds, parentsByChild };
}

function shouldKeepEdge(edge: Dependency, discovery: DiscoveryResult, byId: Map<string, Artifact>, semantic: ReturnType<typeof canonicalEdges>): boolean {
  if (semantic.childIds.has(edge.sourceArtifactId) || (edge.targetArtifactId && semantic.childIds.has(edge.targetArtifactId))) return false;
  if (!edge.targetArtifactId) return true;
  const source = byId.get(edge.sourceArtifactId);
  const target = byId.get(edge.targetArtifactId);
  if (source?.logicalName === "journey-embedded" && source.kind === "email" && target?.kind === "compliance") return false;
  if (source?.logicalName === "journey-embedded" && target?.logicalName !== "journey-embedded" && target?.kind !== "email") return true;
  const emailActionHasTarget = target?.kind === "email" && source?.logicalName !== "journey-embedded" && discovery.dependencies.some((candidate) =>
    candidate.targetArtifactId === target.id && byId.get(candidate.sourceArtifactId)?.logicalName === "journey-embedded" &&
    byId.get(candidate.sourceArtifactId)?.kind === "email",
  );
  if (emailActionHasTarget) return false;
  const permittedParents = semantic.parentsByChild.get(edge.targetArtifactId);
  return !permittedParents || permittedParents.has(edge.sourceArtifactId);
}

function removeDuplicateEmailEdges(edges: Dependency[], byId: Map<string, Artifact>): Dependency[] {
  return edges.filter((edge) => {
    if (!edge.targetArtifactId) return true;
    const source = byId.get(edge.sourceArtifactId);
    const target = byId.get(edge.targetArtifactId);
    if (source?.kind !== "email" || !target) return true;
    const parentKind = target.kind === "purpose" ? "compliance" : target.kind === "topic" ? "purpose" : undefined;
    return !parentKind || !edges.some((candidate) =>
      candidate.targetArtifactId === target.id && byId.get(candidate.sourceArtifactId)?.kind === parentKind,
    );
  });
}

function findUsedPurposeTopicPairs(discovery: DiscoveryResult): Set<string> {
  const pairs = new Set<string>();
  for (const record of discovery.artifacts) {
    if (record.kind !== "email" && record.kind !== "marketingForm") continue;
    const refs = new Set(discovery.dependencies.filter((edge) => edge.sourceArtifactId === record.id && edge.targetArtifactId)
      .map((edge) => edge.targetArtifactId as string));
    for (const artifact of discovery.artifacts) {
      if (recordReferences(record.sourceRecord, artifact.recordId)) refs.add(artifact.id);
    }
    const purposes = discovery.artifacts.filter((artifact) => artifact.kind === "purpose" && refs.has(artifact.id));
    const topics = discovery.artifacts.filter((artifact) => artifact.kind === "topic" && refs.has(artifact.id));
    for (const purpose of purposes) for (const topic of topics) pairs.add(`${purpose.id}->${topic.id}`);
  }
  return pairs;
}

function buildEdges(discovery: DiscoveryResult, byId: Map<string, Artifact>): Dependency[] {
  const semantic = canonicalEdges(discovery, byId);
  const kept = discovery.dependencies.filter((edge) => shouldKeepEdge(edge, discovery, byId, semantic));
  const combined = [...kept, ...semantic.edges].filter((edge) => {
    const source = byId.get(edge.sourceArtifactId);
    const target = edge.targetArtifactId ? byId.get(edge.targetArtifactId) : undefined;
    return !(source?.logicalName === "journey-embedded" && source.kind === "email" && target?.kind === "compliance");
  });
  const deduplicated = removeDuplicateEmailEdges(combined, byId);
  const usedPairs = findUsedPurposeTopicPairs(discovery);
  return deduplicated.filter((edge) => {
    if (!edge.targetArtifactId) return true;
    const source = byId.get(edge.sourceArtifactId);
    const target = byId.get(edge.targetArtifactId);
    return source?.kind !== "purpose" || target?.kind !== "topic" || usedPairs.has(`${source.id}->${target.id}`);
  });
}

function groupEdgesBySource(edges: Dependency[]): Map<string, Dependency[]> {
  const grouped = new Map<string, Dependency[]>();
  for (const edge of edges) {
    const sourceEdges = grouped.get(edge.sourceArtifactId) ?? [];
    sourceEdges.push(edge);
    grouped.set(edge.sourceArtifactId, sourceEdges);
  }
  return grouped;
}

function promotedArtifacts(edges: Dependency[], artifacts: Artifact[], rootId: string): Set<string> {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const inbound = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.targetArtifactId) continue;
    const parents = inbound.get(edge.targetArtifactId) ?? new Set<string>();
    parents.add(edge.sourceArtifactId);
    inbound.set(edge.targetArtifactId, parents);
  }
  const promoted = new Set<string>();
  for (const [id, parents] of inbound) {
    if (parents.size <= 1 || id === rootId) continue;
    const artifact = byId.get(id);
    const staysNested = artifact?.kind === "purpose" || artifact?.kind === "topic" || artifact?.kind === "sender";
    const emailAction = artifact?.kind === "email" && [...parents].some((parentId) => {
      const parent = byId.get(parentId);
      return parent?.logicalName === "journey-embedded" && parent.kind === "email";
    });
    if (artifact && !staysNested && !emailAction) promoted.add(id);
  }
  return promoted;
}

/** Produces the semantic, UI-ready dependency tree for a Journey discovery result. */
export function buildDependencyTree(discovery: DiscoveryResult | null): DependencyTreeModel {
  if (!discovery) return { dependenciesBySource: new Map(), promotedArtifactIds: new Set() };
  const byId = new Map(discovery.artifacts.map((artifact) => [artifact.id, artifact]));
  const edges = buildEdges(discovery, byId);
  return {
    dependenciesBySource: groupEdgesBySource(edges),
    promotedArtifactIds: promotedArtifacts(edges, discovery.artifacts, discovery.root.id),
  };
}
