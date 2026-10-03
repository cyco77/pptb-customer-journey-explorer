import type {
  Artifact,
  ArtifactKind,
  AttributeInfo,
  Dependency,
  DiscoveryResult,
  EntityInfo,
  JourneyOption,
} from "./types";
import { createRecordUrl } from "./dataverseLinks";
import { logDiagnostic } from "./diagnostics";
import { extractJourneyDefinitionReferences, journeyReferenceKind, owningJourneyNode } from "./journeyDefinition";
import { ARTIFACT_DEFINITIONS, getArtifactDefinition, getParentKind, isSupportedArtifactKind, JSON_REFERENCE_FIELDS, UNCLASSIFIED_ENTITY_PATTERN, UNSUPPORTED_ARTIFACT_ENTITY_PATTERN } from "./artifactCatalog";

const PAGE_SIZE = 100;
const MAX_ARTIFACTS = 250;
const MAX_DEPTH = 5;
const GUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
export type ConnectionTarget = "primary" | "secondary";

export { validateArtifactCatalog } from "./artifactCatalog";

const getDisplayName = (metadata: DataverseAPI.EntityMetadata): string =>
  localizedMetadataLabel(metadata.DisplayName) ?? metadata.LogicalName;

const metadataCatalogCache = new Map<ConnectionTarget, Map<string, EntityInfo>>();
const SYSTEM_DISPLAY_ALIAS = /^(?:ownerid|createdby|modifiedby|createdonbehalfby|modifiedonbehalfby|owningteam|owningbusinessunit)(?:yomi)?name$/i;

function isJourneyListingEntity(entity: EntityInfo): boolean {
  const logicalName = entity.logicalName.toLowerCase();
  const displayName = entity.displayName.trim().toLowerCase();
  if (/analytics|contactrecord|interaction|tracking|telemetry|instance|event|log|legacy|msdyncrm_/.test(logicalName)) {
    return false;
  }
  return getArtifactDefinition(entity.kind).journeyListing === true && (
    /^(?:msdynmkt_)?(?:customer_)?journey$/.test(logicalName) || ["journey", "customer journey"].includes(displayName)
  );
}

function isSupportedArtifactEntity(entity: EntityInfo): boolean {
  const logicalName = entity.logicalName.toLowerCase();
  if (!logicalName.startsWith("msdynmkt_")) return false;
  if (UNSUPPORTED_ARTIFACT_ENTITY_PATTERN.test(logicalName)) return false;
  return isSupportedArtifactKind(entity.kind);
}

function classifyEntity(logicalName: string, displayName: string): { kind: ArtifactKind; score: number } | undefined {
  const logical = logicalName.toLowerCase();
  const display = displayName.toLowerCase();
  if (UNCLASSIFIED_ENTITY_PATTERN.test(logical)) {
    return undefined;
  }
  const combined = `${logical} ${display}`;
  for (const definition of ARTIFACT_DEFINITIONS) {
    const { kind, terms } = definition;
    if (!terms?.length) continue;
    if (definition.journeyActionEntity && !/(journeyaction|journey_action|journey action|journeystep|journey_step)/.test(combined)) continue;
    if (definition.triggerEntity && !(
      /trigger|eventdefinition|eventmetadata|customevent/.test(logical) ||
      /trigger|event definition|event metadata|custom event/.test(display)
    )) continue;
    if (definition.exactJourneyEntity && !(
      /^(?:msdynmkt_)?(?:customer_)?journey$/.test(logical) ||
      ["journey", "customer journey"].includes(display)
    )) continue;
    const matchingTerm = terms.find((term) => combined.includes(term));
    if (matchingTerm) {
      const score = kind === "journey"
        ? (logical.includes("journey") ? 100 : 85)
        : logical.startsWith("msdynmkt_") ? 80 : 60;
      return { kind, score };
    }
  }
  return undefined;
}

async function queryWithDiagnostics(
  query: string,
  phase: string,
  entity: string,
  connectionTarget: ConnectionTarget,
  diagnosticContext?: { sourceArtifactId?: string; sourceDisplayName?: string },
  retried = false,
): Promise<{ value: Record<string, unknown>[]; "@odata.nextLink"?: string }> {
  if (connectionTarget === "secondary" && /^(?:target-artifact-catalog|target-artifact-match|manual-mapping-candidates|lookup-target-read|related-record-query|journey-root-read|journey-payload-read|journey-trigger-read|journey-trigger-catalog)$/.test(phase)) {
    logDiagnostic({
      level: "info",
      phase: `${phase}-query`,
      entity,
      query,
      ...diagnosticContext,
      message: diagnosticContext?.sourceDisplayName
        ? `Loading target candidates for ${diagnosticContext.sourceDisplayName}`
        : `Loading target migration artifact data for ${entity}`,
    });
  }
  try {
    const response = await window.dataverseAPI.queryData(query, connectionTarget) as {
      value: Record<string, unknown>[];
      "@odata.nextLink"?: string;
    };
    if (connectionTarget === "secondary" && /^(?:target-artifact-catalog|target-artifact-match|manual-mapping-candidates|lookup-target-read|related-record-query|journey-root-read|journey-payload-read|journey-trigger-read|journey-trigger-catalog)$/.test(phase)) {
      logDiagnostic({
        level: "info",
        phase: `${phase}-result`,
        entity,
        query,
        rawResult: response,
        ...diagnosticContext,
        message: diagnosticContext?.sourceDisplayName
          ? `Target query result for ${diagnosticContext.sourceDisplayName}`
          : `Raw target query result for ${entity}`,
      });
    }
    return response;
  } catch (error) {
    const missingProperty = !retried && error instanceof Error
      ? error.message.match(/Could not find a property named ['"]([^'"]+)['"]/i)?.[1]
      : undefined;
    if (missingProperty) {
      const selectMatch = query.match(/([?&]\$select=)([^&]*)/i);
      if (selectMatch) {
        const columns = selectMatch[2].split(",").filter((column) => {
          try {
            return decodeURIComponent(column).toLowerCase() !== missingProperty.toLowerCase();
          } catch {
            return column.toLowerCase() !== missingProperty.toLowerCase();
          }
        });
        const retryQuery = `${query.slice(0, selectMatch.index!)}${selectMatch[1]}${columns.join(",")}${query.slice(selectMatch.index! + selectMatch[0].length)}`;
        logDiagnostic({ level: "warning", phase: `${phase}-column-fallback`, entity, query, ...diagnosticContext, message: `Retrying ${entity} without unsupported column ${missingProperty}`, error });
        return queryWithDiagnostics(retryQuery, phase, entity, connectionTarget, diagnosticContext, true);
      }
    }
    logDiagnostic({
      level: "error",
      phase,
      entity,
      query,
      ...diagnosticContext,
      message: `Dataverse queryData failed for ${entity}`,
      error,
    });
    throw error;
  }
}

