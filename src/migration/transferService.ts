import type { Artifact, MigrationComparison, MigrationPlanItem } from "../discovery/types";
import { getMigrationRank, getParentKind } from "../discovery/artifactCatalog";

export type TransferProgress = {
  completed: number;
  total: number;
  artifact: Artifact;
  status: "running" | "created" | "skipped" | "failed";
  targetId?: string;
  error?: string;
  message?: string;
};

export type TransferResult = {
  created: Array<{ sourceArtifactId: string; targetId: string }>;
  skipped: string[];
  failed: Array<{ sourceArtifactId: string; error: string }>;
};

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const OMIT_KEYS = /^(?:createdon|modifiedon|overriddencreatedon|versionnumber|statecode|statuscode|ownerid|createdby|modifiedby|createdonbehalfby|modifiedonbehalfby|owning[a-z]+|timezoneruleversionnumber|utcconversiontimezonecode)$/i;

function rewrite(value: unknown, mappings: Map<string, string>): unknown {
  if (typeof value === "string") return value.replace(GUID, (id) => mappings.get(id.toLowerCase()) ?? id);
  if (Array.isArray(value)) return value.map((item) => rewrite(item, mappings));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, mappings)]));
  return value;
}

export function buildArtifactPayload(item: MigrationPlanItem, artifact: Artifact, comparison: MigrationComparison, mappings: Map<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const targetBySourceId = new Map(comparison.plan.map((item) => [item.sourceArtifactId, item]));
  const sourceRecord = artifact.sourceRecord;
  for (const [key, rawValue] of Object.entries(sourceRecord)) {
    if (key.includes("@") || /^_.*_value$/i.test(key) || OMIT_KEYS.test(key)) continue;
    const normalizedKey = key.toLowerCase();
    const isRecordPrimaryId = normalizedKey === `${artifact.logicalName.toLowerCase()}id` ||
      (normalizedKey.endsWith("id") && typeof rawValue === "string" &&
        rawValue.toLowerCase() === artifact.recordId.toLowerCase() && !normalizedKey.startsWith("msdynmkt_"));
    if (isRecordPrimaryId) continue;
    payload[key] = rewrite(rawValue, mappings);
  }
  if (item.createName !== undefined && artifact.primaryNameAttribute) {
    payload[artifact.primaryNameAttribute] = item.createName;
  }
  for (const [key, rawValue] of Object.entries(sourceRecord)) {
    const lookup = key.match(/^_(.+)_value$/i);
    if (!lookup || typeof rawValue !== "string") continue;
    const targetId = mappings.get(rawValue.toLowerCase());
    if (!targetId) continue;
    const dependency = comparison.source.artifacts.find((candidate) => candidate.recordId.toLowerCase() === rawValue.toLowerCase());
    const targetItem = dependency ? targetBySourceId.get(dependency.id) : undefined;
    const targetLogicalName = targetItem?.targetArtifactId
      ? comparison.target?.artifacts.find((candidate) => candidate.id === targetItem.targetArtifactId)?.logicalName
      : dependency?.logicalName;
    const targetEntitySet = targetItem?.targetArtifactId
      ? comparison.target?.artifacts.find((candidate) => candidate.id === targetItem.targetArtifactId)?.entitySetName
      : dependency?.entitySetName;
    if (targetEntitySet && targetLogicalName) payload[`${lookup[1]}@odata.bind`] = `/${targetEntitySet}(${targetId})`;
  }
  return payload;
}

function validateCreateArtifact(artifact: Artifact, payload: Record<string, unknown>): string | undefined {
  if (artifact.canCreate === false) return `${artifact.displayName} (${artifact.logicalName}) does not support Create in the target metadata.`;
  if (artifact.kind === "purpose") return `${artifact.displayName}: Purpose records cannot be created through the Dataverse Create operation in this environment.`;
  if (artifact.kind === "compliance") {
    const present = Object.keys(payload).filter((key) => payload[key] !== null && payload[key] !== undefined && payload[key] !== "");
    if (!present.some((key) => /name|channel|purpose|compliance|default|consent|description/i.test(key))) {
      return `${artifact.displayName}: Compliance Profile payload has no recognized required business field.`;
    }
  }
  return undefined;
}

