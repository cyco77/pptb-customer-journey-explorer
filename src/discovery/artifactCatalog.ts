import type { ArtifactKind } from "./types";

export type ArtifactDefinition = {
  kind: ArtifactKind;
  label: string;
  terms?: string[];
  supported?: boolean;
  journeyListing?: boolean;
  exactJourneyEntity?: boolean;
  triggerEntity?: boolean;
  journeyActionEntity?: boolean;
  parentKind?: ArtifactKind;
  /** Explicit schema name when known; otherwise resolved from relationship metadata. */
  parentLookupField?: string;
  /** Navigation property used to bind the semantic parent in the Dataverse Web API. */
  parentNavigationProperty?: string;
  /** Related child tables to expand while discovering this parent record. */
  expandChildren?: ArtifactKind[];
  migrationRank?: number;
};

/** Canonical artifact kinds, discovery rules, and semantic migration dependencies. */
export const ARTIFACT_DEFINITIONS: ArtifactDefinition[] = [
  { kind: "journeyAction", label: "Journey action", terms: ["journeyaction", "journey_action", "journey action", "journeystep", "journey_step"], journeyActionEntity: true, supported: true, migrationRank: 10 },
  { kind: "journeyVersion", label: "Journey version", terms: ["journeyversion", "journey_version", "journey version"], supported: true, migrationRank: 11 },
  { kind: "marketingForm", label: "Marketing form", terms: ["marketingform", "marketing_form", "marketing form"], supported: true, migrationRank: 12 },
  { kind: "contentBlock", label: "Content block", terms: ["contentblock", "content_block", "content block"], supported: true, migrationRank: 13 },
  { kind: "brandProfile", label: "Brand profile", terms: ["brandprofile", "brand_profile", "brand profile"], supported: true, expandChildren: ["sender"], migrationRank: 0 },
  { kind: "compliance", label: "Compliance", terms: ["compliance", "consent profile", "compliance profile"], supported: true, expandChildren: ["purpose", "topic"], migrationRank: 0 },
  { kind: "purpose", label: "Purpose", terms: ["purpose"], supported: true, parentKind: "compliance", parentLookupField: "msdynmkt_compliancesettingsid", parentNavigationProperty: "msdynmkt_compliancesettings4", expandChildren: ["topic"], migrationRank: 1 },
  { kind: "topic", label: "Topic", terms: ["topic"], supported: true, parentKind: "purpose", parentLookupField: "msdynmkt_purposeid", migrationRank: 2 },
  { kind: "sender", label: "Sender", terms: ["sender"], supported: true, parentKind: "brandProfile", parentLookupField: "msdynmkt_brandprofileid", migrationRank: 1 },
  { kind: "template", label: "Template", terms: ["template"], supported: true, migrationRank: 14 },
  { kind: "journey", label: "Journey", terms: ["journey", "customer journey"], supported: true, journeyListing: true, exactJourneyEntity: true, migrationRank: 0 },
  { kind: "trigger", label: "Trigger / event", terms: ["trigger", "eventdefinition", "eventmetadata", "customtrigger", "custom event"], supported: true, triggerEntity: true, migrationRank: 8 },
  { kind: "segment", label: "Segment", terms: ["segment"], supported: true, migrationRank: 15 },
  { kind: "asset", label: "Digital asset", terms: ["digitalasset", "digital_asset", "digital asset"], supported: true, migrationRank: 16 },
  { kind: "email", label: "Email", terms: ["email", "e-mail"], supported: true, migrationRank: 17 },
  { kind: "team", label: "Team", terms: ["team"], migrationRank: 18 },
  { kind: "task", label: "Task" },
  { kind: "businessRecord", label: "Related record" },
  { kind: "unknown", label: "Unknown" },
];

