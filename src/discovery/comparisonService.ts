import { artifactDepth, discoverJourney, loadJourneys, type ConnectionTarget } from "./discoveryService";
import { discoverArtifactsByIdentity } from "./targetArtifactDiscovery";
import { getParentKind, getParentLookupField } from "./artifactCatalog";
import type { Artifact, ArtifactMatch, DiscoveryResult, JourneyOption, MigrationComparison, MigrationPlanItem } from "./types";

function normalizeIdentityValue(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "")
    : "";
}

function stableIdentities(artifact: Artifact): string[] {
  // Only use the resolved Dataverse primary/display name. Other fields such as
  // sender address, domain, and lookup aliases are not unique identities and
  // caused unrelated target records to be merged into an ambiguous match.
  const name = normalizeIdentityValue(artifact.displayName);
  return name ? [`${artifact.logicalName.toLowerCase()}|${name}`] : [];
}

function lookupRecordIds(artifact: Artifact): string[] {
  const field = getParentLookupField(artifact.kind);
  if (!field) return [];
  // Dataverse returns a lookup as _<logical name>_value when queried through
  // Web API, while mocked/raw records may contain the logical name itself.
  const value = artifact.sourceRecord[field] ?? artifact.sourceRecord[`_${field}_value`];
  return typeof value === "string" && value.toLowerCase() !== artifact.recordId.toLowerCase()
    ? [value.toLowerCase()]
    : [];
}

function dependencyParents(
  target: DiscoveryResult,
  artifact: Artifact,
  parentKind: Artifact["kind"],
  artifactsById: Map<string, Artifact>,
): string[] {
  return target.dependencies.flatMap((dependency) => {
    if (dependency.sourceArtifactId !== artifact.id || dependency.relationType !== "lookup" || !dependency.targetArtifactId) return [];
    const parent = artifactsById.get(dependency.targetArtifactId);
    return parent?.kind === parentKind ? [parent.recordId.toLowerCase()] : [];
  });
}

function compareArtifacts(source: DiscoveryResult, target: DiscoveryResult): ArtifactMatch[] {
  const byIdentity = new Map<string, Artifact[]>();
  const targetArtifactsById = new Map(target.artifacts.map((artifact) => [artifact.id, artifact]));
  const sourceArtifactsById = new Map(source.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const artifact of target.artifacts) {
    if (artifact.logicalName === "journey-embedded") continue;
    for (const key of stableIdentities(artifact)) {
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), artifact]);
    }
  }
  const matchesBySourceId = new Map<string, ArtifactMatch>();
  const matchOrder = [...source.artifacts].sort((left, right) => artifactDepth(left.kind) - artifactDepth(right.kind));
  for (const artifact of matchOrder) {
    if (artifact.logicalName === "journey-embedded") {
      matchesBySourceId.set(artifact.id, { sourceArtifactId: artifact.id, status: "unsupported", strategy: "embedded journey node", warnings: ["Embedded Journey nodes are compared through the Journey JSON and are not independent Dataverse records."] });
      continue;
    }
    const candidatesById = new Map<string, Artifact>();
    for (const key of stableIdentities(artifact)) {
      for (const candidate of byIdentity.get(key) ?? []) {
        // A paged Dataverse read can expose the same row more than once. It
        // must not turn a single target record into an ambiguous match.
        candidatesById.set(candidate.id.toLowerCase(), candidate);
      }
    }
    let candidates = [...candidatesById.values()];
    const parentKind = getParentKind(artifact.kind);
    if (parentKind) {
      const parentDependency = source.dependencies.find((dependency) => {
        if (dependency.sourceArtifactId !== artifact.id || dependency.relationType !== "lookup" || !dependency.targetArtifactId) return false;
        return sourceArtifactsById.get(dependency.targetArtifactId)?.kind === parentKind;
      });
      const parentSource = parentDependency?.targetArtifactId
        ? sourceArtifactsById.get(parentDependency.targetArtifactId)
        : undefined;
      const parentMatch = parentSource ? matchesBySourceId.get(parentSource.id) : undefined;
      const targetParentId = parentMatch?.status === "exact-match" ? parentMatch.targetRecordId?.toLowerCase() : undefined;
      candidates = targetParentId
        ? candidates.filter((candidate) => {
          const dependencyParentIds = dependencyParents(target, candidate, parentKind, targetArtifactsById);
          return dependencyParentIds.includes(targetParentId) || lookupRecordIds(candidate).includes(targetParentId);
        })
        : [];
    }
    if (candidates.length > 1) {
      matchesBySourceId.set(artifact.id, {
        sourceArtifactId: artifact.id,
        status: "ambiguous",
        strategy: parentKind ? "name + required parent lookup" : "logical name + name",
        score: 1,
        warnings: ["Multiple matching target records were found."]
      });
      continue;
    }
    const targetArtifact = candidates[0];
    if (!targetArtifact) {
      matchesBySourceId.set(artifact.id, { sourceArtifactId: artifact.id, status: "missing", strategy: parentKind ? "name + required parent lookup" : "no target artifact with a matching stable identity", warnings: [] });
      continue;
    }
    matchesBySourceId.set(artifact.id, {
      sourceArtifactId: artifact.id,
      status: "exact-match",
      strategy: "logical name + name",
      score: 1,
      targetArtifactId: targetArtifact.id,
      targetRecordId: targetArtifact.recordId,
      differences: [],
      warnings: [],
    });
  }
  return source.artifacts.flatMap((artifact) => {
    const match = matchesBySourceId.get(artifact.id);
    return match ? [match] : [];
  });
}