export async function queryAll(query: string, warnings?: string[], phase = "dependency-query", entity = "unknown", connectionTarget: ConnectionTarget = "primary", diagnosticContext?: { sourceArtifactId?: string; sourceDisplayName?: string }): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let nextQuery: string | undefined = query;
  const queriedPages = new Set<string>();
  while (nextQuery) {
    if (queriedPages.has(nextQuery)) {
      warnings?.push(`The ${entity} query returned a repeated page link; pagination stopped to avoid an infinite loop.`);
      break;
    }
    queriedPages.add(nextQuery);
    const response = await queryWithDiagnostics(nextQuery, phase, entity, connectionTarget, diagnosticContext);
    records.push(...response.value);
    const nextLink = response["@odata.nextLink"];
    if (!nextLink) break;
    const nextUrl = new URL(nextLink, "https://dataverse.invalid");
    nextQuery = `${nextUrl.pathname.replace(/^\/api\/data\/v\d+\.\d+\//, "")}${nextUrl.search}`;
  }
  return records;
}

async function queryRecord(
  entity: EntityInfo,
  recordId: string,
  _columns: string[],
  phase: string,
  connectionTarget: ConnectionTarget,
): Promise<Record<string, unknown> | undefined> {
  // Dataverse returns all readable columns when $select is omitted. Keep the
  // key filter narrow, but preserve the full row as the migration source.
  const query = `${entity.entitySetName}?$filter=${entity.primaryIdAttribute} eq ${recordId}&$top=1`;
  const results = await queryAll(query, undefined, phase, entity.logicalName, connectionTarget);
  return results[0];
}

export async function getEntityCatalog(connectionTarget: ConnectionTarget = "primary"): Promise<EntityInfo[]> {
  let response: { value: DataverseAPI.EntityMetadata[] };
  try {
    response = await window.dataverseAPI.getAllEntitiesMetadata(
      ["LogicalName", "DisplayName", "EntitySetName", "PrimaryIdAttribute", "PrimaryNameAttribute"],
      connectionTarget,
    );
  } catch (error) {
    logDiagnostic({ level: "error", phase: "entity-catalog", message: "Failed to read Dataverse entity metadata", error });
    throw error;
  }
  const metadataRecords = response.value as DataverseAPI.EntityMetadata[];
  const allEntities = metadataRecords.flatMap((metadata: DataverseAPI.EntityMetadata) => {
    const logicalName = metadata.LogicalName;
    const displayName = getDisplayName(metadata);
    const classified = classifyEntity(logicalName, displayName);
    const entitySetName = typeof metadata.EntitySetName === "string" ? metadata.EntitySetName : "";
    const primaryIdAttribute = typeof metadata.PrimaryIdAttribute === "string" ? metadata.PrimaryIdAttribute : "";
    if (!entitySetName || !primaryIdAttribute) return [];
    return [{
      logicalName,
      entitySetName,
      primaryIdAttribute,
       primaryNameAttribute: typeof metadata.PrimaryNameAttribute === "string" ? metadata.PrimaryNameAttribute : undefined,
       canCreate: true,
      displayName,
      ...(classified ?? { kind: "unknown" as const, score: 0 }),
    }];
  });
  const catalogCache = new Map<string, EntityInfo>();
  for (const entity of allEntities) catalogCache.set(entity.logicalName.toLowerCase(), entity);
  metadataCatalogCache.set(connectionTarget, catalogCache);
  return allEntities.filter(isSupportedArtifactEntity);
}

export async function getAttributes(entity: EntityInfo, connectionTarget: ConnectionTarget = "primary"): Promise<AttributeInfo[]> {
  let attributeResponse: { value: Record<string, unknown>[] };
  let relationshipResponse: { value: Record<string, unknown>[] };
  try {
    [attributeResponse, relationshipResponse] = await Promise.all([
      window.dataverseAPI.getEntityRelatedMetadata(
      entity.logicalName,
      "Attributes",
       ["LogicalName", "DisplayName", "AttributeType", "IsValidForRead", "IsValidForCreate", "RequiredLevel"],
      connectionTarget,
      ),
      window.dataverseAPI.getEntityRelatedMetadata(
      entity.logicalName,
      "ManyToOneRelationships",
      ["ReferencingAttribute", "ReferencedEntity"],
      connectionTarget,
      ),
    ]) as [
      { value: Record<string, unknown>[] },
      { value: Record<string, unknown>[] },
    ];
  } catch (error) {
    logDiagnostic({
      level: "error",
      phase: "attribute-metadata",
      entity: entity.logicalName,
      message: `Failed to read field/lookup metadata for ${entity.logicalName}`,
      error,
    });
    try {
      attributeResponse = await window.dataverseAPI.getEntityRelatedMetadata(
        entity.logicalName,
        "Attributes",
        ["LogicalName", "DisplayName", "AttributeType", "IsValidForRead", "IsValidForCreate", "RequiredLevel"],
        connectionTarget,
      ) as { value: Record<string, unknown>[] };
      relationshipResponse = { value: [] };
      logDiagnostic({ level: "warning", phase: "relationship-metadata-fallback", entity: entity.logicalName, message: `Using attribute metadata without relationship metadata for ${entity.logicalName}` });
    } catch (attributeError) {
      logDiagnostic({ level: "error", phase: "attribute-metadata-fallback", entity: entity.logicalName, message: `Failed to read attribute metadata for ${entity.logicalName}`, error: attributeError });
      throw attributeError;
    }
  }
  const relationshipRecords = relationshipResponse.value as Array<Record<string, unknown>>;
  const targetsByAttribute = new Map<string, Set<string>>();
  for (const relationship of relationshipRecords) {
    const attributeName = typeof relationship.ReferencingAttribute === "string"
      ? relationship.ReferencingAttribute.toLowerCase()
      : "";
    const targetName = typeof relationship.ReferencedEntity === "string"
      ? relationship.ReferencedEntity
      : "";
    if (!attributeName || !targetName) continue;
    const targets = targetsByAttribute.get(attributeName) ?? new Set<string>();
    targets.add(targetName);
    targetsByAttribute.set(attributeName, targets);
  }

  const attributeRecords = attributeResponse.value as Array<Record<string, unknown>>;
  return attributeRecords.flatMap((attribute: Record<string, unknown>) => {
    const logicalName = typeof attribute.LogicalName === "string" ? attribute.LogicalName : "";
    const isStateAttribute = /^(statecode|statuscode)$/i.test(logicalName);
    if (!logicalName || (attribute.IsValidForRead === false && !isStateAttribute)) return [];
    const display = localizedMetadataLabel(attribute.DisplayName);
    return [{
      logicalName,
      displayName: display ?? logicalName,
       attributeType: typeof attribute.AttributeType === "string" ? attribute.AttributeType : undefined,
       targets: [...(targetsByAttribute.get(logicalName.toLowerCase()) ?? [])],
       isValidForCreate: attribute.IsValidForCreate !== false,
       requiredLevel: typeof attribute.RequiredLevel === "string"
         ? attribute.RequiredLevel
         : attribute.RequiredLevel && typeof attribute.RequiredLevel === "object" && typeof (attribute.RequiredLevel as Record<string, unknown>).Value === "string"
           ? (attribute.RequiredLevel as Record<string, unknown>).Value as string
           : undefined,
    }];
  });
}