export const JSON_REFERENCE_FIELDS: Record<string, ArtifactKind[]> = {
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

export const UNSUPPORTED_ARTIFACT_ENTITY_PATTERN = /analytics|contactrecord|interaction|tracking|telemetry|eventlog|eventregistration|journeyevent|history|usage|submission|optimizationcount|runparameter|workflowmapping|dependency|legacy|emailclient|smsphonenumber|msdyncrm_/i;
export const UNCLASSIFIED_ENTITY_PATTERN = /analytics|contactrecord|interaction|tracking|telemetry|eventlog|eventregistration|audit|history|optimizationcount|segmentusage|runparameter|submission|teamsengagement|journeydependency|workflowmapping|msdyncrm_/i;

const definitionsByKind = new Map(ARTIFACT_DEFINITIONS.map((definition) => [definition.kind, definition]));

export function getArtifactDefinition(kind: ArtifactKind): ArtifactDefinition {
  return definitionsByKind.get(kind) ?? definitionsByKind.get("unknown")!;
}

export function getArtifactLabel(kind: ArtifactKind): string {
  return getArtifactDefinition(kind).label;
}

export function getParentKind(kind: ArtifactKind): ArtifactKind | undefined {
  return getArtifactDefinition(kind).parentKind;
}

export function getParentLookupField(kind: ArtifactKind): string | undefined {
  return getArtifactDefinition(kind).parentLookupField;
}

export function getParentNavigationProperty(kind: ArtifactKind): string | undefined {
  return getArtifactDefinition(kind).parentNavigationProperty;
}

export function getMigrationRank(kind: ArtifactKind, fallback = 10): number {
  return getArtifactDefinition(kind).migrationRank ?? fallback;
}

export function isSupportedArtifactKind(kind: ArtifactKind): boolean {
  return getArtifactDefinition(kind).supported === true;
}

/** Returns every catalog consistency issue; an empty array means the catalog is valid. */
export function validateArtifactCatalog(): string[] {
  const errors: string[] = [];
  const kinds = new Set<ArtifactKind>();
  for (const definition of ARTIFACT_DEFINITIONS) {
    if (kinds.has(definition.kind)) errors.push(`Duplicate artifact kind: ${definition.kind}`);
    kinds.add(definition.kind);
    if (!definition.label.trim()) errors.push(`Missing display label for ${definition.kind}`);
    if (definition.supported && !definition.terms?.length) errors.push(`Supported artifact ${definition.kind} has no discovery terms`);
    if (definition.parentLookupField && !definition.parentKind) errors.push(`${definition.kind} defines parent lookup ${definition.parentLookupField} without a parent kind`);
  }
  const artifactKinds: ArtifactKind[] = ["journey", "journeyVersion", "journeyAction", "task", "trigger", "email", "marketingForm", "compliance", "purpose", "topic", "sender", "brandProfile", "template", "contentBlock", "segment", "asset", "team", "businessRecord", "unknown"];
  for (const kind of artifactKinds) if (!kinds.has(kind)) errors.push(`Missing artifact definition: ${kind}`);
  for (const definition of ARTIFACT_DEFINITIONS) {
    if (definition.parentKind && !kinds.has(definition.parentKind)) errors.push(`${definition.kind} references unknown parent kind ${definition.parentKind}`);
    for (const child of definition.expandChildren ?? []) if (!kinds.has(child)) errors.push(`${definition.kind} expands unknown child kind ${child}`);
    const visited = new Set<ArtifactKind>([definition.kind]);
    let parent = definition.parentKind;
    while (parent) {
      if (visited.has(parent)) {
        errors.push(`Cyclic artifact dependency includes ${definition.kind}`);
        break;
      }
      visited.add(parent);
      parent = definitionsByKind.get(parent)?.parentKind;
    }
  }
  for (const [field, targets] of Object.entries(JSON_REFERENCE_FIELDS)) {
    if (!field.trim()) errors.push("JSON reference field names cannot be empty");
    for (const target of targets) if (!kinds.has(target)) errors.push(`JSON reference ${field} targets unknown artifact kind ${target}`);
  }
  return [...new Set(errors)];
}