function buildPlan(source: DiscoveryResult, matches: ArtifactMatch[]): { plan: MigrationPlanItem[]; blockingErrors: string[] } {
  const actionById = new Map<string, MigrationPlanItem>();
  const blockingErrors: string[] = [];
  const dependenciesByTarget = new Map<string, string[]>();
  for (const dependency of source.dependencies) {
    if (!dependency.targetArtifactId) continue;
    dependenciesByTarget.set(dependency.targetArtifactId, [...(dependenciesByTarget.get(dependency.targetArtifactId) ?? []), dependency.sourceArtifactId]);
  }
  for (const match of matches) {
    const action = match.status === "missing" ? "create" : match.status === "exact-match" ? "automatically-mapped" : match.status === "unsupported" ? "embedded" : "manual";
    const item: MigrationPlanItem = { ...match, action, selected: match.status === "missing", dependencySourceIds: dependenciesByTarget.get(match.sourceArtifactId) ?? [] };
    actionById.set(match.sourceArtifactId, item);
    if (action === "manual") blockingErrors.push(`${match.sourceArtifactId}: target match requires manual confirmation.`);
  }
  // A selected child cannot be created while its source dependency is unresolved.
  for (const item of actionById.values()) {
    if (item.action !== "create") continue;
    const unresolved = item.dependencySourceIds.some((dependencyId) => actionById.get(dependencyId)?.action === "manual" || actionById.get(dependencyId)?.action === "blocked");
    if (unresolved) {
      item.action = "blocked";
      blockingErrors.push(`${item.sourceArtifactId}: a required dependency still needs a manual mapping.`);
    }
  }
  return { plan: [...actionById.values()], blockingErrors };
}

export async function compareJourney(
  sourceJourney: JourneyOption,
  sourceDiscovery: DiscoveryResult,
  targetOrganizationUrl: string,
  connectionTarget: ConnectionTarget = "secondary",
  onProgress?: (message: string) => void,
): Promise<MigrationComparison> {
  const warnings: string[] = [];
  onProgress?.("Loading Journeys from target…");
  const targetJourneys = await loadJourneys(connectionTarget);
  warnings.push(...targetJourneys.warnings);
  const candidates = targetJourneys.journeys.filter((journey) =>
    journey.logicalName.toLowerCase() === sourceJourney.logicalName.toLowerCase() &&
    journey.name.trim().toLowerCase() === sourceJourney.name.trim().toLowerCase(),
  );
  if (candidates.length > 1) {
    const matches = [{ sourceArtifactId: sourceDiscovery.root.id, status: "ambiguous" as const, strategy: "logical name + display name", score: 1, warnings: ["Multiple target Journeys with the same name were found."] }];
    const plan = buildPlan(sourceDiscovery, matches);
    return { source: sourceDiscovery, matches, ...plan, warnings };
  }
  const targetJourney = candidates[0];
  if (!targetJourney) {
    onProgress?.("Journey not found. Loading target artifacts by name…");
    const target = await discoverArtifactsByIdentity(sourceDiscovery, targetOrganizationUrl, connectionTarget);
    const detailMatches = compareArtifacts(sourceDiscovery, target).map((match) => {
      // The source Journey has no target root, but all other supported
      // artifacts can still be matched independently in the target catalog.
      if (sourceDiscovery.artifacts.find((artifact) => artifact.id === match.sourceArtifactId)?.kind === "journey") {
        return { ...match, status: "missing" as const, strategy: "target Journey not found" };
      }
      return match;
    });
    const detailPlan = buildPlan(sourceDiscovery, detailMatches);
    return {
      source: sourceDiscovery,
      target,
      matches: detailMatches,
      ...detailPlan,
      warnings: [...warnings, ...target.warnings.map((warning) => `Target discovery: ${warning}`)],
    };
  }
  onProgress?.("Journey found. Loading its related target artifacts…");
  const target = await discoverJourney(targetJourney, targetOrganizationUrl, connectionTarget);
  const matches = compareArtifacts(sourceDiscovery, target);
  const plan = buildPlan(sourceDiscovery, matches);
  warnings.push(...target.warnings.map((warning) => `Target discovery: ${warning}`));
  if (target.artifacts.length <= 1 && sourceDiscovery.artifacts.length > 1) {
    warnings.push(`Target discovery returned ${target.artifacts.length} artifact(s) for a source with ${sourceDiscovery.artifacts.length}; dependency reads may be incomplete.`);
  }
  return { source: sourceDiscovery, target, targetJourney, matches, ...plan, warnings };
}