function localizedMetadataLabel(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const label = value as {
    UserLocalizedLabel?: { Label?: unknown };
    LocalizedLabels?: Array<{ Label?: unknown }>;
  };
  if (typeof label.UserLocalizedLabel?.Label === "string" && label.UserLocalizedLabel.Label) {
    return label.UserLocalizedLabel.Label;
  }
  return label.LocalizedLabels?.find((entry) => typeof entry.Label === "string" && entry.Label)?.Label as string | undefined;
}

async function getOptionLabels(entity: EntityInfo, attributeName: string, connectionTarget: ConnectionTarget = "primary"): Promise<Record<string, string>> {
  try {
    const metadata = await window.dataverseAPI.getEntityRelatedMetadata(
      entity.logicalName,
      `Attributes(LogicalName='${attributeName}')`,
      undefined,
      connectionTarget,
    ) as Record<string, unknown>;
    // StateAttributeMetadata and StatusAttributeMetadata both expose their
    // localized options through the OptionSet property. StatusOptionSet is
    // the metadata type, not the property name.
    const optionSet = metadata.OptionSet ?? metadata;
    const options = optionSet && typeof optionSet === "object" && Array.isArray((optionSet as Record<string, unknown>).Options)
      ? (optionSet as Record<string, unknown>).Options as unknown[]
      : [];
    if (options.length === 0) return {};
    return Object.fromEntries(options.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const item = option as Record<string, unknown>;
      const value = item.Value;
      const label = localizedMetadataLabel(item.Label) ?? (item.Label && typeof item.Label === "object" && Array.isArray((item.Label as Record<string, unknown>).LocalizedLabels)
        ? ((item.Label as Record<string, unknown>).LocalizedLabels as unknown[]).map(localizedMetadataLabel).find((entry): entry is string => Boolean(entry))
        : undefined);
      return (typeof value === "number" || typeof value === "string") && label
        ? [[String(value), label]]
        : [];
    }));
  } catch (error) {
    logDiagnostic({ level: "warning", phase: "status-option-metadata", entity: entity.logicalName, message: `Could not load ${attributeName} labels for ${entity.logicalName}`, error });
    return {};
  }
}

export async function getStatusLabels(entity: EntityInfo, connectionTarget: ConnectionTarget = "primary", attributes?: AttributeInfo[]): Promise<{ state: Record<string, string>; status: Record<string, string> }> {
  const readable = new Set((attributes ?? []).map((attribute) => attribute.logicalName.toLowerCase()));
  const [state, status] = await Promise.all([
    readable.size === 0 || readable.has("statecode") ? getOptionLabels(entity, "statecode", connectionTarget) : Promise.resolve({}),
    readable.size === 0 || readable.has("statuscode") ? getOptionLabels(entity, "statuscode", connectionTarget) : Promise.resolve({}),
  ]);
  return { state, status };
}

async function getRecordOptionSetLabels(
  entity: EntityInfo,
  attributes: AttributeInfo[],
  record: Record<string, unknown>,
  connectionTarget: ConnectionTarget,
  cache: Map<string, Promise<Record<string, string>>>,
): Promise<Record<string, Record<string, string>>> {
  const optionAttributes = attributes.filter((attribute) =>
    ["Picklist", "State", "Status", "Boolean", "MultiSelectPicklist"].includes(attribute.attributeType ?? "") &&
    typeof record[attribute.logicalName] === "number",
  );
  const entries = await Promise.all(optionAttributes.map(async (attribute) => {
    const key = `${entity.logicalName.toLowerCase()}|${attribute.logicalName.toLowerCase()}`;
    const labelsPromise = cache.get(key) ?? getOptionLabels(entity, attribute.logicalName, connectionTarget);
    cache.set(key, labelsPromise);
    return [attribute.logicalName.toLowerCase(), await labelsPromise] as const;
  }));
  return Object.fromEntries(entries.filter(([, labels]) => Object.keys(labels).length > 0));
}

export function selectedColumns(entity: EntityInfo, attributes: AttributeInfo[], connectionTarget: ConnectionTarget = "primary"): string[] {
  const columns = new Set<string>([entity.primaryIdAttribute]);
  if (entity.primaryNameAttribute && !SYSTEM_DISPLAY_ALIAS.test(entity.primaryNameAttribute)) {
    columns.add(entity.primaryNameAttribute);
  }
  // Keep Dataverse state and status reason values available in details for
  // every supported artifact table, even when they aren't part of the display
  // field/payload heuristics below.
  const stateAndStatus = new Set(
    attributes
      .filter((attribute) => /^(statecode|statuscode)$/i.test(attribute.logicalName))
      .map((attribute) => attribute.logicalName),
  );
  for (const attribute of stateAndStatus) columns.add(attribute);
  for (const attribute of attributes) {
    const name = attribute.logicalName.toLowerCase();
    // Dataverse metadata can expose polymorphic lookup helper names such as
    // owneridtype. They are not readable Web API properties on every table.
    if (/^(?:owner|createdby|modifiedby|owningteam|owningbusinessunit)idtype$/i.test(name)) continue;
    // These are lookup display aliases exposed by some metadata responses,
    // not readable attributes on the entity itself.
    if (SYSTEM_DISPLAY_ALIAS.test(name)) continue;
    const isSupportedLookup = attribute.targets.some((target) => {
      const targetEntity = metadataCatalogCache.get(connectionTarget)?.get(target.toLowerCase());
      return targetEntity ? isSupportedArtifactEntity(targetEntity) : false;
    });
    const isDisplayAlias = /(?:name|yominame)$/.test(name) && attribute.logicalName !== entity.primaryNameAttribute;
    const isJourneyDefinitionField = entity.kind === "journey" && (
      name === "msdynmkt_journeyjson" ||
      /journey.*(definition|json|data|content|workflow|configuration|config)|^(msdynmkt_)?definition$/.test(name)
    );
    const isKnownPayload = isJourneyDefinitionField || (
      /(journey.*json|definition|json|content|trigger|segment|email|form|channel|workflow|html|subject|unique(name)?)/.test(name) &&
      ["Memo", "String", "Virtual"].includes(attribute.attributeType ?? "")
    );
    const isStableSystemColumn = ["statecode", "statuscode"].includes(name);
    const isRequiredForCreate = attribute.isValidForCreate !== false && /required/i.test(attribute.requiredLevel ?? "");
    if (isDisplayAlias) continue;
    if (
      isSupportedLookup ||
      isStableSystemColumn ||
       isKnownPayload || isRequiredForCreate
    ) {
      columns.add(isSupportedLookup ? `_${attribute.logicalName}_value` : attribute.logicalName);
    }
  }
  return [...columns];
}

export function queryableColumns(columns: string[]): string[] {
  return [...new Set(columns)].filter((column) =>
    !SYSTEM_DISPLAY_ALIAS.test(column),
  );
}

export function getValue(record: Record<string, unknown>, ...keys: Array<string | undefined>): string | undefined {
  for (const key of keys) {
    if (key && (typeof record[key] === "string" || typeof record[key] === "number")) {
      return String(record[key]);
    }
  }
  return undefined;
}

