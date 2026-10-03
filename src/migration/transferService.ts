import type { Artifact, MigrationComparison, MigrationPlanItem } from "../discovery/types";
import { getMigrationRank, getParentKind, getParentLookupField, getParentNavigationProperty, JSON_REFERENCE_FIELDS } from "../discovery/artifactCatalog";
import { getSemanticParentArtifact } from "../discovery/semanticRelationships";
import { buildPurposesForComplianceFetchXml, PURPOSE_COMPLIANCE_RELATIONSHIP } from "../discovery/purposeComplianceRelationship";
import { logDiagnostic } from "../discovery/diagnostics";

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

function semanticParent(artifact: Artifact, comparison: MigrationComparison): Artifact | undefined {
  return getSemanticParentArtifact(artifact, comparison.source.artifacts, comparison.source.dependencies);
}

function parentLookup(artifact: Artifact, parent: Artifact): { attribute: string; value: string } | undefined {
  const knownAttribute = getParentLookupField(artifact.kind);
  if (knownAttribute) return { attribute: knownAttribute, value: parent.recordId };
  for (const [key, value] of Object.entries(artifact.sourceRecord)) {
    const match = key.match(/^_(.+)_value$/i);
    if (match && typeof value === "string" && value.toLowerCase() === parent.recordId.toLowerCase()) {
      return { attribute: match[1], value };
    }
  }
  return undefined;
}

function recordIdAttribute(artifact: Artifact): string {
  const entry = Object.entries(artifact.sourceRecord).find(([key, value]) =>
    !key.startsWith("_") && /id$/i.test(key) && typeof value === "string" && value.toLowerCase() === artifact.recordId.toLowerCase(),
  );
  return entry?.[0] ?? `${artifact.logicalName}id`;
}

function rewrite(value: unknown, mappings: Map<string, string>): unknown {
  if (typeof value === "string") return value.replace(GUID, (id) => mappings.get(id.toLowerCase()) ?? id);
  if (Array.isArray(value)) return value.map((item) => rewrite(item, mappings));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, mappings)]));
  return value;
}

const REFERENCE_GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

type JourneyReferenceSet = {
  artifactIds: Set<string>;
  unresolved: Array<{ id: string; kinds: readonly Artifact["kind"][] }>;
};

function journeyReferences(journey: Artifact, artifacts: Artifact[]): JourneyReferenceSet {
  const artifactsByRecordId = new Map(artifacts.map((artifact) => [artifact.recordId.replace(/[{}]/g, "").toLowerCase(), artifact]));
  const result: JourneyReferenceSet = { artifactIds: new Set(), unresolved: [] };
  const collectGuids = (value: unknown, targetKinds: readonly Artifact["kind"][]) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(REFERENCE_GUID)) {
        const target = artifactsByRecordId.get(match[0].replace(/[{}]/g, "").toLowerCase());
        if (target && targetKinds.includes(target.kind)) result.artifactIds.add(target.id);
        else result.unresolved.push({ id: match[0].replace(/[{}]/g, "").toLowerCase(), kinds: targetKinds });
      }
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try { visit(JSON.parse(trimmed) as unknown); } catch { /* Leave non-JSON string content untouched. */ }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectGuids(item, targetKinds));
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach((item) => collectGuids(item, targetKinds));
    }
  };
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try { visit(JSON.parse(trimmed) as unknown); } catch { /* Keep invalid JSON unchanged. */ }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const targetKinds = JSON_REFERENCE_FIELDS[normalizedKey];
      if (targetKinds) collectGuids(nested, targetKinds);
      else visit(nested);
    }
  };
  for (const [field, value] of Object.entries(journey.sourceRecord)) {
    if (/journeyjson$/i.test(field)) visit(value);
  }
  return result;
}

function requiredJourneyDependencyIds(journey: Artifact, comparison: MigrationComparison): Set<string> {
  const ids = new Set(journeyReferences(journey, comparison.source.artifacts).artifactIds);
  for (const dependency of comparison.source.dependencies) {
    if (dependency.sourceArtifactId !== journey.id || !dependency.targetArtifactId) continue;
    if (comparison.source.artifacts.find((artifact) => artifact.id === dependency.targetArtifactId)?.logicalName !== "journey-embedded") {
      ids.add(dependency.targetArtifactId);
    }
  }
  return ids;
}

