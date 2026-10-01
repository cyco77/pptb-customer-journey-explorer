import { Badge, Button, Divider, Text, makeStyles } from "@fluentui/react-components";
import { DocumentSearch20Regular } from "@fluentui/react-icons";
import type { Artifact, Dependency, DiscoveryResult } from "../discovery/types";
import { getArtifactLabel } from "../discovery/artifactCatalog";
import { getCombinedStatusLabel } from "../discovery/statusDisplay";
import { getActionTargetEntity } from "../discovery/journeyMappings";
import type { SourceDialogContent } from "./SourceTextDialog";
import { isHtmlSource } from "./SourceTextDialog";

export type ArtifactAttributeView = {
  key: string;
  label: string;
  value: string;
  sourceText?: string;
  sourceIsHtml: boolean;
};

export function getArtifactAttributeViews(discovery: DiscoveryResult | null, artifact?: Artifact): ArtifactAttributeView[] {
  if (!discovery || !artifact) return [];
  const record = artifact.sourceRecord;
  const primaryId = `${artifact.logicalName}id`.toLowerCase();
  const formattedLookupFields = Object.entries(record).flatMap(([key, value]) => {
    const match = key.match(/^_(.+)_value@OData\.Community\.Display\.V1\.FormattedValue$/i);
    return match && typeof value === "string" && value.trim() ? [[match[1].toLowerCase(), value] as [string, unknown]] : [];
  });
  const formattedLookupNames = new Set(formattedLookupFields.map(([key]) => key));
  const resolvedLookupFields = discovery.dependencies.flatMap((dependency) => {
    if (dependency.sourceArtifactId !== artifact.id || dependency.relationType !== "lookup" || !dependency.targetArtifactId || !dependency.targetRecordId) return [];
    const target = discovery.artifacts.find((item) => item.id === dependency.targetArtifactId);
    if (!target) return [];
    const lookupEntry = Object.entries(record).find(([key, value]) => /^_.*_value$/i.test(key) && typeof value === "string" && value.toLowerCase() === dependency.targetRecordId!.toLowerCase());
    if (!lookupEntry) return [];
    const key = lookupEntry[0].replace(/^_/, "").replace(/_value$/i, "").toLowerCase();
    return formattedLookupNames.has(key) ? [] : [[key, target.displayName] as [string, unknown]];
  });
  const scalarFields = Object.entries(record).filter(([key, value]) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("@") || lowerKey === primaryId || /^_.*_value$/i.test(key)) return false;
    if (/(?:name|yominame)$/.test(lowerKey) || /^(?:statecode|statuscode)$/.test(lowerKey)) return false;
    if (/^(?:createdby|modifiedby|createdonbehalfby|modifiedonbehalfby|ownerid|owningbusinessunit|owningteam|owninguser)/i.test(key)) return false;
    if (formattedLookupNames.has(lowerKey)) return false;
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }).map(([key, value]) => [key, value] as [string, unknown]);

  return [...scalarFields, ...formattedLookupFields, ...resolvedLookupFields].slice(0, 60).map(([key, value]) => {
    const friendlyKey = key.replace(/^_/, "").replace(/_value$/, "").toLowerCase();
    return {
      key,
      label: artifact.fieldDisplayNames?.[friendlyKey] ?? humanizeFieldName(friendlyKey),
      value: formatRecordFieldValue(value, key, record, artifact) ?? "—",
      sourceText: typeof value === "string" && (isJsonOrHtmlField(key, value) || artifact.fieldTypes?.[friendlyKey] === "Memo" || (value.includes("\n") && value.length > 160))
        ? typeof value === "string" ? value : JSON.stringify(value, null, 2)
        : undefined,
      sourceIsHtml: typeof value === "string" && isJsonOrHtmlField(key, value) && isHtmlSource(value),
    };
  }).sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) || left.key.localeCompare(right.key));
}

type Props = {
  discovery: DiscoveryResult;
  selectedArtifact?: Artifact;
  selectedDependency?: Dependency;
  attributes: ArtifactAttributeView[];
  incoming: Dependency[];
  outgoing: Dependency[];
  embeddedCondition?: string;
  embeddedAction?: Record<string, unknown>;
  actionMappings: Array<{ field: string; value: string }>;
  onOpenArtifact: (artifact: Artifact) => void;
  onOpenDependency: (dependency: Dependency) => void;
  onOpenSource: (content: SourceDialogContent) => void;
  onSelectArtifact: (artifactId: string) => void;
  onSelectDependency: (dependencyId: string) => void;
};