function toJourneyOption(entity: EntityInfo, record: Record<string, unknown>): JourneyOption | undefined {
  const id = getValue(record, entity.primaryIdAttribute);
  if (!id) return undefined;
  return {
    id,
    logicalName: entity.logicalName,
    entitySetName: entity.entitySetName,
    primaryNameAttribute: entity.primaryNameAttribute,
    name: getValue(record, entity.primaryNameAttribute, "name", "msdynmkt_name", "subject") ?? `${entity.displayName} ${id.slice(0, 8)}`,
    state: getValue(record, "statecode"),
    status: getValue(record, "statuscode"),
    version: getValue(record, "versionnumber", "msdynmkt_versionnumber"),
    modifiedOn: getValue(record, "modifiedon"),
    record,
  };
}

export async function loadJourneys(connectionTarget: ConnectionTarget = "primary"): Promise<{ journeys: JourneyOption[]; warnings: string[] }> {
  const catalog = await getEntityCatalog(connectionTarget);
  const journeyEntities = catalog.filter(isJourneyListingEntity);
  const journeys: JourneyOption[] = [];
  const warnings: string[] = [];
  if (journeyEntities.length === 0) {
    return { journeys, warnings: ["No Journey tables were found in the Dataverse metadata for this environment."] };
  }
  for (const entity of journeyEntities) {
    try {
      const columns = [...new Set([
        entity.primaryIdAttribute,
        entity.primaryNameAttribute,
        "statuscode",
        "statecode",
      ].filter((column): column is string => Boolean(column)))];
      const filter = entity.logicalName.toLowerCase() === "msdynmkt_journey"
        ? "&$filter=msdynmkt_issupersededbylaterversion ne true"
        : "";
      let records: Record<string, unknown>[];
      try {
        const query = `${entity.entitySetName}?$select=${columns.map(encodeURIComponent).join(",")}${filter}&$top=${PAGE_SIZE}`;
        records = await queryAll(query, warnings, "journey-list", entity.logicalName, connectionTarget);
      } catch (error) {
        if (!entity.primaryNameAttribute) throw error;
        warnings.push(`Could not read the name field for ${entity.displayName}; loading IDs as a fallback.`);
        logDiagnostic({ level: "warning", phase: "journey-list-fallback", entity: entity.logicalName, message: "Journey list query failed with primary name column; retrying IDs only", error });
        const query = `${entity.entitySetName}?$select=${encodeURIComponent(entity.primaryIdAttribute)}&$top=${PAGE_SIZE}`;
        records = await queryAll(query, warnings, "journey-list-fallback", entity.logicalName, connectionTarget);
      }
        const journeyStatusLabels = await getStatusLabels(entity, connectionTarget, await getAttributes(entity, connectionTarget));
        journeys.push(...records.flatMap((record) => {
          const option = toJourneyOption(entity, record);
          if (!option) return [];
          const statusCode = getValue(record, "statuscode");
          const stateCode = getValue(record, "statecode");
          option.statusDisplay = getValue(record, "statuscode@OData.Community.Display.V1.FormattedValue") ??
            (statusCode ? journeyStatusLabels.status[statusCode] ?? statusCode : undefined);
          option.stateDisplay = getValue(record, "statecode@OData.Community.Display.V1.FormattedValue") ??
            (stateCode ? journeyStatusLabels.state[stateCode] ?? stateCode : undefined);
          option.stateLabels = journeyStatusLabels.state;
          option.statusLabels = journeyStatusLabels.status;
          return [option];
        }));
    } catch (error) {
      logDiagnostic({ level: "error", phase: "journey-list", entity: entity.logicalName, message: `Failed to load Journey rows for ${entity.logicalName}`, error });
      warnings.push(`Could not read Journey table ${entity.displayName} (${entity.logicalName}): ${errorMessage(error)}`);
    }
  }
  journeys.sort((left, right) => (right.modifiedOn ?? "").localeCompare(left.modifiedOn ?? "") || left.name.localeCompare(right.name));
  return { journeys, warnings };
}

/** Loads a bounded catalog of supported artifacts without requiring a Journey root. */
export async function discoverSupportedArtifacts(
  organizationUrl: string,
  connectionTarget: ConnectionTarget = "primary",
): Promise<DiscoveryResult> {
  const catalog = await getEntityCatalog(connectionTarget);
  const artifacts: Artifact[] = [];
  const warnings: string[] = [];

  for (const entity of catalog) {
    if (entity.kind === "journey" || entity.kind === "unknown") continue;
    try {
      const attributes = await getAttributes(entity, connectionTarget);
      const columns = selectedColumns(entity, attributes, connectionTarget);
      const records = await queryAll(
        `${entity.entitySetName}?$select=${columns.map(encodeURIComponent).join(",")}&$top=${PAGE_SIZE}`,
        warnings,
        "target-artifact-catalog",
        entity.logicalName,
        connectionTarget,
      );
      const statusLabels = await getStatusLabels(entity, connectionTarget, attributes);
      const fieldDisplayNames = Object.fromEntries(attributes.map((attribute) => [attribute.logicalName.toLowerCase(), attribute.displayName]));
      const fieldTypes = Object.fromEntries(attributes.flatMap((attribute) => attribute.attributeType
        ? [[attribute.logicalName.toLowerCase(), attribute.attributeType] as const]
        : []));

      for (const record of records) {
        const recordId = getValue(record, entity.primaryIdAttribute);
        if (!recordId) continue;
        artifacts.push({
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
          stateLabels: statusLabels.state,
          statusLabels: statusLabels.status,
          fieldDisplayNames,
          fieldTypes,
          dataverseUrl: createRecordUrl(organizationUrl, entity.logicalName, recordId),
          sourceRecord: record,
          warnings: [],
        });
      }
    } catch (error) {
      warnings.push(`Could not read target ${entity.displayName} (${entity.logicalName}): ${errorMessage(error)}`);
    }
  }

  const root = artifacts[0] ?? {
    id: "target-catalog",
    kind: "unknown" as const,
    logicalName: "",
    entitySetName: "",
    recordId: "",
    displayName: "Target artifact catalog",
    sourceRecord: {},
    warnings: [],
  };
  return { root, artifacts, dependencies: [], warnings, discoveredAt: new Date().toISOString() };
}

