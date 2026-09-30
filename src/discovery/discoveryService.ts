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

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const MAX_JOURNEYS = 200;
const MAX_ARTIFACTS = 250;
const MAX_DEPTH = 5;
const GUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const ARTIFACT_HINTS: Array<{ kind: ArtifactKind; terms: string[] }> = [
  { kind: "journeyAction", terms: ["journeyaction", "journey_action", "journey action", "journeystep", "journey_step"] },
  { kind: "journeyVersion", terms: ["journeyversion", "journey_version", "journey version"] },
  { kind: "marketingForm", terms: ["marketingform", "marketing_form", "marketing form"] },
  { kind: "contentBlock", terms: ["contentblock", "content_block", "content block"] },
  { kind: "brandProfile", terms: ["brandprofile", "brand_profile", "brand profile"] },
  { kind: "compliance", terms: ["compliance", "consent profile", "compliance profile"] },
  { kind: "purpose", terms: ["purpose"] },
  { kind: "topic", terms: ["topic"] },
  { kind: "sender", terms: ["sender"] },
  { kind: "template", terms: ["template"] },
  { kind: "journey", terms: ["journey", "customer journey"] },
  { kind: "trigger", terms: ["trigger", "eventdefinition", "eventmetadata", "customtrigger", "custom event"] },
  { kind: "segment", terms: ["segment"] },
  { kind: "asset", terms: ["digitalasset", "digital_asset", "digital asset"] },
  { kind: "email", terms: ["email", "e-mail"] },
  { kind: "team", terms: ["team"] },
];

const JSON_REFERENCE_FIELDS: Record<string, ArtifactKind[]> = {
  contentid: ["email"],
  emailid: ["email"],
  compliancesettingsid: ["compliance"],
  complianceprofileid: ["compliance"],
  purposeid: ["purpose"],
  topicid: ["topic"],
  senderid: ["sender"],
  brandprofileid: ["brandProfile"],
  templateid: ["template"],
  contentblockid: ["contentBlock"],
  segmentid: ["segment"],
  formid: ["marketingForm"],
  marketingformid: ["marketingForm"],
  assetid: ["asset"],
  digitalassetid: ["asset"],
  journeyid: ["journey"],
};

const getDisplayName = (metadata: DataverseAPI.EntityMetadata): string =>
  localizedMetadataLabel(metadata.DisplayName) ?? metadata.LogicalName;

const metadataCatalogCache = new Map<string, EntityInfo>();

function isJourneyListingEntity(entity: EntityInfo): boolean {
  const logicalName = entity.logicalName.toLowerCase();
  const displayName = entity.displayName.trim().toLowerCase();
  if (/analytics|contactrecord|interaction|tracking|telemetry|instance|event|log|legacy|msdyncrm_/.test(logicalName)) {
    return false;
  }
  return /^(?:msdynmkt_)?(?:customer_)?journey$/.test(logicalName) ||
    ["journey", "customer journey"].includes(displayName);
}

function isSupportedArtifactEntity(entity: EntityInfo): boolean {
  const logicalName = entity.logicalName.toLowerCase();
  if (!logicalName.startsWith("msdynmkt_")) return false;
  if (/analytics|contactrecord|interaction|tracking|telemetry|eventlog|eventregistration|journeyevent|history|usage|submission|optimizationcount|runparameter|workflowmapping|dependency|legacy|msdyncrm_/.test(logicalName)) return false;
  return ["journey", "journeyVersion", "journeyAction", "email", "marketingForm", "compliance", "purpose", "topic", "sender", "brandProfile", "template", "contentBlock", "segment", "asset", "trigger"].includes(entity.kind);
}