function createOrder(comparison: MigrationComparison): MigrationPlanItem[] {
  const selected = comparison.plan.filter((item) => item.selected && item.action === "create");
  const selectedIds = new Set(selected.map((item) => item.sourceArtifactId));
  const artifactById = new Map(comparison.source.artifacts.map((artifact) => [artifact.id, artifact]));
  const selectedById = new Map(selected.map((item) => [item.sourceArtifactId, item]));
  const dependents = new Map<string, Set<string>>();
  const indegree = new Map(selected.map((item) => [item.sourceArtifactId, 0]));
  const addOrderEdge = (before: string, after: string) => {
    if (before === after || !selectedIds.has(before) || !selectedIds.has(after)) return;
    const targets = dependents.get(before) ?? new Set<string>();
    if (targets.has(after)) return;
    targets.add(after);
    dependents.set(before, targets);
    indegree.set(after, (indegree.get(after) ?? 0) + 1);
  };

  for (const edge of comparison.source.dependencies) {
    if (!edge.targetArtifactId || !selectedIds.has(edge.sourceArtifactId) || !selectedIds.has(edge.targetArtifactId)) continue;
    const source = artifactById.get(edge.sourceArtifactId);
    const target = artifactById.get(edge.targetArtifactId);
    if (!source || !target) continue;

    // Customer Insights semantic child relationships define the canonical
    // creation order. Ignore the reverse lookup edge (Purpose -> Compliance,
    // Topic -> Purpose) because it would create a false cycle.
    if (getParentKind(target.kind) === source.kind) {
      addOrderEdge(source.id, target.id);
    } else if (getParentKind(source.kind) === target.kind) {
      continue;
    } else {
      // Normal lookup/reference: create the referenced target first.
      addOrderEdge(target.id, source.id);
    }
  }

  const ready = selected
    .filter((item) => indegree.get(item.sourceArtifactId) === 0)
    .sort((left, right) => getMigrationRank(artifactById.get(left.sourceArtifactId)?.kind ?? "unknown") - getMigrationRank(artifactById.get(right.sourceArtifactId)?.kind ?? "unknown"));
  const result: MigrationPlanItem[] = [];
  while (ready.length) {
    const item = ready.shift()!;
    result.push(item);
    for (const dependentId of dependents.get(item.sourceArtifactId) ?? []) {
      const nextDegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        const dependent = selectedById.get(dependentId);
        if (dependent) ready.push(dependent);
        ready.sort((left, right) => getMigrationRank(artifactById.get(left.sourceArtifactId)?.kind ?? "unknown") - getMigrationRank(artifactById.get(right.sourceArtifactId)?.kind ?? "unknown"));
      }
    }
  }
  if (result.length !== selected.length) throw new Error("Circular migration dependency detected.");
  return result;
}

export async function executeCreateOnlyTransfer(
  comparison: MigrationComparison,
  onProgress?: (progress: TransferProgress) => void,
): Promise<TransferResult> {
  if (comparison.blockingErrors.length) throw new Error(comparison.blockingErrors.join(" "));
  const order = createOrder(comparison);
  const missingDependencies = order.flatMap((item) => comparison.source.dependencies
    .filter((edge) => edge.sourceArtifactId === item.sourceArtifactId && edge.targetArtifactId)
    .filter((edge) => {
      const dependency = comparison.plan.find((candidate) => candidate.sourceArtifactId === edge.targetArtifactId);
      return dependency?.action === "create" ? !order.some((candidate) => candidate.sourceArtifactId === dependency.sourceArtifactId) : dependency?.action === "manual" || dependency?.action === "blocked";
    })
    .map((edge) => `${item.sourceArtifactId}: dependency ${edge.targetArtifactId} is not available.`));
  if (missingDependencies.length) throw new Error(missingDependencies.join(" "));
  const mappings = new Map<string, string>();
  for (const item of comparison.plan) {
    if (item.targetRecordId) {
      const source = comparison.source.artifacts.find((artifact) => artifact.id === item.sourceArtifactId);
      if (source) mappings.set(source.recordId.toLowerCase(), item.targetRecordId);
    }
  }
  const result: TransferResult = { created: [], skipped: comparison.plan.filter((item) => !item.selected || item.action !== "create").map((item) => item.sourceArtifactId), failed: [] };
  let completed = 0;
  for (const item of comparison.plan.filter((candidate) => !candidate.selected || candidate.action !== "create")) {
    const artifact = comparison.source.artifacts.find((candidate) => candidate.id === item.sourceArtifactId);
    if (artifact) onProgress?.({ completed, total: order.length, artifact, status: "skipped", message: `${artifact.displayName} skipped (${item.action}).` });
  }
  for (const item of order) {
    const artifact = comparison.source.artifacts.find((candidate) => candidate.id === item.sourceArtifactId);
    if (!artifact || artifact.logicalName === "journey-embedded") continue;
    try {
      onProgress?.({ completed, total: order.length, artifact, status: "running", message: `Creating ${artifact.displayName} (${artifact.logicalName})…` });
      const payload = buildArtifactPayload(item, artifact, comparison, mappings);
      const validationError = validateCreateArtifact(artifact, payload);
      if (validationError) throw new Error(validationError);
      const response = await window.dataverseAPI.create(artifact.logicalName, payload, "secondary");
      mappings.set(artifact.recordId.toLowerCase(), response.id);
      result.created.push({ sourceArtifactId: artifact.id, targetId: response.id });
      onProgress?.({ completed: ++completed, total: order.length, artifact, status: "created", targetId: response.id, message: `${artifact.displayName} created with ID ${response.id}.` });
      await window.dataverseAPI.retrieve(artifact.logicalName, response.id, undefined, "secondary");
      onProgress?.({ completed, total: order.length, artifact, status: "created", targetId: response.id, message: `${artifact.displayName} read-back validation succeeded.` });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      result.failed.push({ sourceArtifactId: artifact.id, error });
      onProgress?.({ completed: ++completed, total: order.length, artifact, status: "failed", error, message: `${artifact.displayName} failed: ${error}` });
    }
  }
  return result;
}
