export type ArtifactKind =
  | "journey"
  | "journeyVersion"
  | "journeyAction"
  | "task"
  | "trigger"
  | "email"
  | "marketingForm"
  | "compliance"
  | "purpose"
  | "topic"
  | "sender"
  | "brandProfile"
  | "template"
  | "contentBlock"
  | "segment"
  | "asset"
  | "team"
  | "businessRecord"
  | "unknown";

export type DependencyRelation =
  | "lookup"
  | "embedded-in-json"
  | "embedded-in-html"
  | "uses"
  | "triggers"
  | "owned-by"
  | "external-url";

export type Artifact = {
  id: string;
  kind: ArtifactKind;
  logicalName: string;
  entitySetName: string;
  recordId: string;
  displayName: string;
  entityDisplayName?: string;
  deleted?: boolean;
  state?: string;
  status?: string;
  stateDisplay?: string;
  statusDisplay?: string;
  stateLabels?: Record<string, string>;
  statusLabels?: Record<string, string>;
  fieldDisplayNames?: Record<string, string>;
  version?: string;
  dataverseUrl?: string;
  sourceRecord: Record<string, unknown>;
  warnings: string[];
};

export type Dependency = {
  id: string;
  sourceArtifactId: string;
  targetArtifactId?: string;
  targetRecordId?: string;
  targetLogicalName?: string;
  relationType: DependencyRelation;
  label: string;
  path?: string;
  resolved: boolean;
  targetDeleted?: boolean;
  warnings: string[];
};

export type JourneyOption = {
  id: string;
  logicalName: string;
  entitySetName: string;
  name: string;
  status?: string;
  statusDisplay?: string;
  version?: string;
  modifiedOn?: string;
  record: Record<string, unknown>;
};

export type DiscoveryResult = {
  root: Artifact;
  artifacts: Artifact[];
  dependencies: Dependency[];
  warnings: string[];
  discoveredAt: string;
};

export type EntityInfo = {
  logicalName: string;
  entitySetName: string;
  primaryIdAttribute: string;
  primaryNameAttribute?: string;
  displayName: string;
  kind: ArtifactKind;
  score: number;
};

export type AttributeInfo = {
  logicalName: string;
  displayName: string;
  attributeType?: string;
  targets: string[];
};