function validateJourneyDependencies(comparison: MigrationComparison, order: MigrationPlanItem[], mappings: Map<string, string>): string[] {
  const artifactsById = new Map(comparison.source.artifacts.map((artifact) => [artifact.id, artifact]));
  const planById = new Map(comparison.plan.map((item) => [item.sourceArtifactId, item]));
  const orderIndex = new Map(order.map((item, index) => [item.sourceArtifactId, index]));
  const errors: string[] = [];
  for (const journey of comparison.source.artifacts.filter((artifact) => artifact.kind === "journey")) {
    const journeyPlan = planById.get(journey.id);
    if (!journeyPlan?.selected || journeyPlan.action !== "create") continue;
    const references = journeyReferences(journey, comparison.source.artifacts);
    for (const artifactId of requiredJourneyDependencyIds(journey, comparison)) references.artifactIds.add(artifactId);
    for (const unresolved of references.unresolved) {
      errors.push(`${journey.displayName}: Journey JSON references undiscovered record ${unresolved.id} (${unresolved.kinds.join("/")}).`);
    }
    for (const artifactId of references.artifactIds) {
      const dependency = artifactsById.get(artifactId);
      if (!dependency || mappings.has(dependency.recordId.toLowerCase())) continue;
      const item = planById.get(artifactId);
      const itemPosition = orderIndex.get(artifactId);
      const journeyPosition = orderIndex.get(journey.id);
      if (item?.selected && item.action === "create" && itemPosition !== undefined && journeyPosition !== undefined && itemPosition < journeyPosition) continue;
      errors.push(`${journey.displayName}: referenced ${dependency.kind} '${dependency.displayName}' has no target mapping before Journey creation.`);
    }
  }
  return errors;
}