function classifyEntity(logicalName: string, displayName: string): { kind: ArtifactKind; score: number } | undefined {
  const logical = logicalName.toLowerCase();
  const display = displayName.toLowerCase();
  if (/analytics|contactrecord|interaction|tracking|telemetry|eventlog|eventregistration|audit|history|optimizationcount|segmentusage|runparameter|submission|teamsengagement|journeydependency|workflowmapping|msdyncrm_/.test(logical)) {
    return undefined;
  }
  const combined = `${logical} ${display}`;
  for (const { kind, terms } of ARTIFACT_HINTS) {
    if (kind === "journeyAction" && !/(journeyaction|journey_action|journey action|journeystep|journey_step)/.test(combined)) continue;
    if (kind === "trigger" && !(
      /trigger|eventdefinition|eventmetadata|customevent/.test(logical) ||
      /trigger|event definition|event metadata|custom event/.test(display)
    )) continue;
    if (kind === "journey" && !(
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
): Promise<{ value: Record<string, unknown>[]; "@odata.nextLink"?: string }> {
  try {
    return await window.dataverseAPI.queryData(query, "primary") as {
      value: Record<string, unknown>[];
      "@odata.nextLink"?: string;
    };
  } catch (error) {
    logDiagnostic({
      level: "error",
      phase,
      entity,
      query,
      message: `Dataverse queryData failed for ${entity}`,
      error,
    });
    throw error;
  }
}

async function queryAll(query: string, warnings?: string[], phase = "dependency-query", entity = "unknown"): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let nextQuery: string | undefined = query;
  let page = 0;
  while (nextQuery && page < MAX_PAGES) {
    const response = await queryWithDiagnostics(nextQuery, phase, entity);
    records.push(...response.value);
    const nextLink = response["@odata.nextLink"];
    if (!nextLink) break;
    const nextUrl = new URL(nextLink, "https://dataverse.invalid");
    nextQuery = `${nextUrl.pathname.replace(/^\/api\/data\/v\d+\.\d+\//, "")}${nextUrl.search}`;
    page += 1;
  }
  if (nextQuery && page >= MAX_PAGES) warnings?.push(`The query was limited to ${MAX_PAGES} pages; results may be incomplete.`);
  return records;
}

async function queryRecord(
  entity: EntityInfo,
  recordId: string,
  columns: string[],
  phase: string,
): Promise<Record<string, unknown> | undefined> {
  const query = `${entity.entitySetName}?$select=${columns.map(encodeURIComponent).join(",")}&$filter=${entity.primaryIdAttribute} eq ${recordId}&$top=1`;
  const results = await queryAll(query, undefined, phase, entity.logicalName);
  return results[0];
}

async function getEntityCatalog(): Promise<EntityInfo[]> {
  let response: { value: DataverseAPI.EntityMetadata[] };
  try {
    response = await window.dataverseAPI.getAllEntitiesMetadata(
      ["LogicalName", "DisplayName", "EntitySetName", "PrimaryIdAttribute", "PrimaryNameAttribute"],
      "primary",
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
      displayName,
      ...(classified ?? { kind: "unknown" as const, score: 0 }),
    }];
  });
  metadataCatalogCache.clear();
  for (const entity of allEntities) metadataCatalogCache.set(entity.logicalName.toLowerCase(), entity);
  return allEntities.filter(isSupportedArtifactEntity);
}

