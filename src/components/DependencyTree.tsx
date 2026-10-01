import { Fragment } from "react";
import { Badge, Divider, MessageBar, MessageBarBody, Text, makeStyles } from "@fluentui/react-components";
import { TextBulletListTree20Regular } from "@fluentui/react-icons";
import type { Artifact, Dependency, DiscoveryResult } from "../discovery/types";
import { getCombinedStatusLabel } from "../discovery/statusDisplay";
import { getArtifactLabel } from "../discovery/artifactCatalog";

export { KIND_LABELS as ARTIFACT_KIND_LABELS };

type Props = {
  discovery: DiscoveryResult;
  dependenciesBySource: Map<string, Dependency[]>;
  promotedArtifactIds: Set<string>;
  collapsedNodeIds: Set<string>;
  selectedArtifactId: string;
  selectedDependencyId: string;
  onSelectArtifact: (artifactId: string) => void;
  onSelectDependency: (dependency: Dependency) => void;
  onToggleArtifact: (artifactId: string) => void;
};

const useStyles = makeStyles({
  panel: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, minHeight: 0, overflow: "hidden", padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground1)" },
  header: { position: "sticky", top: 0, zIndex: 2, flexShrink: 0, display: "flex", flexDirection: "column", gap: "2px", paddingBottom: "6px", backgroundColor: "var(--colorNeutralBackground1)" },
  headerRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" },
  title: { display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "18px", lineHeight: "24px", fontWeight: 600 },
  titleIcon: { display: "inline-flex", alignItems: "center", color: "var(--colorNeutralForeground1)" },
  description: { color: "var(--colorNeutralForeground3)" },
  scrollArea: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: "4px" },
  tree: { display: "flex", flexDirection: "column", gap: "4px", paddingLeft: "0", listStyle: "none", margin: 0 },
  item: { display: "flex", flexDirection: "column", gap: "3px" },
  row: { display: "flex", alignItems: "center", gap: "4px", width: "100%", borderRadius: "4px", padding: "2px 4px", "&:hover": { backgroundColor: "var(--colorNeutralBackground1Hover)" } },
  toggle: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "28px", flexShrink: 0, border: 0, borderRadius: "4px", color: "var(--colorNeutralForeground2)", backgroundColor: "transparent", cursor: "pointer", font: "inherit", "&:hover": { backgroundColor: "var(--colorNeutralBackground1Hover)" }, "&:disabled": { cursor: "default", opacity: 0.55 } },
  nodeTitle: { display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0, border: 0, borderRadius: "4px", padding: "6px 4px", textAlign: "left", color: "var(--colorNeutralForeground1)", backgroundColor: "transparent", cursor: "pointer", font: "inherit", "&:hover": { backgroundColor: "var(--colorNeutralBackground1Hover)" } },
  nodeTitleSelected: { backgroundColor: "var(--colorSubtleBackgroundSelected)", "&:hover": { backgroundColor: "var(--colorSubtleBackgroundSelected)" } },
  children: { borderLeft: "1px solid var(--colorNeutralStroke2)", marginLeft: "13px", paddingLeft: "8px", listStyle: "none" },
  meta: { color: "var(--colorNeutralForeground3)", fontSize: "12px", marginLeft: "auto", whiteSpace: "nowrap" },
  warningList: { display: "flex", flexDirection: "column", gap: "6px", paddingLeft: "20px" },
});

export const KIND_LABELS: Record<Artifact["kind"], string> = Object.fromEntries(
  (["journey", "journeyVersion", "journeyAction", "task", "trigger", "email", "marketingForm", "compliance", "purpose", "topic", "sender", "brandProfile", "template", "contentBlock", "segment", "asset", "team", "businessRecord", "unknown"] as Artifact["kind"][])
    .map((kind) => [kind, getArtifactLabel(kind)]),
) as Record<Artifact["kind"], string>;

