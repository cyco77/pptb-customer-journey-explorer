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
  primaryIdAttribute?: string;
  primaryNameAttribute?: string;
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
  optionSetLabels?: Record<string, Record<string, string>>;
  fieldDisplayNames?: Record<string, string>;
  fieldTypes?: Record<string, string>;
  conditionOptionLabels?: Record<string, string>;
  conditionLookupValues?: Record<string, string>;
  version?: string;
  dataverseUrl?: string;
  sourceRecord: Record<string, unknown>;
  warnings: string[];
  canCreate?: boolean;
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
  primaryNameAttribute?: string;
  name: string;
  state?: string;
  status?: string;
  stateDisplay?: string;
  statusDisplay?: string;
  stateLabels?: Record<string, string>;
  statusLabels?: Record<string, string>;
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

export type MatchStatus = "missing" | "exact-match" | "changed" | "ambiguous" | "unsupported";

export type ArtifactMatch = {
  sourceArtifactId: string;
  status: MatchStatus;
  strategy?: string;
  score?: number;
  targetArtifactId?: string;
  targetRecordId?: string;
  differences?: string[];
  warnings: string[];
};

export type MigrationAction = "create" | "skip" | "automatically-mapped" | "manual" | "blocked" | "embedded";

export type MigrationPlanItem = ArtifactMatch & {
  action: MigrationAction;
  selected: boolean;
  createName?: string;
  dependencySourceIds: string[];
};

export type MigrationComparison = {
  source: DiscoveryResult;
  target?: DiscoveryResult;
  targetJourney?: JourneyOption;
  matches: ArtifactMatch[];
  plan: MigrationPlanItem[];
  warnings: string[];
  blockingErrors: string[];
};

export type EntityInfo = {
  logicalName: string;
  entitySetName: string;
  primaryIdAttribute: string;
  primaryNameAttribute?: string;
  displayName: string;
  kind: ArtifactKind;
  score: number;
  canCreate?: boolean;
};

export type AttributeInfo = {
  logicalName: string;
  displayName: string;
  attributeType?: string;
  targets: string[];
  isValidForCreate?: boolean;
  requiredLevel?: string;
};