async function getAttributes(entity: EntityInfo): Promise<AttributeInfo[]> {
  let attributeResponse: { value: Record<string, unknown>[] };
  let relationshipResponse: { value: Record<string, unknown>[] };
  try {
    [attributeResponse, relationshipResponse] = await Promise.all([
      window.dataverseAPI.getEntityRelatedMetadata(
      entity.logicalName,
      "Attributes",
      ["LogicalName", "DisplayName", "AttributeType", "IsValidForRead"],
      "primary",
      ),
      window.dataverseAPI.getEntityRelatedMetadata(
      entity.logicalName,
      "ManyToOneRelationships",
      ["ReferencingAttribute", "ReferencedEntity"],
      "primary",
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
    throw error;
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

async function getOptionLabels(entity: EntityInfo, attributeName: string): Promise<Record<string, string>> {
  try {
    const metadata = await window.dataverseAPI.getEntityRelatedMetadata(
      entity.logicalName,
      `Attributes(LogicalName='${attributeName}')`,
      undefined,
      "primary",
    ) as Record<string, unknown>;
    // StateAttributeMetadata and StatusAttributeMetadata both expose their
    // localized options through the OptionSet property. StatusOptionSet is
    // the metadata type, not the property name.
    const optionSet = metadata.OptionSet;
    const options = optionSet && typeof optionSet === "object" && Array.isArray((optionSet as Record<string, unknown>).Options)
      ? (optionSet as Record<string, unknown>).Options as unknown[]
      : [];
    if (options.length === 0) return {};
    return Object.fromEntries(options.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const item = option as Record<string, unknown>;
      const value = item.Value;
      const label = localizedMetadataLabel(item.Label);
      return (typeof value === "number" || typeof value === "string") && label
        ? [[String(value), label]]
        : [];
    }));
  } catch (error) {
    logDiagnostic({ level: "warning", phase: "status-option-metadata", entity: entity.logicalName, message: `Could not load ${attributeName} labels for ${entity.logicalName}`, error });
    return {};
  }
}

async function getStatusLabels(entity: EntityInfo): Promise<{ state: Record<string, string>; status: Record<string, string> }> {
  const [state, status] = await Promise.all([
    getOptionLabels(entity, "statecode"),
    getOptionLabels(entity, "statuscode"),
  ]);
  return { state, status };
}

function selectedColumns(entity: EntityInfo, attributes: AttributeInfo[]): string[] {
  const columns = new Set<string>([entity.primaryIdAttribute]);
  if (entity.primaryNameAttribute) columns.add(entity.primaryNameAttribute);
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
    const isSupportedLookup = attribute.targets.some((target) => {
      const targetEntity = metadataCatalogCache.get(target.toLowerCase());
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
    if (isDisplayAlias) continue;
    if (
      isSupportedLookup ||
      isStableSystemColumn ||
      isKnownPayload
    ) {
      columns.add(isSupportedLookup ? `_${attribute.logicalName}_value` : attribute.logicalName);
    }
  }
  return [...columns];
}

function getValue(record: Record<string, unknown>, ...keys: Array<string | undefined>): string | undefined {
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
    name: getValue(record, entity.primaryNameAttribute, "name", "msdynmkt_name", "subject") ?? `${entity.displayName} ${id.slice(0, 8)}`,
    status: getValue(record, "statuscode", "statecode"),
    version: getValue(record, "versionnumber", "msdynmkt_versionnumber"),
    modifiedOn: getValue(record, "modifiedon"),
    record,
  };
}

export async function loadJourneys(): Promise<{ journeys: JourneyOption[]; warnings: string[] }> {
  const catalog = await getEntityCatalog();
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
        const query = `${entity.entitySetName}?$select=${columns.map(encodeURIComponent).join(",")}${filter}&$top=${MAX_JOURNEYS}`;
        const response = await queryWithDiagnostics(query, "journey-list", entity.logicalName);
        records = response.value;
      } catch (error) {
        if (!entity.primaryNameAttribute) throw error;
        warnings.push(`Could not read the name field for ${entity.displayName}; loading IDs as a fallback.`);
        logDiagnostic({ level: "warning", phase: "journey-list-fallback", entity: entity.logicalName, message: "Journey list query failed with primary name column; retrying IDs only", error });
        const query = `${entity.entitySetName}?$select=${encodeURIComponent(entity.primaryIdAttribute)}&$top=${MAX_JOURNEYS}`;
        const response = await queryWithDiagnostics(query, "journey-list-fallback", entity.logicalName);
        records = response.value;
      }
      if (records.length === MAX_JOURNEYS) {
        warnings.push(`The ${entity.displayName} Journey list is limited to ${MAX_JOURNEYS} records.`);
      }
      const journeyStatusLabels = await getStatusLabels(entity);
      journeys.push(...records.flatMap((record) => {
        const option = toJourneyOption(entity, record);
        if (!option) return [];
        const statusCode = getValue(record, "statuscode");
        const stateCode = getValue(record, "statecode");
        option.statusDisplay = getValue(record, "statuscode@OData.Community.Display.V1.FormattedValue") ?? (statusCode
          ? journeyStatusLabels.status[statusCode] ?? option.status
          : stateCode
            ? journeyStatusLabels.state[stateCode] ?? option.status
            : undefined);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordDisplayName(record: Record<string, unknown>, entity: EntityInfo, attributes: AttributeInfo[]): string {
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

export async function discoverJourney(
  journey: JourneyOption,
  organizationUrl: string,
): Promise<DiscoveryResult> {
  const catalog = await getEntityCatalog();
  const entityByName = new Map(catalog.map((entity) => [entity.logicalName.toLowerCase(), entity]));
  const attributesByEntity = new Map<string, AttributeInfo[]>();
  const statusLabelsByEntity = new Map<string, { state: Record<string, string>; status: Record<string, string> }>();
  const childRelationshipsByEntity = new Map<string, Array<Record<string, unknown>>>();
  const warnings: string[] = [];
  const artifactByKey = new Map<string, Artifact>();
  const dependencies: Dependency[] = [];
  const processed = new Set<string>();
  const queue: Array<{ entity: EntityInfo; record: Record<string, unknown>; depth: number; parentId?: string; relation?: Dependency["relationType"]; label?: string; path?: string }> = [];

  const cacheAttributes = async (entity: EntityInfo): Promise<AttributeInfo[]> => {
    const existing = attributesByEntity.get(entity.logicalName.toLowerCase());
    if (existing) return existing;
    const attributes = await getAttributes(entity);
    attributesByEntity.set(entity.logicalName.toLowerCase(), attributes);
    return attributes;
  };

  const cacheStatusLabels = async (entity: EntityInfo) => {
    const key = entity.logicalName.toLowerCase();
    const existing = statusLabelsByEntity.get(key);
    if (existing) return existing;
    const labels = await getStatusLabels(entity);
    statusLabelsByEntity.set(key, labels);
    return labels;
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
      const optionLabels = await getOptionLabels(entity, fieldName);
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
        "primary",
      ) as { value: Record<string, unknown>[] };
    } catch (error) {
      logDiagnostic({ level: "error", phase: "child-relationship-metadata", entity: entity.logicalName, message: `Failed to read child relationship metadata for ${entity.logicalName}`, error });
      throw error;
    }
    const relationships = response.value as Array<Record<string, unknown>>;
    childRelationshipsByEntity.set(key, relationships);
    return relationships;
  };

  const rootEntity = entityByName.get(journey.logicalName.toLowerCase());
  if (!rootEntity) throw new Error("The selected Journey table is no longer available in the metadata.");
  const rootAttributes = await cacheAttributes(rootEntity);
  const rootColumns = selectedColumns(rootEntity, rootAttributes);
  const rootPayloadAttributes = rootAttributes.filter((attribute) => {
    const name = attribute.logicalName.toLowerCase();
    return /journey.*(definition|json|data|content|workflow|configuration|config)|^(msdynmkt_)?definition$/.test(name);
  });
  for (const payload of rootPayloadAttributes) rootColumns.push(payload.logicalName);
  let rootRecord: Record<string, unknown>;
  try {
    rootRecord = await queryRecord(rootEntity, journey.id, rootColumns, "journey-root-read") ?? journey.record;
  } catch (error) {
    logDiagnostic({ level: "warning", phase: "journey-root-read", entity: rootEntity.logicalName, message: "Could not re-read selected Journey; using list row", error });
    rootRecord = journey.record;
  }
  for (const payload of rootPayloadAttributes) {
    if (rootRecord[payload.logicalName] !== undefined || journey.record[payload.logicalName] !== undefined) continue;
    try {
      const payloadRecord = await queryRecord(rootEntity, journey.id, [rootEntity.primaryIdAttribute, payload.logicalName], "journey-payload-read");
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
    const fieldDisplayNames = Object.fromEntries(attributes.map((attribute) => [
      attribute.logicalName.toLowerCase(),
      attribute.displayName,
    ]));
    const name = recordDisplayName(current.record, current.entity, attributes);
    const artifact: Artifact = {
      id: artifactId,
      kind: current.entity.kind,
      logicalName: current.entity.logicalName,
      entitySetName: current.entity.entitySetName,
      recordId,
      displayName: name,
      entityDisplayName: current.entity.displayName,
      state: getValue(current.record, "statecode"),
      status: getValue(current.record, "statuscode"),
      stateDisplay: getValue(current.record, "statecode@OData.Community.Display.V1.FormattedValue"),
      statusDisplay: getValue(current.record, "statuscode@OData.Community.Display.V1.FormattedValue"),
      stateLabels: statusLabels.state,
      statusLabels: statusLabels.status,
      fieldDisplayNames,
      version: getValue(current.record, "versionnumber", "msdynmkt_versionnumber"),
      dataverseUrl: createRecordUrl(organizationUrl, current.entity.logicalName, recordId),
      sourceRecord: current.record,
      warnings: [],
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
    }

    // Expand only semantically meaningful child relationships. Broadly
    // expanding every artifact would pull in unrelated records that happen to
    // share a Brand Profile, Sender, Purpose, or Topic.
    if (
      current.depth === 0 ||
      current.entity.kind === "compliance" ||
      current.entity.kind === "purpose" ||
      current.entity.kind === "brandProfile"
    ) {
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
          (current.depth > 0 && current.entity.kind === "compliance" && !["purpose", "topic"].includes(child.kind)) ||
          (current.depth > 0 && current.entity.kind === "purpose" && child.kind !== "topic") ||
          (current.depth > 0 && current.entity.kind === "brandProfile" && child.kind !== "sender") ||
          !["journey", "journeyVersion", "journeyAction", "email", "marketingForm", "compliance", "purpose", "topic", "sender", "brandProfile", "template", "contentBlock", "segment", "asset", "trigger"].includes(child.kind)
        ) continue;
        const childAttributes = await cacheAttributes(child).catch((error) => {
          logDiagnostic({ level: "error", phase: "related-artifact-metadata", entity: child.logicalName, message: `Failed to read metadata for related entity ${child.logicalName}`, error });
          return [];
        });
        const childColumns = selectedColumns(child, childAttributes);
        const childQuery = `${child.entitySetName}?$select=${childColumns.map(encodeURIComponent).join(",")}&$filter=_${childLookup}_value eq ${recordId}&$top=${PAGE_SIZE}`;
        try {
          const childRecords = await queryAll(childQuery, warnings, "related-record-query", child.logicalName);
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
        const columns = selectedColumns(target, targetAttributes);
        try {
          const targetRecord = await queryRecord(target, candidate.id, columns, "lookup-target-read");
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
