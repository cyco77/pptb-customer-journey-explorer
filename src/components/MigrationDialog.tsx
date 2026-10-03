import { useRef } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  Text,
  makeStyles,
} from "@fluentui/react-components";
import { ArrowRight24Regular, Dismiss20Regular, Info16Regular, Open16Regular } from "@fluentui/react-icons";
import type { Artifact, ArtifactMatch, MigrationAction, MigrationComparison } from "../discovery/types";
import { getArtifactLabel } from "../discovery/artifactCatalog";
import type { TransferProgress, TransferResult } from "../migration/transferService";

type Props = {
  comparison: MigrationComparison | null;
  isComparing: boolean;
  comparisonProgress: string;
  sourceEnvironment: string;
  targetEnvironment: string;
  targetCandidates: Record<string, Artifact[]>;
  loadingTargetId: string | null;
  migrationPreviewStarted: boolean;
  isTransferring: boolean;
  transferResult: TransferResult | null;
  transferLog: TransferProgress[];
  transferFatalError: string | null;
  canSelectPlanItem: (item: MigrationComparison["plan"][number]) => boolean;
  onClose: () => void;
  onActionChange: (sourceArtifactId: string, action: MigrationAction) => void;
  onTargetSelect: (sourceArtifactId: string, target: Artifact) => void;
  onTargetOpen: (artifact: Artifact) => void;
  onLoadTargetCandidates: (sourceArtifactId: string) => void;
  onPlanSelectionChange: (sourceArtifactId: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onCreateNameChange: (sourceArtifactId: string, name: string) => void;
  onMigratedTargetOpen: (artifact: Artifact, targetId: string) => void;
  onStartMigration: () => void;
  onReturnToDefinition: () => void;
};

const useStyles = makeStyles({
  surface: { display: "flex", flexDirection: "column", width: "min(1400px, calc(100vw - 48px))", maxWidth: "1400px", height: "min(900px, calc(100vh - 48px))", maxHeight: "calc(100vh - 48px)", overflow: "visible" },
  body: { display: "flex", flexDirection: "column", flex: "1 1 auto", alignSelf: "stretch", width: "100%", minHeight: 0, overflow: "hidden", boxSizing: "border-box" },
  titleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexShrink: 0 },
  closeButton: { flexShrink: 0 },
  header: { flexShrink: 0 },
  content: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: "4px" },
  actions: { position: "relative", zIndex: 2, display: "flex", justifyContent: "flex-end", gap: "8px", flex: "0 0 auto", marginTop: "0", paddingTop: "12px", borderTop: "1px solid var(--colorNeutralStroke2)", backgroundColor: "var(--colorNeutralBackground1)" },
  loading: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", padding: "12px 14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground2)" },
  loadingCopy: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  loadingTitle: { fontWeight: 600 },
  loadingDetail: { color: "var(--colorNeutralForeground2)", overflowWrap: "anywhere" },
  dropdown: { width: "100%", minWidth: 0, "& .fui-Dropdown__button": { display: "block", position: "relative", height: "32px", minHeight: "32px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "30px" }, "& .fui-Dropdown__expandIcon": { position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)" } },
  targetCell: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  targetDropdown: { flex: 1, minWidth: 0 },
  openTarget: { flexShrink: 0, minWidth: "32px", width: "32px", height: "32px", minHeight: "32px", padding: 0 },
  nameInput: { width: "100%", minWidth: 0, height: "32px", minHeight: "32px" },
  targetListbox: { minWidth: "min(520px, calc(100vw - 64px))", maxWidth: "min(620px, calc(100vw - 64px))", maxHeight: "320px", overflowY: "auto", "& [role=option]": { boxSizing: "border-box", flexShrink: 0, height: "32px", minHeight: "32px", maxHeight: "32px", overflow: "hidden" } },
  optionText: { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cellText: { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  status: { display: "flex", alignItems: "center", minWidth: 0, whiteSpace: "nowrap", "& > span:first-child": { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
  environments: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: "16px", marginBottom: "12px", "@media (max-width: 640px)": { gridTemplateColumns: "1fr", gap: "6px" } },
  environment: { minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  environmentLabel: { color: "var(--colorNeutralForeground3)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" },
  environmentValue: { overflowWrap: "anywhere" },
  arrow: { display: "flex", alignItems: "center", justifyContent: "center", color: "var(--colorNeutralForeground3)", "@media (max-width: 640px)": { transform: "rotate(90deg)" } },
  summary: { display: "flex", gap: "10px", rowGap: "8px", flexWrap: "wrap", marginBottom: "12px" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", "& th, & td": { boxSizing: "border-box", padding: "8px", borderBottom: "1px solid var(--colorNeutralStroke2)", textAlign: "left", verticalAlign: "middle" }, "& th": { position: "sticky", top: 0, zIndex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--colorNeutralForeground3)", fontWeight: 600, backgroundColor: "var(--colorNeutralBackground1)", boxShadow: "0 1px 0 var(--colorNeutralStroke2)" }, "& th:nth-child(1), & td:nth-child(1)": { width: "40px", paddingLeft: "6px", paddingRight: "4px" }, "& th:nth-child(2), & td:nth-child(2)": { width: "12%" }, "& th:nth-child(3), & td:nth-child(3)": { width: "22%" }, "& th:nth-child(4), & td:nth-child(4)": { width: "13%" }, "& th:nth-child(5), & td:nth-child(5)": { width: "20%" }, "& th:nth-child(6), & td:nth-child(6)": { width: "29%" } },
  hint: { display: "inline-flex", alignItems: "center", marginLeft: "6px", color: "var(--colorNeutralForeground3)", verticalAlign: "middle", cursor: "help" },
  actionText: { display: "inline-flex", alignItems: "center", minHeight: "32px", color: "var(--colorNeutralForeground2)" },
  transferLog: { display: "flex", flexDirection: "column", gap: "8px", padding: "10px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground2)" },
  transferEntry: { display: "grid", gridTemplateColumns: "76px minmax(0, 1fr) auto", gap: "8px", alignItems: "start", fontSize: "13px" },
  transferError: { gridColumn: "2", color: "var(--colorPaletteRedForeground1)", overflowWrap: "anywhere" },
});

const KIND_LABELS: Record<Artifact["kind"], string> = {
  journey: getArtifactLabel("journey"), journeyVersion: getArtifactLabel("journeyVersion"), journeyAction: getArtifactLabel("journeyAction"),
  task: getArtifactLabel("task"), trigger: getArtifactLabel("trigger"), email: getArtifactLabel("email"), marketingForm: getArtifactLabel("marketingForm"),
  compliance: getArtifactLabel("compliance"), purpose: getArtifactLabel("purpose"), topic: getArtifactLabel("topic"), sender: getArtifactLabel("sender"),
  brandProfile: getArtifactLabel("brandProfile"), template: getArtifactLabel("template"), contentBlock: getArtifactLabel("contentBlock"), segment: getArtifactLabel("segment"),
  asset: getArtifactLabel("asset"), team: getArtifactLabel("team"), businessRecord: getArtifactLabel("businessRecord"), unknown: getArtifactLabel("unknown"),
};

const ACTION_LABELS: Record<MigrationAction, string> = {
  create: "Create", skip: "Skip", "automatically-mapped": "Automatically mapped", manual: "Manual mapping",
  blocked: "Blocked", embedded: "Included in Journey JSON",
};

function matchLabel(match: ArtifactMatch): string {
  return {
    missing: "Missing", "exact-match": "Already exists", changed: "Changed", ambiguous: "Ambiguous", unsupported: "Embedded node",
  }[match.status];
}

function matchColor(match: ArtifactMatch): "success" | "warning" | "danger" | "informative" | "subtle" {
  const colors: Record<ArtifactMatch["status"], "success" | "warning" | "danger" | "informative" | "subtle"> = {
    missing: "warning", "exact-match": "success", changed: "danger", ambiguous: "danger", unsupported: "subtle",
  };
  return colors[match.status];
}

export function MigrationDialog({
  comparison,
  isComparing,
  comparisonProgress,
  sourceEnvironment,
  targetEnvironment,
  targetCandidates,
  loadingTargetId,
  migrationPreviewStarted,
  isTransferring,
  transferResult,
  transferLog,
  transferFatalError,
  canSelectPlanItem,
  onClose,
  onActionChange,
  onTargetSelect,
  onTargetOpen,
  onLoadTargetCandidates,
  onPlanSelectionChange,
  onToggleAll,
  onCreateNameChange,
  onMigratedTargetOpen,
  onStartMigration,
  onReturnToDefinition,
}: Props) {
  const styles = useStyles();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const isOpen = comparison !== null || isComparing;
  const completedSuccessfully = Boolean(transferResult && transferResult.failed.length === 0);

  const renderPlanRow = (match: MigrationComparison["plan"][number]) => {
    if (!comparison) return null;
    const artifact = comparison.source.artifacts.find((item) => item.id === match.sourceArtifactId);
    const selected = match.targetArtifactId ? comparison.target?.artifacts.find((item) => item.id === match.targetArtifactId) : undefined;
    const mappedTarget = selected ?? (artifact && match.targetRecordId ? {
      id: match.targetArtifactId ?? `${artifact.logicalName.toLowerCase()}:${match.targetRecordId.toLowerCase()}`,
      kind: artifact.kind,
      logicalName: artifact.logicalName,
      entitySetName: artifact.entitySetName,
      primaryIdAttribute: artifact.primaryIdAttribute,
      primaryNameAttribute: artifact.primaryNameAttribute,
      recordId: match.targetRecordId,
      displayName: artifact.displayName,
      sourceRecord: {},
      warnings: [],
    } satisfies Artifact : undefined);
    const options = new Map<string, Artifact>();
    if (selected) options.set(selected.id, selected);
    for (const candidate of targetCandidates[match.sourceArtifactId] ?? []) options.set(candidate.id, candidate);
    const sortedOptions = [...options.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) || left.recordId.localeCompare(right.recordId));
    const selectedLabel = mappedTarget ? `${mappedTarget.displayName} (${mappedTarget.recordId})` : "";
    const matchingErrors = comparison.blockingErrors.filter((error) => error.startsWith(`${match.sourceArtifactId}:`));

    return (
      <tr key={match.sourceArtifactId}>
        <td><Checkbox checked={match.selected} disabled={!canSelectPlanItem(match)} onChange={(_event, data) => onPlanSelectionChange(match.sourceArtifactId, Boolean(data.checked))} aria-label={`Include ${artifact?.displayName ?? match.sourceArtifactId}`} /></td>
        <td><span className={styles.cellText} title={artifact ? KIND_LABELS[artifact.kind] : "Unknown"}>{artifact ? KIND_LABELS[artifact.kind] : "Unknown"}</span></td>
        <td><span className={styles.cellText} title={artifact?.displayName ?? match.sourceArtifactId}>{artifact?.displayName ?? match.sourceArtifactId}</span></td>
        <td><div className={styles.status}>
          <Badge color={matchColor(match)} title={matchLabel(match)}>{matchLabel(match)}</Badge>
          {[...match.warnings, ...matchingErrors].map((warning) => <span key={warning} className={styles.hint} title={warning} aria-label={warning}><Info16Regular /></span>)}
        </div></td>
        <td>{match.action === "embedded"
          ? <span className={`${styles.actionText} ${styles.cellText}`} title="Included in Journey JSON">Included in Journey JSON</span>
          : <Dropdown
              className={styles.dropdown}
              mountNode={surfaceRef.current}
              value={ACTION_LABELS[match.action]}
              title={ACTION_LABELS[match.action]}
              selectedOptions={[match.action]}
              onOptionSelect={(_event, data) => onActionChange(match.sourceArtifactId, (data.optionValue ?? "skip") as MigrationAction)}
              aria-label={`Action for ${artifact?.displayName ?? match.sourceArtifactId}`}
            >
              <Option value="create" text="Create" disabled={match.status === "unsupported"}>Create</Option>
              <Option value="skip" text="Skip">Skip</Option>
              <Option value="automatically-mapped" text="Automatically mapped" disabled={artifact?.kind === "journey"}>Automatically mapped</Option>
              <Option value="manual" text="Manual mapping">Manual mapping</Option>
            </Dropdown>}
        </td>
        <td>
          {artifact && match.action === "create" && <Input
            className={styles.nameInput}
            value={match.createName ?? artifact.displayName}
            title={match.createName ?? artifact.displayName}
            aria-label={`Target name for ${artifact.displayName}`}
            onChange={(_event, data) => onCreateNameChange(match.sourceArtifactId, data.value)}
          />}
          {artifact && match.action !== "embedded" && match.action !== "create" && match.action !== "skip" && match.action !== "blocked" && <div className={styles.targetCell}>
            <Dropdown
              className={`${styles.dropdown} ${styles.targetDropdown}`}
              mountNode={surfaceRef.current}
              listbox={{ className: styles.targetListbox }}
              positioning={{ position: "below", align: "end" }}
              placeholder={loadingTargetId === match.sourceArtifactId ? "Loading…" : "Select target record"}
              value={selectedLabel}
              title={selectedLabel || (loadingTargetId === match.sourceArtifactId ? "Loading target records…" : "Select target record")}
              selectedOptions={mappedTarget ? [mappedTarget.id] : []}
              onOpenChange={(_event, data) => { if (data.open) onLoadTargetCandidates(match.sourceArtifactId); }}
              onOptionSelect={(_event, data) => {
                const target = options.get(data.optionValue ?? "");
                if (target) onTargetSelect(match.sourceArtifactId, target);
              }}
              aria-label={`Target record for ${artifact.displayName}`}
            >
              {sortedOptions.map((candidate) => <Option key={candidate.id} value={candidate.id} text={`${candidate.displayName} (${candidate.recordId})`} title={`${candidate.displayName} (${candidate.recordId})`}>
                <span className={styles.optionText}>{candidate.displayName} ({candidate.recordId})</span>
              </Option>)}
              {!options.size && <Option value="no-target-records" disabled>{loadingTargetId === match.sourceArtifactId ? "Loading target records…" : "No target records found"}</Option>}
            </Dropdown>
            {mappedTarget && <Button
              className={styles.openTarget}
              appearance="subtle"
              icon={<Open16Regular />}
              title={`Open ${mappedTarget.displayName} in Dataverse`}
              aria-label={`Open target record for ${artifact.displayName} in Dataverse`}
              onClick={() => onTargetOpen(mappedTarget)}
            />}
          </div>}
        </td>
      </tr>
    );
  };

  const selectedItems = comparison?.plan.filter(canSelectPlanItem) ?? [];
  const canStart = Boolean(comparison?.plan.some((item) => item.selected && item.action === "create")) &&
    !comparison?.plan.some((item) => item.selected && item.action !== "skip" && (item.action === "manual" || item.action === "automatically-mapped") && !item.targetRecordId);

  return (
    <Dialog open={isOpen} onOpenChange={(_event, data) => { if (!data.open && !isComparing) onClose(); }}>
      <DialogSurface ref={surfaceRef} className={styles.surface}>
        <DialogBody className={styles.body}>
          <div className={styles.titleRow}>
            <DialogTitle>Target comparison</DialogTitle>
            <Button
              className={styles.closeButton}
              appearance="subtle"
              size="small"
              icon={<Dismiss20Regular />}
              aria-label="Close dialog"
              title="Close"
              disabled={isTransferring || isComparing}
              onClick={onClose}
            />
          </div>
          <div className={styles.header}>
            <div className={styles.environments}>
              <div className={styles.environment}><Text className={styles.environmentLabel}>Source</Text><Text className={styles.environmentValue}>{sourceEnvironment}</Text></div>
              <div className={styles.arrow} aria-hidden="true"><ArrowRight24Regular /></div>
              <div className={styles.environment}><Text className={styles.environmentLabel}>Target</Text><Text className={styles.environmentValue}>{targetEnvironment}</Text></div>
            </div>
            {isComparing && <div className={styles.loading} role="status" aria-live="polite">
              <Spinner size="tiny" label="Loading target comparison" />
              <div className={styles.loadingCopy}><Text className={styles.loadingTitle}>Comparing target</Text><Text className={styles.loadingDetail}>{comparisonProgress || "Loading target artifacts…"}</Text></div>
            </div>}
            {comparison && <>
              <div className={styles.summary}>
                <Badge color="success">Already exists: {comparison.matches.filter((match) => match.status === "exact-match").length}</Badge>
                <Badge color="warning">Missing: {comparison.matches.filter((match) => match.status === "missing").length}</Badge>
                <Badge color="danger">Changed: {comparison.matches.filter((match) => match.status === "changed").length}</Badge>
                <Badge color="danger">Ambiguous: {comparison.matches.filter((match) => match.status === "ambiguous").length}</Badge>
                <Badge color="informative">Planned creates: {comparison.plan.filter((item) => item.selected && item.action === "create").length}</Badge>
              </div>
              <MessageBar intent="info"><MessageBarBody><MessageBarTitle>Create-only migration</MessageBarTitle>Missing elements are selected for creation. Existing elements are skipped and never updated. Embedded nodes are written as part of the Journey JSON.</MessageBarBody></MessageBar>
            </>}
          </div>
          <DialogContent className={styles.content}>
            {comparison && <>
              {migrationPreviewStarted && <MessageBar intent="success"><MessageBarBody><MessageBarTitle>Preview prepared</MessageBarTitle>The migration plan was copied to the clipboard. Dataverse was not changed.</MessageBarBody></MessageBar>}
              {isTransferring || transferResult || transferFatalError
                ? <div className={styles.transferLog} role="log" aria-live="polite">
                    <Text weight="semibold">Migration log</Text>
                    {transferLog.map((entry, index) => {
                      const targetId = entry.targetId ?? transferResult?.created.find((item) => item.sourceArtifactId === entry.artifact.id)?.targetId;
                      const message = entry.message ?? `${entry.artifact.displayName}: ${entry.status}`;
                      return <div className={styles.transferEntry} key={`${entry.artifact.id}:${index}`}>
                        <Badge color={entry.status === "failed" ? "danger" : entry.status === "created" ? "success" : "informative"}>{entry.status}</Badge>
                        <Text>{KIND_LABELS[entry.artifact.kind]}: {message}</Text>
                        {targetId && <Button size="small" appearance="subtle" icon={<Open16Regular />} title={`Open target ${KIND_LABELS[entry.artifact.kind]} ${entry.artifact.displayName}`} aria-label={`Open target ${KIND_LABELS[entry.artifact.kind]} ${entry.artifact.displayName} in Dataverse`} onClick={() => onMigratedTargetOpen(entry.artifact, targetId)} />}
                        {entry.error && <Text className={styles.transferError}>{entry.error}</Text>}
                      </div>;
                    })}
                    {transferResult && <Text>Migration result: {transferResult.created.length} created, {transferResult.skipped.length} skipped, {transferResult.failed.length} failed.</Text>}
                    {transferFatalError && <MessageBar intent="error"><MessageBarBody><MessageBarTitle>Migration stopped</MessageBarTitle>{transferFatalError}</MessageBarBody></MessageBar>}
                  </div>
                : <>
                    {comparison.warnings.map((warning) => <MessageBar key={warning} intent="warning"><MessageBarBody>{warning}</MessageBarBody></MessageBar>)}
                    <table className={styles.table}>
                      <thead><tr>
                        <th><Checkbox checked={selectedItems.length > 0 && selectedItems.every((item) => item.selected)} onChange={(_event, data) => onToggleAll(Boolean(data.checked))} aria-label="Select all migratable elements" /></th>
                        <th title="Type">Type</th><th title="Element">Element</th><th title="Target status">Target status</th><th title="Planned action">Planned action</th><th title="Target record">Target record</th>
                      </tr></thead>
                      <tbody>{comparison.plan.map(renderPlanRow)}</tbody>
                    </table>
                  </>}
            </>}
          </DialogContent>
          <DialogActions className={styles.actions}>
            <Button appearance="secondary" onClick={onClose} disabled={isTransferring}>Close</Button>
            {(Boolean(transferFatalError) || Boolean(transferResult?.failed.length))
              ? <Button appearance="primary" onClick={onReturnToDefinition}>Zurück zur Definition</Button>
              : completedSuccessfully ? null : <Button appearance="primary" disabled={isTransferring || !canStart} onClick={onStartMigration}>{isTransferring ? "Migrating…" : "Start migration"}</Button>}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