export function DependencyTree({
  discovery,
  dependenciesBySource,
  promotedArtifactIds,
  collapsedNodeIds,
  selectedArtifactId,
  selectedDependencyId,
  onSelectArtifact,
  onSelectDependency,
  onToggleArtifact,
}: Props) {
  const styles = useStyles();
  const artifactById = new Map(discovery.artifacts.map((artifact) => [artifact.id, artifact]));

  const renderNode = (artifact: Artifact, ancestry: Set<string>): React.ReactNode => {
    const repeated = ancestry.has(artifact.id);
    const children = (dependenciesBySource.get(artifact.id) ?? []).filter((dependency) =>
      !(artifact.id === discovery.root.id && dependency.targetArtifactId && promotedArtifactIds.has(dependency.targetArtifactId)),
    );
    const nextAncestry = new Set(ancestry).add(artifact.id);
    const isCollapsed = collapsedNodeIds.has(artifact.id);
    const statusLabel = getCombinedStatusLabel(artifact);
    return (
      <li className={styles.item} key={artifact.id} role="treeitem" aria-selected={selectedArtifactId === artifact.id}>
        <div className={styles.row}>
          <button className={styles.toggle} type="button" aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${artifact.displayName}`} aria-expanded={!isCollapsed} disabled={!children.length} onClick={() => onToggleArtifact(artifact.id)}>
            <span aria-hidden="true">{children.length ? (isCollapsed ? "▸" : "▾") : "·"}</span>
          </button>
          <button
            className={`${styles.nodeTitle} ${selectedArtifactId === artifact.id && !selectedDependencyId ? styles.nodeTitleSelected : ""}`}
            onClick={() => onSelectArtifact(artifact.id)}
            type="button"
            aria-label={`Show details for ${KIND_LABELS[artifact.kind]} ${artifact.displayName}`}
          >
            <span>{artifact.deleted ? "Deleted in Dataverse · " : ""}{artifact.logicalName === "journey-embedded" && artifact.kind === "email" ? "Email action" : KIND_LABELS[artifact.kind]}: {artifact.displayName}</span>
            {artifact.deleted && <Badge className={styles.meta} appearance="tint" color="danger">Deleted</Badge>}
            {!artifact.deleted && artifact.logicalName !== "journey-embedded" && statusLabel && <Badge className={styles.meta} appearance="tint" color={artifact.status ? "warning" : "success"}>{statusLabel}</Badge>}
          </button>
        </div>
        {!repeated && !isCollapsed && children.length > 0 && <ul className={styles.children} role="group">
          {children.map((dependency) => {
            const target = dependency.targetArtifactId ? artifactById.get(dependency.targetArtifactId) : undefined;
            if (target) {
              if (promotedArtifactIds.has(target.id) && artifact.id !== discovery.root.id) {
                return <li key={dependency.id} className={styles.item} role="treeitem"><button className={styles.nodeTitle} onClick={() => onSelectArtifact(target.id)} type="button"><span aria-hidden="true">↗</span><span>{dependency.label}: {target.displayName} (see root level)</span></button></li>;
              }
              if (nextAncestry.has(target.id)) {
                return <li key={dependency.id} className={styles.item} role="treeitem"><button className={styles.nodeTitle} onClick={() => onSelectArtifact(target.id)} type="button">↪ {dependency.label}: {target.displayName} (already in path)</button></li>;
              }
              return <Fragment key={dependency.id}>{renderNode(target, nextAncestry)}</Fragment>;
            }
            return <li key={dependency.id} className={styles.item} role="treeitem">
              <button className={styles.nodeTitle} onClick={() => onSelectDependency(dependency)} type="button">
                <span aria-hidden="true">⚠</span>
                <span>{dependency.label}: {dependency.targetLogicalName ?? "Unknown reference"}</span>
                <span className={styles.meta}>{dependency.targetRecordId?.slice(0, 8)}</span>
              </button>
            </li>;
          })}
        </ul>}
      </li>
    );
  };

  const rootArtifacts = discovery.artifacts.filter((artifact) => promotedArtifactIds.has(artifact.id));

  return <section className={styles.panel} aria-labelledby="dependency-tree-title">
    <header className={styles.header}>
      <div className={styles.headerRow}>
        <div id="dependency-tree-title" className={styles.title}>
          <span className={styles.titleIcon} aria-hidden="true"><TextBulletListTree20Regular /></span>
          <span>Dependency tree</span>
        </div>
        <Text size={200} className={styles.description}>{discovery.artifacts.length} objects · {discovery.dependencies.length} references</Text>
      </div>
      <Divider />
    </header>
    <div className={styles.scrollArea}>
      <ul className={styles.tree} role="tree" aria-label="Journey dependency tree">
        {renderNode(discovery.root, new Set())}
        {rootArtifacts.map((artifact) => renderNode(artifact, new Set()))}
      </ul>
      {discovery.warnings.map((warning) => <MessageBar key={warning} intent="warning"><MessageBarBody>{warning}</MessageBarBody></MessageBar>)}
    </div>
  </section>;
}