const useStyles = makeStyles({
  panel: { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0, minHeight: 0, overflow: "hidden", padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground1)" },
  header: { position: "sticky", top: 0, zIndex: 2, flexShrink: 0, display: "flex", flexDirection: "column", gap: "2px", paddingBottom: "6px", backgroundColor: "var(--colorNeutralBackground1)" },
  title: { display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "18px", lineHeight: "24px", fontWeight: 600 },
  titleIcon: { display: "inline-flex", alignItems: "center", color: "var(--colorNeutralForeground1)" },
  description: { color: "var(--colorNeutralForeground3)" },
  body: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" },
  details: { display: "flex", flexDirection: "column", gap: "12px" },
  recordHeader: { flexShrink: 0, minWidth: 0, margin: "0 1px 10px", padding: "14px", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground2)" },
  heroRow: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start", gap: "12px" },
  heroIdentity: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  heroTitle: { fontSize: "20px", lineHeight: "26px", fontWeight: 600, overflowWrap: "anywhere" },
  heroAside: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", minWidth: 0 },
  badges: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px", flexWrap: "wrap" },
  actions: { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap", "& button": { height: "36px" } },
  section: { display: "flex", flexDirection: "column", gap: "8px" },
  sectionTitle: { paddingTop: "4px" },
  list: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", "@media (max-width: 1100px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
  card: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0, padding: "9px 10px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground1)" },
  value: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
  key: { color: "var(--colorNeutralForeground3)" },
  disclosure: { border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", padding: "10px", "& > summary": { cursor: "pointer", fontWeight: 600, color: "var(--colorNeutralForeground1)" } },
  disclosureBody: { paddingTop: "10px" },
  fieldCell: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px" },
  fieldPreview: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
  attributeTable: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", "& th, & td": { padding: "8px 10px", borderBottom: "1px solid var(--colorNeutralStroke2)", textAlign: "left", verticalAlign: "top" }, "& th": { width: "38%", color: "var(--colorNeutralForeground3)", fontWeight: 400 }, "& td": { overflowWrap: "anywhere", whiteSpace: "pre-wrap" }, "& tr:last-child th, & tr:last-child td": { borderBottom: 0 } },
  technicalValue: { fontFamily: "monospace", fontSize: "12px", userSelect: "all" },
  relatedList: { display: "flex", flexDirection: "column", gap: "4px" },
  relatedButton: { display: "flex", alignItems: "center", gap: "8px", width: "100%", border: 0, borderRadius: "4px", padding: "7px 8px", textAlign: "left", color: "var(--colorNeutralForeground1)", backgroundColor: "var(--colorNeutralBackground2)", cursor: "pointer", font: "inherit", "&:hover": { backgroundColor: "var(--colorNeutralBackground2Hover)" } },
  relatedLabel: { flex: 1, minWidth: 0 },
  warningList: { display: "flex", flexDirection: "column", gap: "6px", paddingLeft: "20px" },
  empty: { display: "flex", flex: 1, alignItems: "center", justifyContent: "center", textAlign: "center", padding: "36px", color: "var(--colorNeutralForeground3)" },
});

function getKindLabel(kind: Artifact["kind"]): string {
  return getArtifactLabel(kind);
}

export function ArtifactDetails({
  discovery,
  selectedArtifact,
  selectedDependency,
  attributes,
  incoming,
  outgoing,
  embeddedCondition,
  embeddedAction,
  actionMappings,
  onOpenArtifact,
  onOpenDependency,
  onOpenSource,
  onSelectArtifact,
  onSelectDependency,
}: Props) {
  const styles = useStyles();
  const artifactsById = new Map(discovery.artifacts.map((artifact) => [artifact.id, artifact]));

  const renderDependencyDetails = (dependency: Dependency) => <div className={styles.details}>
    <div className={styles.list}>
      <div className={styles.card}><Text className={styles.key}>Target table</Text><Text className={styles.value}>{dependency.targetLogicalName ?? "Unknown"}</Text></div>
      <div className={styles.card}><Text className={styles.key}>Record ID</Text><Text className={styles.value}>{dependency.targetRecordId ?? "—"}</Text></div>
      <div className={styles.card}><Text className={styles.key}>Reference path</Text><Text className={styles.value}>{dependency.path ?? "Dataverse lookup"}</Text></div>
    </div>
    {dependency.targetLogicalName && dependency.targetRecordId && <div className={styles.actions}><Button appearance="primary" onClick={() => onOpenDependency(dependency)}>Open referenced record in Dataverse</Button></div>}
    {dependency.warnings.length > 0 && <ul className={styles.warningList}>{dependency.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
  </div>;

  const renderArtifactDetails = (artifact: Artifact) => <div className={styles.details}>
    {embeddedCondition && <div className={styles.section}>
      <Text weight="semibold" className={styles.sectionTitle}>Condition</Text>
      <div className={styles.card}><Text className={styles.value}>{embeddedCondition}</Text></div>
    </div>}
    {embeddedAction && <div className={styles.section}>
      <Text weight="semibold" className={styles.sectionTitle}>Action configuration</Text>
      <div className={styles.list}>
        <div className={styles.card}><Text className={styles.key}>Action type</Text><Text className={styles.value}>{formatFieldValue(embeddedAction.type) ?? "—"}</Text></div>
        {getActionTargetEntity(embeddedAction) && <div className={styles.card}><Text className={styles.key}>Target table</Text><Text className={styles.value}>{getActionTargetEntity(embeddedAction)}</Text></div>}
      </div>
      {actionMappings.length > 0 && <>
        <Text weight="semibold">Field mappings</Text>
        <div className={styles.list}>{actionMappings.map(({ field, value }) => <div className={styles.card} key={field}>
          <Text className={styles.key}>{humanizeFieldName(field)} ({field})</Text>
          <Text className={styles.value}>{value}</Text>
        </div>)}</div>
      </>}
    </div>}
    {attributes.length > 0 && <details className={styles.disclosure} open>
      <summary>Dataverse fields ({attributes.length})</summary>
      <div className={styles.disclosureBody}><table className={styles.attributeTable}><tbody>
        {attributes.map(({ key, label, value, sourceText, sourceIsHtml }) => <tr key={key}>
          <th scope="row">{label}</th>
          <td><div className={styles.fieldCell}>
            {sourceText
              ? <Button size="small" appearance="subtle" onClick={() => onOpenSource({ label, originalText: sourceText, isHtml: sourceIsHtml })}>{sourceIsHtml ? "Open JSON / HTML" : "Open text"}</Button>
              : <Text className={styles.fieldPreview}>{value}</Text>}
          </div></td>
        </tr>)}
      </tbody></table></div>
    </details>}
    {(outgoing.length > 0 || incoming.length > 0) && <details className={styles.disclosure} open>
      <summary>Dependency relationships ({outgoing.length + incoming.length})</summary>
      <div className={styles.disclosureBody}><div className={styles.relatedList}>
        {outgoing.map((dependency) => {
          const target = dependency.targetArtifactId ? artifactsById.get(dependency.targetArtifactId) : undefined;
          return <button className={styles.relatedButton} type="button" key={`out:${dependency.id}`} onClick={() => target ? onSelectArtifact(target.id) : onSelectDependency(dependency.id)}>
            <span aria-hidden="true">↳</span>
            <Text className={styles.relatedLabel}>{dependency.label}: {target?.displayName ?? dependency.targetLogicalName ?? "Unresolved reference"}</Text>
            <Text size={200}>{target?.entityDisplayName ?? (target ? getKindLabel(target.kind) : "Unresolved")}</Text>
          </button>;
        })}
        {incoming.map((dependency) => {
          const source = artifactsById.get(dependency.sourceArtifactId);
          return <button className={styles.relatedButton} type="button" key={`in:${dependency.id}`} onClick={() => source && onSelectArtifact(source.id)}>
            <span aria-hidden="true">↰</span>
            <Text className={styles.relatedLabel}>{dependency.label}: {source?.displayName ?? dependency.sourceArtifactId}</Text>
            <Text size={200}>Referenced by</Text>
          </button>;
        })}
      </div></div>
    </details>}
    <details className={styles.disclosure}>
      <summary>Technical details</summary>
      <div className={styles.disclosureBody}><div className={styles.list}>
        <div className={styles.card}><Text className={styles.key}>Logical name</Text><Text className={styles.technicalValue}>{artifact.logicalName}</Text></div>
        <div className={styles.card}><Text className={styles.key}>Record ID</Text><Text className={styles.technicalValue}>{artifact.recordId}</Text></div>
        <div className={styles.card}><Text className={styles.key}>Entity set</Text><Text className={styles.technicalValue}>{artifact.entitySetName || "—"}</Text></div>
        <div className={styles.card}><Text className={styles.key}>Version</Text><Text className={styles.value}>{artifact.version ?? "—"}</Text></div>
        <div className={styles.card}><Text className={styles.key}>Related records</Text><Text className={styles.value}>{outgoing.length} outgoing · {incoming.length} incoming</Text></div>
        <div className={styles.card}><Text className={styles.key}>Discovered</Text><Text className={styles.value}>{new Date(discovery.discoveredAt).toLocaleString()}</Text></div>
      </div></div>
    </details>
    {artifact.warnings.length > 0 && <ul className={styles.warningList}>{artifact.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
  </div>;

  return <section className={styles.panel} aria-labelledby="object-details-title">
    <header className={styles.header}>
      <div id="object-details-title" className={styles.title}><span className={styles.titleIcon} aria-hidden="true"><DocumentSearch20Regular /></span><span>Object details</span></div>
      <Divider />
    </header>
    {selectedDependency ? <div className={styles.recordHeader}>
      <div className={styles.heroRow}>
        <Text className={styles.heroTitle}>{selectedDependency.label}</Text>
        <div className={styles.heroAside}><div className={styles.badges}><Badge appearance="tint" color={selectedDependency.targetDeleted ? "danger" : "warning"}>{selectedDependency.targetDeleted ? "Deleted in Dataverse" : "Unresolved reference"}</Badge></div></div>
      </div>
    </div> : selectedArtifact ? <div className={styles.recordHeader}>
      <div className={styles.heroRow}>
        <div className={styles.heroIdentity}><Text className={styles.heroTitle}>{selectedArtifact.displayName}</Text><Text className={styles.description}>{selectedArtifact.entityDisplayName ?? selectedArtifact.logicalName}</Text></div>
        <div className={styles.heroAside}>
          <div className={styles.badges}>
            <Badge appearance="tint">{getKindLabel(selectedArtifact.kind)}</Badge>
            {selectedArtifact.deleted && <Badge appearance="tint" color="danger">Deleted in Dataverse</Badge>}
            {getCombinedStatusLabel(selectedArtifact) && <Badge appearance="tint" color={selectedArtifact.status ? "warning" : "success"}>{getCombinedStatusLabel(selectedArtifact)}</Badge>}
          </div>
          <div className={styles.actions}>{selectedArtifact.logicalName === "journey-embedded"
            ? <Button appearance="secondary" onClick={() => onOpenSource({ label: selectedArtifact.displayName, originalText: JSON.stringify(selectedArtifact.sourceRecord, null, 2) })}>Open JSON</Button>
            : <Button appearance="primary" onClick={() => onOpenArtifact(selectedArtifact)} disabled={!selectedArtifact.dataverseUrl || selectedArtifact.deleted}>Open in Dataverse</Button>}</div>
        </div>
      </div>
    </div> : null}
    <div className={styles.body}>
      {selectedDependency ? renderDependencyDetails(selectedDependency)
        : selectedArtifact ? renderArtifactDetails(selectedArtifact)
          : <div className={styles.empty}>Select an object in the tree to view its details.</div>}
    </div>
  </section>;
}

function humanizeFieldName(name: string): string {
  return name.replace(/^msdynmkt_/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatFieldValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toLocaleString();
  return undefined;
}

function formatRecordFieldValue(value: unknown, fieldName: string, record: Record<string, unknown>, artifact: Artifact): string | undefined {
  const formatted = record[`${fieldName}@OData.Community.Display.V1.FormattedValue`];
  if (typeof formatted === "string" && formatted.trim()) return typeof value === "number" ? `${formatted} (${value})` : formatted;
  if (typeof value === "number") {
    const label = artifact.optionSetLabels?.[fieldName.toLowerCase()]?.[String(value)];
    if (label) return `${label} (${value})`;
  }
  return formatFieldValue(value);
}

function isJsonOrHtmlField(key: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (/\b(json|html|content|body|definition|payload)\b/i.test(key)) return true;
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try { JSON.parse(text); } catch { /* Malformed JSON remains useful to inspect. */ }
    return true;
  }
  return /<!doctype\s+html|<\/?[a-z][\s\S]*?>/i.test(text);
}