export function buildArtifactPayload(item: MigrationPlanItem, artifact: Artifact, comparison: MigrationComparison, mappings: Map<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const targetBySourceId = new Map(comparison.plan.map((item) => [item.sourceArtifactId, item]));
  const parent = semanticParent(artifact, comparison);
  const parentLookupAttribute = getParentLookupField(artifact.kind)?.toLowerCase();
  const sourceRecord = artifact.sourceRecord;
  for (const [key, rawValue] of Object.entries(sourceRecord)) {
    if (key.includes("@") || /^_.*_value$/i.test(key) || OMIT_KEYS.test(key)) continue;
    const normalizedKey = key.toLowerCase();
    // Lookup properties may appear as raw values as well as OData's
    // _<attribute>_value aliases. Never send the raw lookup attribute value;
    // the correctly resolved navigation property is bound below.
    if (parentLookupAttribute && normalizedKey === parentLookupAttribute) continue;
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
    if (lookup[1].toLowerCase() === getParentLookupField(artifact.kind)?.toLowerCase() ||
      (parent && lookup[1].toLowerCase() === parentLookup(artifact, parent)?.attribute.toLowerCase()) ||
      (parent && rawValue.toLowerCase() === parent.recordId.toLowerCase())) continue;
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
  const parentReference = parent ? parentLookup(artifact, parent) : undefined;
  const targetParentId = parent ? mappings.get(parent.recordId.toLowerCase()) : undefined;
  if (artifact.kind !== "purpose" && artifact.kind !== "topic" && parent && parentReference && targetParentId && parent.entitySetName) {
    const navigationProperty = getParentNavigationProperty(artifact.kind) ?? parentReference.attribute;
    payload[`${navigationProperty}@odata.bind`] = `/${parent.entitySetName}(${targetParentId})`;
  }
  return payload;
}

function validateCreateArtifact(artifact: Artifact, payload: Record<string, unknown>): string | undefined {
  if (artifact.canCreate === false) return `${artifact.displayName} (${artifact.logicalName}) does not support Create in the target metadata.`;
  if (artifact.kind === "compliance") {
    const present = Object.keys(payload).filter((key) => payload[key] !== null && payload[key] !== undefined && payload[key] !== "");
    if (!present.some((key) => /name|channel|purpose|compliance|default|consent|description/i.test(key))) {
      return `${artifact.displayName}: Compliance Profile payload has no recognized required business field.`;
    }
  }
  return undefined;
}

function normalizedPurposeName(value: unknown): string {
  return typeof value === "string" ? value.trim().normalize("NFKC").toLowerCase() : "";
}

async function findExistingPurpose(
  artifact: Artifact,
  comparison: MigrationComparison,
  mappings: Map<string, string>,
): Promise<string | undefined> {
  if (artifact.kind !== "purpose") return undefined;
  const parent = semanticParent(artifact, comparison);
  const reference = parent ? parentLookup(artifact, parent) : undefined;
  const parentId = parent ? mappings.get(parent.recordId.toLowerCase()) : undefined;
  if (!parent || !reference || !parentId) {
    throw new Error(`${artifact.displayName}: the target Compliance Profile must exist before checking or creating its Purpose.`);
  }
  const idAttribute = recordIdAttribute(artifact);
  const fetchXml = buildPurposesForComplianceFetchXml(parentId, [idAttribute, artifact.primaryNameAttribute ?? "msdynmkt_name"]);
  const records = (await window.dataverseAPI.fetchXmlQuery(fetchXml, "secondary")).value;
  const sourceName = normalizedPurposeName(artifact.sourceRecord[artifact.primaryNameAttribute ?? ""] ?? artifact.displayName);
  const matchesPurpose = (record: Record<string, unknown>) => {
    const name = normalizedPurposeName(record[artifact.primaryNameAttribute ?? ""]);
    return name === sourceName;
  };
  const existing = records.find(matchesPurpose);
  if (!existing) return undefined;
  const existingId = existing[idAttribute];
  if (typeof existingId !== "string" || !existingId) {
    throw new Error(`${artifact.displayName}: an existing Purpose was found, but its target ID was missing from the Dataverse response.`);
  }
  // The generated/previously existing Purpose is the target for every Topic
  // that references this source Purpose.
  mappings.set(artifact.recordId.toLowerCase(), existingId);
  return existingId;
}

async function getParentLookupNavigationProperty(child: Artifact, parent: Artifact): Promise<string> {
  const expectedLookup = getParentLookupField(child.kind)?.toLowerCase();
  if (!expectedLookup) {
    throw new Error(`No parent lookup attribute is configured for ${child.logicalName} -> ${parent.logicalName}.`);
  }
  const response = await window.dataverseAPI.getEntityRelatedMetadata(
    child.logicalName,
    "ManyToOneRelationships",
    ["ReferencingAttribute", "ReferencedEntity", "ReferencingEntity", "ReferencingEntityNavigationPropertyName"],
    "secondary",
  ) as { value: Array<Record<string, unknown>> };
  const relationship = response.value.find((item) =>
    typeof item.ReferencedEntity === "string" && item.ReferencedEntity.toLowerCase() === parent.logicalName.toLowerCase() &&
    typeof item.ReferencingAttribute === "string" && item.ReferencingAttribute.toLowerCase() === expectedLookup &&
    (typeof item.ReferencingEntity !== "string" || item.ReferencingEntity.toLowerCase() === child.logicalName.toLowerCase()),
  );
  const navigationProperty = relationship?.ReferencingEntityNavigationPropertyName;
  if (typeof navigationProperty !== "string" || !navigationProperty) {
    throw new Error(`Could not resolve the ${child.logicalName}.${expectedLookup} lookup navigation property to ${parent.logicalName}.`);
  }
  return navigationProperty;
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

  const selectedJourneys = selected.filter((item) => artifactById.get(item.sourceArtifactId)?.kind === "journey");
  for (const journey of selectedJourneys) {
    const journeyArtifact = artifactById.get(journey.sourceArtifactId);
    if (!journeyArtifact) continue;
    for (const dependencyId of requiredJourneyDependencyIds(journeyArtifact, comparison)) {
      if (selectedIds.has(dependencyId)) addOrderEdge(dependencyId, journey.sourceArtifactId);
    }
  }

  const compareMigrationRank = (left: MigrationPlanItem, right: MigrationPlanItem) =>
    getMigrationRank(artifactById.get(left.sourceArtifactId)?.kind ?? "unknown") -
    getMigrationRank(artifactById.get(right.sourceArtifactId)?.kind ?? "unknown");
  const ready = selected
    .filter((item) => indegree.get(item.sourceArtifactId) === 0)
    .sort(compareMigrationRank);
  const result: MigrationPlanItem[] = [];
  while (ready.length > 0) {
    const item = ready.shift();
    if (!item) continue;
    result.push(item);
    for (const dependentId of dependents.get(item.sourceArtifactId) ?? []) {
      const nextDegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        const dependent = selectedById.get(dependentId);
        if (dependent) ready.push(dependent);
        ready.sort(compareMigrationRank);
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
      return dependency?.action === "create"
        ? !order.some((candidate) => candidate.sourceArtifactId === dependency.sourceArtifactId)
        : (dependency?.action === "manual" || dependency?.action === "blocked") && !dependency.targetRecordId;
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
  const journeyDependencyErrors = validateJourneyDependencies(comparison, order, mappings);
  if (journeyDependencyErrors.length) throw new Error(journeyDependencyErrors.join(" "));
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
      const parent = semanticParent(artifact, comparison);
      if (parent && !mappings.has(parent.recordId.toLowerCase())) {
        throw new Error(`${artifact.displayName}: target ${parent.kind} is unavailable; this record cannot be linked safely.`);
      }
      const validationError = validateCreateArtifact(artifact, payload);
      if (validationError) throw new Error(validationError);
      if (artifact.kind === "topic") {
        const purpose = semanticParent(artifact, comparison);
        if (!purpose || !mappings.has(purpose.recordId.toLowerCase())) {
          throw new Error(`${artifact.displayName}: the target Purpose is unavailable for the lookup.`);
        }
        const navigationProperty = await getParentLookupNavigationProperty(artifact, purpose);
        const purposeId = mappings.get(purpose.recordId.toLowerCase());
        if (!purposeId) throw new Error(`${artifact.displayName}: the target Purpose mapping disappeared before creation.`);
        payload[`${navigationProperty}@odata.bind`] = `/${purpose.entitySetName}(${purposeId})`;
        logDiagnostic({
          level: "info",
          phase: "migration-topic-purpose-lookup",
          entity: artifact.logicalName,
          sourceArtifactId: artifact.id,
          sourceDisplayName: artifact.displayName,
          message: `Binding Topic to its mapped Purpose using navigation property ${navigationProperty}.`,
          rawResult: { purposeId, navigationProperty, payloadKeys: Object.keys(payload) },
        });
      }
      const existingPurposeId = await findExistingPurpose(artifact, comparison, mappings);
      if (existingPurposeId) {
        result.skipped.push(artifact.id);
        onProgress?.({ completed: ++completed, total: order.length, artifact, status: "skipped", targetId: existingPurposeId, message: `${artifact.displayName} already exists in the target Compliance Profile; using its ID ${existingPurposeId}.` });
        continue;
      }
      const response = await window.dataverseAPI.create(artifact.logicalName, payload, "secondary");
      if (artifact.kind === "purpose") {
        const parentArtifact = semanticParent(artifact, comparison);
        const parentId = parentArtifact ? mappings.get(parentArtifact.recordId.toLowerCase()) : undefined;
        if (!parentArtifact || !parentId) throw new Error(`${artifact.displayName}: the target ${parentArtifact?.kind ?? "parent"} is unavailable for the N:N association.`);
        await window.dataverseAPI.associate(
          artifact.logicalName,
          response.id,
          PURPOSE_COMPLIANCE_RELATIONSHIP,
          parentArtifact.logicalName,
          parentId,
          "secondary",
        );
      }
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
