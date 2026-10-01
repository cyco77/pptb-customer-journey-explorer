import type { Artifact, AttributeInfo, DiscoveryResult } from "./types";
import { createRecordUrl } from "./dataverseLinks";
import { logDiagnostic } from "./diagnostics";
import { getSemanticParentArtifact } from "./semanticRelationships";
import { buildPurposesForComplianceFetchXml, PURPOSE_COMPLIANCE_RELATIONSHIP } from "./purposeComplianceRelationship";
import {
  artifactDepth,
  errorMessage,
  escapeODataString,
  getAttributes,
  getEntityCatalog,
  getValue,
  queryAll,
  queryableColumns,
  recordDisplayName,
  selectedColumns,
  type ConnectionTarget,
} from "./discoveryService";
import { getParentKind, getParentLookupField, getParentNavigationProperty } from "./artifactCatalog";

/** Loads only target rows relevant to the supplied source artifacts. */
export async function discoverArtifactsByIdentity(
  source: DiscoveryResult,
  organizationUrl: string,
  connectionTarget: ConnectionTarget = "secondary",
  parentOverrides: Map<string, Artifact> = new Map(),
  includeAllCandidates = false,
): Promise<DiscoveryResult> {
  const catalog = await getEntityCatalog(connectionTarget);
  const artifacts: Artifact[] = [];
  const warnings: string[] = [];
  const matchedParents = new Map<string, Artifact>();

  for (const [sourceId, targetArtifact] of parentOverrides) {
    matchedParents.set(sourceId, targetArtifact);
    if (!artifacts.some((artifact) => artifact.id === targetArtifact.id)) artifacts.push(targetArtifact);
  }

  const attributesCache = new Map<string, Promise<AttributeInfo[]>>();
  const ordered = [...source.artifacts].sort((left, right) => artifactDepth(left.kind) - artifactDepth(right.kind));

  const queryArtifact = async (sourceArtifact: Artifact) => {
    if (sourceArtifact.logicalName === "journey-embedded" || sourceArtifact.kind === "journey" || parentOverrides.has(sourceArtifact.id)) return;

    const entity = catalog.find((candidate) => candidate.logicalName.toLowerCase() === sourceArtifact.logicalName.toLowerCase());
    const phase = includeAllCandidates ? "manual-mapping-candidates" : "target-artifact-match";
    const diagnosticContext = { sourceArtifactId: sourceArtifact.id, sourceDisplayName: sourceArtifact.displayName };

    if (includeAllCandidates) {
      logDiagnostic({
        level: "info", phase, entity: sourceArtifact.logicalName, ...diagnosticContext,
        message: "Preparing target candidate query.",
        rawResult: { sourceArtifactId: sourceArtifact.id, kind: sourceArtifact.kind, includeAllCandidates },
      });
    }
    if (!entity?.primaryNameAttribute) {
      logDiagnostic({
        level: "warning", phase, entity: sourceArtifact.logicalName, ...diagnosticContext,
        message: `Skipped target candidate query for ${sourceArtifact.displayName}: ${!entity ? "entity metadata was not found" : "primary name attribute is unavailable"}.`,
        rawResult: { sourceArtifactId: sourceArtifact.id, kind: sourceArtifact.kind },
      });
      return;
    }

    try {
      const cacheKey = entity.logicalName.toLowerCase();
      let attributesPromise = attributesCache.get(cacheKey);
      if (!attributesPromise) {
        attributesPromise = getAttributes(entity, connectionTarget);
        attributesCache.set(cacheKey, attributesPromise);
      }
      const attributes = await attributesPromise;
      const columns = queryableColumns(selectedColumns(entity, attributes, connectionTarget));
      const filters = includeAllCandidates ? [] : [`${entity.primaryNameAttribute} eq '${escapeODataString(sourceArtifact.displayName)}'`];
      const parentKind = getParentKind(sourceArtifact.kind);
      const sourceParent = parentKind ? getSemanticParentArtifact(sourceArtifact, source.artifacts, source.dependencies) : undefined;
      const parent = sourceParent ? matchedParents.get(sourceParent.id) : undefined;

      if (parentKind) {
        const expectedLookup = getParentLookupField(sourceArtifact.kind);
        const navigationProperty = getParentNavigationProperty(sourceArtifact.kind);

        if (sourceArtifact.kind === "purpose" && parent?.kind === "compliance") {
          const fetchXml = buildPurposesForComplianceFetchXml(parent.recordId, [entity.primaryNameAttribute]);
          logDiagnostic({
            level: "info", phase, entity: entity.logicalName, ...diagnosticContext, query: fetchXml,
            message: "Querying Purpose candidates through the Compliance Profile N:N relationship.",
            rawResult: { targetParentArtifactId: parent.id, targetParentRecordId: parent.recordId, relationship: PURPOSE_COMPLIANCE_RELATIONSHIP },
          });
          const response = await window.dataverseAPI.fetchXmlQuery(fetchXml, connectionTarget);
          const candidates = response.value.flatMap((record: Record<string, unknown>) => {
            const recordId = getValue(record, entity.primaryIdAttribute);
            return recordId ? [makeArtifact(record, recordId, entity, attributes, organizationUrl)] : [];
          });
          artifacts.push(...candidates);
          logDiagnostic({
            level: "info", phase, entity: entity.logicalName, ...diagnosticContext, query: fetchXml,
            message: `Purpose relationship query returned ${candidates.length} candidate(s).`,
            rawResult: { targetParentArtifactId: parent.id, targetParentRecordId: parent.recordId, candidateCount: candidates.length },
          });
          return;
        }

        const lookup = (expectedLookup
          ? attributes.find((attribute) => attribute.logicalName.toLowerCase() === expectedLookup.toLowerCase())
          : undefined) ?? attributes.find((attribute) => attribute.targets.some((target) => target.toLowerCase() === (parent?.logicalName ?? "").toLowerCase()));
        if (!parent || !lookup) {
          logDiagnostic({
            level: "warning", phase, entity: sourceArtifact.logicalName, ...diagnosticContext,
            message: `Skipped target candidate query for ${sourceArtifact.displayName}: ${!parent ? `target ${parentKind} is not resolved` : `parent lookup ${expectedLookup ?? `to ${parent.logicalName}`} was not found in metadata`}.`,
            rawResult: {
              sourceParentArtifactId: sourceParent?.id,
              sourceParentRecordId: sourceParent?.recordId,
              targetParentArtifactId: parent?.id,
              targetParentRecordId: parent?.recordId,
              expectedParentLookup: expectedLookup,
              availableTargetParentSourceIds: [...matchedParents.keys()],
            },
          });
          return;
        }

        const parentIdAttribute = parent.primaryIdAttribute ?? `${parent.logicalName}id`;
        filters.push(navigationProperty
          ? `${navigationProperty}/${parentIdAttribute} eq ${parent.recordId}`
          : `_${lookup.logicalName}_value eq ${parent.recordId}`);
        const lookupColumn = `_${lookup.logicalName}_value`;
        if (!columns.includes(lookupColumn)) columns.push(lookupColumn);
      }

      const filterQuery = filters.length ? `&$filter=${encodeURIComponent(filters.join(" and "))}` : "";
      const query = `${entity.entitySetName}?$select=${columns.map(encodeURIComponent).join(",")}${filterQuery}&$top=500`;
      logDiagnostic({
        level: "info", phase, entity: entity.logicalName, ...diagnosticContext, query,
        message: "Querying target candidate records.",
        rawResult: {
          sourceArtifactId: sourceArtifact.id,
          kind: sourceArtifact.kind,
          targetParentArtifactId: parent?.id,
          targetParentRecordId: parent?.recordId,
          parentLookup: parentKind ? getParentLookupField(sourceArtifact.kind) : undefined,
          parentNavigationProperty: parentKind ? getParentNavigationProperty(sourceArtifact.kind) : undefined,
        },
      });
      const records = await queryAll(query, warnings, phase, entity.logicalName, connectionTarget, diagnosticContext);
      const candidates = records.flatMap((record) => {
        const recordId = getValue(record, entity.primaryIdAttribute);
        return recordId ? [makeArtifact(record, recordId, entity, attributes, organizationUrl)] : [];
      });

      if (!parentKind) {
        matchedParents.set(sourceArtifact.id, candidates[0] ?? {
          id: sourceArtifact.id,
          kind: sourceArtifact.kind,
          logicalName: sourceArtifact.logicalName,
          entitySetName: sourceArtifact.entitySetName,
          recordId: sourceArtifact.recordId,
          displayName: sourceArtifact.displayName,
          sourceRecord: sourceArtifact.sourceRecord,
          warnings: [],
        });
      }
      artifacts.push(...candidates);
      logDiagnostic({
        level: "info", phase, entity: entity.logicalName, ...diagnosticContext, query,
        message: `Target candidate query returned ${records.length} record(s).`,
        rawResult: { candidateCount: records.length },
      });
    } catch (error) {
      logDiagnostic({ level: "error", phase, entity: sourceArtifact.logicalName, ...diagnosticContext, message: "Failed querying target candidates.", error });
      warnings.push(`Could not query target ${entity.displayName} by name: ${errorMessage(error)}`);
    }
  };

  // Parent rows must finish first so child queries can filter by target parent IDs.
  const maxDepth = Math.max(0, ...ordered.map((artifact) => artifactDepth(artifact.kind)));
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    await Promise.all(ordered.filter((artifact) => artifactDepth(artifact.kind) === depth).map(queryArtifact));
  }

  const root = artifacts[0] ?? {
    id: "target-artifact-match",
    kind: "unknown" as const,
    logicalName: "",
    entitySetName: "",
    recordId: "",
    displayName: "Target artifact matches",
    sourceRecord: {},
    warnings: [],
  };
  return { root, artifacts, dependencies: [], warnings, discoveredAt: new Date().toISOString() };
}

function makeArtifact(
  record: Record<string, unknown>,
  recordId: string,
  entity: Awaited<ReturnType<typeof getEntityCatalog>>[number],
  attributes: AttributeInfo[],
  organizationUrl: string,
): Artifact {
  return {
    id: `${entity.logicalName.toLowerCase()}:${recordId.toLowerCase()}`,
    kind: entity.kind,
    logicalName: entity.logicalName,
    entitySetName: entity.entitySetName,
    primaryIdAttribute: entity.primaryIdAttribute,
    primaryNameAttribute: entity.primaryNameAttribute,
    recordId,
    displayName: recordDisplayName(record, entity, attributes),
    entityDisplayName: entity.displayName,
    state: getValue(record, "statecode"),
    status: getValue(record, "statuscode"),
    dataverseUrl: createRecordUrl(organizationUrl, entity.logicalName, recordId),
    sourceRecord: record,
    warnings: [],
  };
}