export function artifactDepth(kind: ArtifactKind): number {
  const parent = getParentKind(kind);
  return parent ? 1 + artifactDepth(parent) : 0;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordDisplayName(record: Record<string, unknown>, entity: EntityInfo, attributes: AttributeInfo[]): string {
  const candidates = [entity.primaryNameAttribute, "name", "msdynmkt_name", "subject", "title", "fullname"];
  const known = new Set(attributes.map((attribute) => attribute.logicalName));
  for (const key of candidates) {
    if (key && known.has(key) && typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  for (const [key, value] of Object.entries(record)) {
    if (/(name|subject|title)$/i.test(key) && typeof value === "string" && value.trim()) return value;
  }
  return `${entity.displayName} ${getValue(record, entity.primaryIdAttribute)?.slice(0, 8) ?? ""}`.trim();
}

function extractJsonGuids(value: unknown, path = ""): Array<{ id: string; path: string }> {
  if (typeof value === "string") {
    return [...value.matchAll(GUID_PATTERN)].map((match) => ({ id: match[0], path }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => extractJsonGuids(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => extractJsonGuids(child, path ? `${path}.${key}` : key));
  }
  return [];
}

function parseEmbeddedJson(value: unknown): unknown[] {
  if (typeof value !== "string" || value.length < 2) return [];
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return [];
  try {
    return [JSON.parse(trimmed) as unknown];
  } catch {
    return [];
  }
}

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

export async function discoverJourney(
  journey: JourneyOption,
  organizationUrl: string,
  connectionTarget: ConnectionTarget = "primary",
): Promise<DiscoveryResult> {
  const catalog = await getEntityCatalog(connectionTarget);
  const entityByName = new Map(catalog.map((entity) => [entity.logicalName.toLowerCase(), entity]));
  const attributesByEntity = new Map<string, AttributeInfo[]>();
  const statusLabelsByEntity = new Map<string, { state: Record<string, string>; status: Record<string, string> }>();
  const optionLabelsByAttribute = new Map<string, Promise<Record<string, string>>>();
  const childRelationshipsByEntity = new Map<string, Array<Record<string, unknown>>>();
  const warnings: string[] = [];
  const artifactByKey = new Map<string, Artifact>();
  const dependencies: Dependency[] = [];
  const processed = new Set<string>();
  const queue: Array<{ entity: EntityInfo; record: Record<string, unknown>; depth: number; parentId?: string; relation?: Dependency["relationType"]; label?: string; path?: string }> = [];

  const cacheAttributes = async (entity: EntityInfo): Promise<AttributeInfo[]> => {
    const existing = attributesByEntity.get(entity.logicalName.toLowerCase());
    if (existing) return existing;
    const attributes = await getAttributes(entity, connectionTarget);
    attributesByEntity.set(entity.logicalName.toLowerCase(), attributes);
    return attributes;
  };

  const cacheStatusLabels = async (entity: EntityInfo) => {
    const key = entity.logicalName.toLowerCase();
    const existing = statusLabelsByEntity.get(key);
    if (existing) return existing;
    const labels = await getStatusLabels(entity, connectionTarget, await cacheAttributes(entity));
    statusLabelsByEntity.set(key, labels);
    return labels;
  };

  const cacheRecordOptionLabels = async (entity: EntityInfo, attributes: AttributeInfo[], record: Record<string, unknown>) => {
    return getRecordOptionSetLabels(entity, attributes, record, connectionTarget, optionLabelsByAttribute);
  };

  const conditionOptionLabels = async (record: Record<string, unknown>): Promise<Record<string, string>> => {
    const labels: Record<string, string> = {};
    const bindings: Array<{ entityName: string; fieldName: string }> = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      const item = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
      if (!item) return;
      const binding = item.binding && typeof item.binding === "object" ? item.binding as Record<string, unknown> : undefined;
      const inputs = binding?.inputs && typeof binding.inputs === "object" ? binding.inputs as Record<string, unknown> : undefined;
      const sourceType = inputs?.sourceType && typeof inputs.sourceType === "object" ? (inputs.sourceType as Record<string, unknown>).value : undefined;
      if (typeof sourceType === "string" && typeof binding?.outputPath === "string") bindings.push({ entityName: sourceType, fieldName: binding.outputPath });
      Object.values(item).forEach(visit);
    };
    visit(record);
    for (const { entityName, fieldName } of bindings) {
      const entity = entityByName.get(entityName.toLowerCase());
      if (!entity) continue;
        const optionLabels = await getOptionLabels(entity, fieldName, connectionTarget);
      Object.assign(labels, optionLabels);
    }
    return labels;
  };

  const cacheChildRelationships = async (entity: EntityInfo): Promise<Array<Record<string, unknown>>> => {
    const key = entity.logicalName.toLowerCase();
    const existing = childRelationshipsByEntity.get(key);
    if (existing) return existing;
    let response: { value: Record<string, unknown>[] };
    try {
      response = await window.dataverseAPI.getEntityRelatedMetadata(
        entity.logicalName,
        "OneToManyRelationships",
        ["ReferencedEntity", "ReferencingEntity", "ReferencingAttribute", "SchemaName"],
        connectionTarget,
      ) as { value: Record<string, unknown>[] };
    } catch (error) {
      logDiagnostic({ level: "warning", phase: "child-relationship-metadata", entity: entity.logicalName, message: `Could not read child relationship metadata for ${entity.logicalName}; continuing without child relationship expansion`, error });
      response = { value: [] };
    }
    const relationships = response.value as Array<Record<string, unknown>>;
    childRelationshipsByEntity.set(key, relationships);
    return relationships;
  };

  const rootEntity = entityByName.get(journey.logicalName.toLowerCase());
  if (!rootEntity) throw new Error("The selected Journey table is no longer available in the metadata.");
  const rootAttributes = await cacheAttributes(rootEntity);
  const rootColumns = selectedColumns(rootEntity, rootAttributes, connectionTarget);
  const rootPayloadAttributes = rootAttributes.filter((attribute) => {
    const name = attribute.logicalName.toLowerCase();
    return /journey.*(definition|json|data|content|workflow|configuration|config)|^(msdynmkt_)?definition$/.test(name);
  });
  for (const payload of rootPayloadAttributes) rootColumns.push(payload.logicalName);
  let rootRecord: Record<string, unknown>;
  try {
      rootRecord = await queryRecord(rootEntity, journey.id, rootColumns, "journey-root-read", connectionTarget) ?? journey.record;
  } catch (error) {
    logDiagnostic({ level: "warning", phase: "journey-root-read", entity: rootEntity.logicalName, message: "Could not re-read selected Journey; using list row", error });
    rootRecord = journey.record;
  }
  for (const payload of rootPayloadAttributes) {
    if (rootRecord[payload.logicalName] !== undefined || journey.record[payload.logicalName] !== undefined) continue;
    try {
        const payloadRecord = await queryRecord(rootEntity, journey.id, [rootEntity.primaryIdAttribute, payload.logicalName], "journey-payload-read", connectionTarget);
      if (payloadRecord?.[payload.logicalName] !== undefined) rootRecord[payload.logicalName] = payloadRecord[payload.logicalName];
    } catch (error) {
      logDiagnostic({ level: "error", phase: "journey-payload-read", entity: rootEntity.logicalName, message: `Failed to read Journey payload field ${payload.logicalName}`, error });
      warnings.push(`Could not read Journey definition ${payload.logicalName}: ${errorMessage(error)}`);
    }
  }
  queue.push({ entity: rootEntity, record: rootRecord, depth: 0 });

  const addDependency = (dependency: Dependency) => {
    if (!dependencies.some((item) => item.id === dependency.id)) dependencies.push(dependency);
  };

  while (queue.length && artifactByKey.size < MAX_ARTIFACTS) {
    const current = queue.shift()!;
    const recordId = getValue(current.record, current.entity.primaryIdAttribute);
    if (!recordId) continue;
    const artifactId = `${current.entity.logicalName.toLowerCase()}:${recordId.toLowerCase()}`;
    if (current.parentId) {
      addDependency({
        id: `${current.parentId}->${artifactId}:${current.relation}:${current.path ?? ""}`,
        sourceArtifactId: current.parentId,
        targetArtifactId: artifactId,
        targetRecordId: recordId,
        targetLogicalName: current.entity.logicalName,
        relationType: current.relation ?? "lookup",
        label: current.label ?? current.entity.displayName,
        path: current.path,
        resolved: true,
        warnings: [],
      });
    }
    if (artifactByKey.has(artifactId)) continue;
    const attributes = await cacheAttributes(current.entity).catch((error) => {
      logDiagnostic({ level: "error", phase: "artifact-attribute-metadata", entity: current.entity.logicalName, message: `Failed to read attributes for ${current.entity.logicalName}; skipping its dependency extraction`, error });
      warnings.push(`Could not read field metadata for ${current.entity.displayName}: ${errorMessage(error)}`);
      return [];
    });
    const statusLabels = await cacheStatusLabels(current.entity);
    const optionSetLabels = await cacheRecordOptionLabels(current.entity, attributes, current.record);
    const fieldDisplayNames = Object.fromEntries(attributes.map((attribute) => [
      attribute.logicalName.toLowerCase(),
      attribute.displayName,
    ]));
    const fieldTypes = Object.fromEntries(attributes.flatMap((attribute) => attribute.attributeType ? [[attribute.logicalName.toLowerCase(), attribute.attributeType] as const] : []));
    const name = recordDisplayName(current.record, current.entity, attributes);
    const artifact: Artifact = {
      id: artifactId,
      kind: current.entity.kind,
      logicalName: current.entity.logicalName,
      entitySetName: current.entity.entitySetName,
      primaryIdAttribute: current.entity.primaryIdAttribute,
      primaryNameAttribute: current.entity.primaryNameAttribute,
      recordId,
      displayName: name,
      entityDisplayName: current.entity.displayName,
      state: getValue(current.record, "statecode"),
      status: getValue(current.record, "statuscode"),
      stateDisplay: getValue(current.record, "statecode@OData.Community.Display.V1.FormattedValue"),
      statusDisplay: getValue(current.record, "statuscode@OData.Community.Display.V1.FormattedValue"),
      stateLabels: statusLabels.state,
      statusLabels: statusLabels.status,
      optionSetLabels,
      fieldDisplayNames,
      fieldTypes,
      version: getValue(current.record, "versionnumber", "msdynmkt_versionnumber"),
      dataverseUrl: createRecordUrl(organizationUrl, current.entity.logicalName, recordId),
      sourceRecord: current.record,
      warnings: [],
      canCreate: current.entity.canCreate,
    };
    if (current.entity.kind === "journey" && !(await cacheChildRelationships(current.entity).catch((error) => {
      logDiagnostic({ level: "warning", phase: "journey-child-relationship-metadata", entity: current.entity.logicalName, message: "Could not load Journey child relationship metadata", error });
      return [];
    })).length) {
      artifact.warnings.push("Journey relationship metadata is unavailable; related Journey records may be missing.");
    }
    artifactByKey.set(artifactId, artifact);
    if (processed.has(artifactId)) continue;
    processed.add(artifactId);

    if (current.depth >= MAX_DEPTH) {
      artifact.warnings.push(`Maximum dependency depth (${MAX_DEPTH}) reached.`);
      continue;
    }
    const candidates = new Map<string, { id: string; targets: string[]; relation: Dependency["relationType"]; label: string; path?: string; parentId: string }>();
    let embeddedNodes: ReturnType<typeof extractJourneyDefinitionReferences>["nodes"] = [];
    let journeyDefinitionField = "";

    if (current.depth === 0 && current.entity.kind === "journey") {
      const journeyJsonAttribute = attributes.find((attribute) => /journeyjson$/i.test(attribute.logicalName));
      journeyDefinitionField = journeyJsonAttribute?.logicalName ?? "msdynmkt_journeyjson";
      const journeyJson = journeyJsonAttribute ? current.record[journeyJsonAttribute.logicalName] : undefined;
      const references = extractJourneyDefinitionReferences(journeyJson);
      embeddedNodes = references.nodes;
      if (references.emailIds.length || references.nodes.length) {
        logDiagnostic({
          level: "info",
          phase: "journey-definition-references",
          entity: current.entity.logicalName,
          message: `Journey definition contains ${references.emailIds.length} email action(s), ${references.nodes.filter((node) => node.kind === "task").length} task(s) and ${references.nodes.filter((node) => node.kind === "trigger").length} trigger(s)`,
        });
      }
      for (const node of references.nodes) {
        const nodeId = `journey-embedded:${recordId.toLowerCase()}:${node.key}`;
        const parentId = node.parentKey ? `journey-embedded:${recordId.toLowerCase()}:${node.parentKey}` : artifactId;
        const nodeArtifact: Artifact = {
          id: nodeId,
          kind: node.kind,
          logicalName: "journey-embedded",
          entitySetName: "",
          recordId: node.key,
          displayName: node.name,
          entityDisplayName: node.kind === "trigger" ? "Journey trigger" : node.kind === "task" ? "Journey task" : node.kind === "email" ? "Journey email action" : "Journey action",
          sourceRecord: node.record,
          conditionOptionLabels: await conditionOptionLabels(node.record),
          warnings: [],
        };
        artifactByKey.set(nodeId, nodeArtifact);
        addDependency({
          id: `${parentId}->${nodeId}:embedded-in-json:${node.path}`,
          sourceArtifactId: parentId,
          targetArtifactId: nodeId,
          targetRecordId: node.key,
          targetLogicalName: "journey-embedded",
          relationType: node.kind === "trigger" ? "triggers" : "embedded-in-json",
          label: nodeArtifact.entityDisplayName ?? "Journey action",
          path: `${journeyJsonAttribute?.logicalName ?? "msdynmkt_journeyjson"}.${node.path}`,
          resolved: true,
          warnings: [],
        });
      }

      // A Customer Insights Journey trigger is often represented by an event
      // name in Journey JSON, not by a GUID. Resolve that name to the actual
      // trigger/event row so migration can create and map it before the Journey.
      const triggerNames = references.nodes
        .filter((node) => node.kind === "trigger")
        .map((node) => {
          const parameters = node.record.parameters && typeof node.record.parameters === "object"
            ? node.record.parameters as Record<string, unknown>
            : undefined;
          return typeof parameters?.eventName === "string"
            ? parameters.eventName
            : typeof node.record.eventName === "string" ? node.record.eventName : undefined;
        })
        .filter((name): name is string => Boolean(name));
      const triggerEntities = catalog.filter((entity) => entity.kind === "trigger" && entity.logicalName.toLowerCase() !== rootEntity.logicalName.toLowerCase());
      for (const eventName of triggerNames) {
        let resolvedTrigger: { entity: EntityInfo; record: Record<string, unknown> } | undefined;
        for (const entity of triggerEntities) {
          const triggerAttributes = await cacheAttributes(entity).catch(() => []);
          const configuredNameFields = [...new Set([
            entity.primaryNameAttribute,
            "msdynmkt_eventname",
            "msdynmkt_eventdefinitionname",
            "msdynmkt_name",
            "eventname",
            "eventdefinitionname",
            "name",
          ].filter(
            (field): field is string => typeof field === "string" && triggerAttributes.some(
              (attribute) => attribute.logicalName.toLowerCase() === field.toLowerCase(),
            ),
          ))];
           const textNameFields = triggerAttributes
             .filter((attribute) => ["String", "Memo"].includes(attribute.attributeType ?? ""))
             .filter((attribute) => !SYSTEM_DISPLAY_ALIAS.test(attribute.logicalName))
             .map((attribute) => attribute.logicalName);
          const nameFields = [...new Set([...configuredNameFields, ...textNameFields])];
          if (!nameFields.length) continue;
             const columns = queryableColumns([
             ...selectedColumns(entity, triggerAttributes, connectionTarget),
             ...nameFields,
           ]);
          const filter = nameFields
            .map((nameField) => `${nameField} eq '${escapeODataString(eventName)}'`)
            .join(" or ");
          const query = `${entity.entitySetName}?$select=${columns.map(encodeURIComponent).join(",")}&$filter=${encodeURIComponent(filter)}&$top=10`;
          let records = await queryAll(query, warnings, "journey-trigger-read", entity.logicalName, connectionTarget).catch(() => []);
          // Event metadata schemas differ between Customer Insights versions.
          // If the guessed OData filter is rejected or uses a different field,
          // read the bounded trigger catalog and match all readable text fields.
          if (!records.length) {
            const fallbackQuery = `${entity.entitySetName}?$select=${columns.map(encodeURIComponent).join(",")}&$top=500`;
            records = await queryAll(fallbackQuery, warnings, "journey-trigger-catalog", entity.logicalName, connectionTarget).catch(() => []);
          }
           const matchingRecord = records.find((record) => nameFields.some((nameField) => {
            const value = record[nameField];
            return typeof value === "string" && value.trim().toLowerCase() === eventName.trim().toLowerCase();
           }));
           if (matchingRecord) {
            const triggerId = getValue(matchingRecord, entity.primaryIdAttribute);
            const fullTriggerRecord = triggerId
              ? await queryRecord(entity, triggerId, [], "journey-trigger-full-read", connectionTarget).catch(() => undefined)
              : undefined;
            resolvedTrigger = { entity, record: fullTriggerRecord ?? matchingRecord };
            break;
          }
          if (resolvedTrigger) break;
        }
        if (resolvedTrigger) {
          const triggerId = getValue(resolvedTrigger.record, resolvedTrigger.entity.primaryIdAttribute);
          if (triggerId) {
            queue.push({ entity: resolvedTrigger.entity, record: resolvedTrigger.record, depth: 1, parentId: artifactId, relation: "triggers", label: eventName, path: `${journeyDefinitionField}.trigger.parameters.eventName` });
          }
        } else {
          warnings.push(`Could not resolve Journey trigger event '${eventName}' to a Dataverse trigger record.`);
        }
      }
    }

    // Expand only semantically meaningful child relationships. Broadly
    // expanding every artifact would pull in unrelated records that happen to
    // share a Brand Profile, Sender, Purpose, or Topic.
    if (current.depth === 0 || (getArtifactDefinition(current.entity.kind).expandChildren?.length ?? 0) > 0) {
      try {
        const relationships = await cacheChildRelationships(current.entity);
        for (const relationship of relationships) {
        const referencedEntity = typeof relationship.ReferencedEntity === "string" ? relationship.ReferencedEntity.toLowerCase() : "";
        const childLogicalName = typeof relationship.ReferencingEntity === "string" ? relationship.ReferencingEntity.toLowerCase() : "";
        const childLookup = typeof relationship.ReferencingAttribute === "string" ? relationship.ReferencingAttribute : "";
        const child = entityByName.get(childLogicalName);
        if (
          referencedEntity !== current.entity.logicalName.toLowerCase() ||
          !child ||
          !childLookup ||
          (current.depth > 0 && !getArtifactDefinition(current.entity.kind).expandChildren?.includes(child.kind)) ||
          !isSupportedArtifactKind(child.kind)
        ) continue;
        const childQuery = `${child.entitySetName}?$filter=_${childLookup}_value eq ${recordId}&$top=${PAGE_SIZE}`;
        try {
            const childRecords = await queryAll(childQuery, warnings, "related-record-query", child.logicalName, connectionTarget);
          for (const childRecord of childRecords) {
            queue.push({
              entity: child,
              record: childRecord,
              depth: current.depth + 1,
              parentId: artifactId,
              relation: "lookup",
              label: typeof relationship.SchemaName === "string" ? relationship.SchemaName : child.displayName,
              path: childLookup,
            });
          }
        } catch (error) {
          logDiagnostic({ level: "error", phase: "related-record-query", entity: child.logicalName, query: childQuery, message: `Failed to load related ${child.displayName} records`, error });
          warnings.push(`Could not read related ${child.displayName} records: ${errorMessage(error)}`);
        }
        }
      } catch (error) {
        // Some roles do not expose relationship metadata; direct lookup discovery still works.
        logDiagnostic({ level: "warning", phase: "child-relationship-metadata", entity: current.entity.logicalName, message: `Relationship metadata unavailable for ${current.entity.logicalName}`, error });
      }
    }

    for (const attribute of attributes) {
      const supportedTargets = attribute.targets.filter((target) => Boolean(entityByName.get(target.toLowerCase())));
      if (supportedTargets.length) {
        const referenceValue = current.record[`_${attribute.logicalName}_value`];
        if (typeof referenceValue === "string") {
          const key = `${artifactId}:${referenceValue.toLowerCase()}`;
          const previous = candidates.get(key);
          candidates.set(key, {
            id: referenceValue,
            // Keep explicit type information from Journey JSON ahead of
            // polymorphic lookup targets that happen to share the same GUID.
            targets: [...new Set([...(previous?.targets ?? []), ...supportedTargets])],
            relation: previous?.relation ?? "lookup",
            label: previous?.label ?? attribute.displayName,
            path: previous?.path,
            parentId: artifactId,
          });
        }
      }
      for (const parsed of parseEmbeddedJson(current.record[attribute.logicalName])) {
        for (const reference of extractJsonGuids(parsed, attribute.logicalName)) {
          const pathSegments = reference.path.split(".");
          const referenceFieldName = pathSegments[pathSegments.length - 1]?.replace(/\[\d+\]$/, "") ?? "";
          const fieldName = referenceFieldName.toLowerCase().replace(/[^a-z0-9]/g, "");
          const actionOwner = owningJourneyNode(reference.path, embeddedNodes, journeyDefinitionField);
          const actionPath = actionOwner ? reference.path.slice(journeyDefinitionField.length + 1) : "";
          const inferredKinds = fieldName === "contentid" && actionOwner
            ? journeyReferenceKind(actionPath, actionOwner) === "email" ? ["email" as const] : []
            : JSON_REFERENCE_FIELDS[fieldName] ?? [];
          // Journey JSON also contains GUIDs for action nodes, event metadata,
          // source tiles and placeholders. Only explicit record-reference
          // fields are Dataverse rows; treating every *id as a record creates
          // false unresolved references (often incorrectly typed as Journey).
          if (inferredKinds.length === 0) continue;
          const inferredTargets = catalog
            .filter((item) => inferredKinds.includes(item.kind))
            .map((item) => item.logicalName);
          if (inferredTargets.length === 0) continue;
          const parentId = actionOwner ? `journey-embedded:${recordId.toLowerCase()}:${actionOwner.key}` : artifactId;
          const key = `${parentId}:${reference.id.toLowerCase()}`;
          const previous = candidates.get(key);
          const referenceKindLabel: Partial<Record<ArtifactKind, string>> = {
            email: "Journey email",
            compliance: "Compliance Profile",
            purpose: "Purpose",
            topic: "Topic",
            sender: "Sender",
            brandProfile: "Brand profile",
            template: "Template",
            contentBlock: "Content block",
            segment: "Segment",
            marketingForm: "Marketing form",
            asset: "Digital asset",
            journey: "Journey",
          };
          const inferredLabel = referenceKindLabel[inferredKinds[0]] ?? `JSON reference (${attribute.displayName})`;
          candidates.set(key, {
            id: reference.id,
            // Typed references (e.g. actions[*].parameters.contentId) take
            // precedence over ambiguous lookup metadata for that same GUID.
            targets: [...new Set([...inferredTargets, ...(previous?.targets ?? [])])],
            relation: "embedded-in-json",
            label: inferredLabel,
            path: reference.path ?? previous?.path,
            parentId,
          });
        }
      }
    }

    for (const candidate of candidates.values()) {
      const sourceId = candidate.parentId;
      const targets = candidate.targets.map((name) => entityByName.get(name.toLowerCase())).filter((item): item is EntityInfo => Boolean(item));
      if (targets.length === 0) {
        const dependencyId = `${sourceId}->unresolved:${candidate.id.toLowerCase()}:${candidate.path ?? candidate.label}`;
        addDependency({
          id: dependencyId,
          sourceArtifactId: sourceId,
          targetRecordId: candidate.id,
          relationType: candidate.relation,
          label: candidate.label,
          path: candidate.path,
          resolved: false,
          warnings: ["The reference target type could not be determined from the metadata."],
        });
        continue;
      }
      let resolved = false;
      let everyTargetConfirmedMissing = targets.length > 0;
      for (const target of targets) {
        const targetAttributes = await cacheAttributes(target).catch((error) => {
          logDiagnostic({ level: "error", phase: "lookup-target-metadata", entity: target.logicalName, message: `Failed to read metadata for lookup target ${target.logicalName}`, error });
          return [];
        });
          const columns = selectedColumns(target, targetAttributes, connectionTarget);
        try {
            const targetRecord = await queryRecord(target, candidate.id, columns, "lookup-target-read", connectionTarget);
          if (!targetRecord || !Object.keys(targetRecord).length) continue;
          queue.push({
            entity: target,
            record: targetRecord,
            depth: current.depth + 1,
            parentId: sourceId,
            relation: candidate.relation,
            label: candidate.label,
            path: candidate.path,
          });
          resolved = true;
          break;
        } catch (error) {
          everyTargetConfirmedMissing = false;
          // Polymorphic lookups can have several target tables; try each supported target.
          logDiagnostic({
            level: "info",
            phase: "lookup-target-fallback",
            entity: target.logicalName,
            message: `Could not resolve reference as ${target.logicalName}; trying its other known target types`,
            error,
          });
        }
      }
      if (!resolved) {
        if (everyTargetConfirmedMissing) {
          const target = targets[0];
          const deletedArtifactId = `${target.logicalName.toLowerCase()}:${candidate.id.toLowerCase()}`;
          const deletedArtifact: Artifact = {
            id: deletedArtifactId,
            kind: target.kind,
            logicalName: target.logicalName,
            entitySetName: target.entitySetName,
            recordId: candidate.id,
            displayName: "Record no longer exists",
            entityDisplayName: target.displayName,
            deleted: true,
            dataverseUrl: createRecordUrl(organizationUrl, target.logicalName, candidate.id),
            sourceRecord: {},
            warnings: ["This record is referenced by the Journey but could not be found in Dataverse; it may have been deleted."],
          };
          artifactByKey.set(deletedArtifactId, deletedArtifact);
          addDependency({
            id: `${sourceId}->${deletedArtifactId}:${candidate.relation}:${candidate.path ?? candidate.label}`,
            sourceArtifactId: sourceId,
            targetArtifactId: deletedArtifactId,
            targetRecordId: candidate.id,
            targetLogicalName: target.logicalName,
            relationType: candidate.relation,
            label: candidate.label,
            path: candidate.path,
            resolved: true,
            targetDeleted: true,
            warnings: deletedArtifact.warnings,
          });
          logDiagnostic({
            level: "warning",
            phase: "deleted-reference",
            entity: target.logicalName,
            message: `Referenced ${target.displayName} record ${candidate.id} was not found in Dataverse`,
          });
          continue;
        }
        addDependency({
          id: `${sourceId}->unresolved:${candidate.id.toLowerCase()}:${candidate.path ?? candidate.label}`,
          sourceArtifactId: sourceId,
          targetRecordId: candidate.id,
          targetLogicalName: targets.length === 1 ? targets[0].logicalName : undefined,
          relationType: candidate.relation,
          label: candidate.label,
          path: candidate.path,
          resolved: false,
          warnings: ["The related record could not be read or matched to a supported Customer Journey data type."],
        });
      }
    }
  }

  if (artifactByKey.size >= MAX_ARTIFACTS) warnings.push(`Discovery wurde beim Sicherheitslimit von ${MAX_ARTIFACTS} Artefakten beendet.`);
  const conditionLookupValues: Record<string, string> = {};
  for (const artifact of artifactByKey.values()) {
    if (artifact.logicalName === "journey-embedded") continue;
    const type = artifact.entityDisplayName ?? artifact.kind;
    const label = `${artifact.displayName} (${type})`;
    const normalizedId = artifact.recordId.replace(/[{}]/g, "").toLowerCase();
    conditionLookupValues[normalizedId] = label;
    conditionLookupValues[`${artifact.logicalName.toLowerCase()}:${normalizedId}`] = label;
  }
  for (const artifact of artifactByKey.values()) {
    if (artifact.logicalName === "journey-embedded") artifact.conditionLookupValues = conditionLookupValues;
  }
  const rootId = `${rootEntity.logicalName.toLowerCase()}:${journey.id.toLowerCase()}`;
  const root = artifactByKey.get(rootId);
  if (!root) throw new Error("The selected Journey could not be loaded.");
  if (artifactByKey.size === 1 && dependencies.length === 0) {
    warnings.push("No resolvable Dataverse dependencies were found for this Journey. Embedded or unsupported reference formats may still be present.");
  }
  return {
    root,
    artifacts: [...artifactByKey.values()],
    dependencies,
    warnings,
    discoveredAt: new Date().toISOString(),
  };
}
