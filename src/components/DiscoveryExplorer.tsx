import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Dropdown,
  Field,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  makeStyles,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  Text,
} from "@fluentui/react-components";
import { MoreHorizontal24Filled } from "@fluentui/react-icons";
import type { Artifact, ArtifactMatch, Dependency, DiscoveryResult, JourneyOption, MigrationComparison, MigrationAction } from "../discovery/types";
import type { TransferProgress, TransferResult } from "../migration/transferService";
import { executeCreateOnlyTransfer } from "../migration/transferService";
import { discoverJourney, loadJourneys } from "../discovery/discoveryService";
import { discoverArtifactsByIdentity } from "../discovery/targetArtifactDiscovery";
import { compareJourney } from "../discovery/comparisonService";
import { createRecordUrl } from "../discovery/dataverseLinks";
import { clearDiagnostics, getDiagnosticEventName, getDiagnostics, logDiagnostic } from "../discovery/diagnostics";
import { getActionFieldMappings } from "../discovery/journeyMappings";
import { getJourneyCondition } from "../discovery/journeyConditions";
import { getCombinedStatusLabel } from "../discovery/statusDisplay";
import { createSemanticTargetOverrides } from "../discovery/targetOverrides";
import { buildDependencyTree } from "../discovery/dependencyTree";
import { buildJourneyMarkdown } from "../utils/journeyMarkdownExport";
import { SourceTextDialog, type SourceDialogContent } from "./SourceTextDialog";
import { ArtifactDetails, getArtifactAttributeViews } from "./ArtifactDetails";
import { DependencyTree } from "./DependencyTree";
import { MigrationDialog } from "./MigrationDialog";

type Props = {
  connection: ToolBoxAPI.Connection | null;
  isLoadingConnection: boolean;
  connectionRevision: number;
  migrationEnabled: boolean;
};

const useStyles = makeStyles({
  root: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: "16px" },
  controls: { display: "flex", alignItems: "end", gap: "12px", flexWrap: "wrap", padding: "0" },
  selectGroup: { display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: "260px" },
  statusSelectGroup: { display: "flex", flexDirection: "column", gap: "4px", flex: "0 1 220px", minWidth: "180px" },
  controlDropdown: { width: "100%", minWidth: 0 },
  journeyOption: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", width: "100%", minWidth: 0 },
  journeyOptionName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  journeyOptionStatus: { flexShrink: 0 },
  optionsMenu: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginLeft: "8px" },
  optionsMenuTrigger: { flexShrink: 0, width: "36px", minWidth: "36px", height: "32px", minHeight: "32px", padding: 0 },
  workspace: { display: "grid", gridTemplateColumns: "minmax(280px, 0.9fr) minmax(320px, 1.1fr)", gridTemplateRows: "minmax(0, 1fr)", alignItems: "stretch", gap: "16px", flex: 1, minHeight: 0, "@media (max-width: 800px)": { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "auto auto", overflow: "auto" } },
  panel: { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0, minHeight: 0, overflow: "hidden", padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground1)" },
  empty: { display: "flex", flex: 1, alignItems: "center", justifyContent: "center", textAlign: "center", padding: "36px", color: "var(--colorNeutralForeground3)" },
  toolbar: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
});

export function DiscoveryExplorer({ connection, isLoadingConnection, connectionRevision, migrationEnabled }: Props) {
  const styles = useStyles();
  const [journeys, setJourneys] = useState<JourneyOption[]>([]);
  const [selectedJourneyId, setSelectedJourneyId] = useState("");
  const [selectedJourneyStatus, setSelectedJourneyStatus] = useState("all");
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [selectedDependencyId, setSelectedDependencyId] = useState("");
  const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [isLoadingJourneys, setIsLoadingJourneys] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticCount, setDiagnosticCount] = useState(() => getDiagnostics().length);
  const [sourceDialog, setSourceDialog] = useState<SourceDialogContent | null>(null);
  const [secondaryConnection, setSecondaryConnection] = useState<ToolBoxAPI.Connection | null>(null);
  const [isLoadingSecondaryConnection, setIsLoadingSecondaryConnection] = useState(true);
  const [comparison, setComparison] = useState<MigrationComparison | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonProgress, setComparisonProgress] = useState("");
  const [targetCandidates, setTargetCandidates] = useState<Record<string, Artifact[]>>({});
  const [loadingTargetId, setLoadingTargetId] = useState<string | null>(null);
  const targetRequestId = useRef(0);
  const [migrationPreviewStarted, setMigrationPreviewStarted] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null);
  const [transferLog, setTransferLog] = useState<TransferProgress[]>([]);
  const [transferFatalError, setTransferFatalError] = useState<string | null>(null);
  const journeyLoadRequestId = useRef(0);
  const comparisonRequestId = useRef(0);

  const resetTransferState = () => {
    setMigrationPreviewStarted(false);
    setIsTransferring(false);
    setTransferResult(null);
    setTransferLog([]);
    setTransferFatalError(null);
  };

  const openSourceDialog = (label: string, originalText: string, isHtml?: boolean) => {
    setSourceDialog({ label, originalText, isHtml });
  };

  const returnToMigrationDefinition = () => {
    setTransferResult(null);
    setTransferLog([]);
    setTransferFatalError(null);
    setIsTransferring(false);
  };

  const openMigratedTarget = async (artifact: Artifact, targetId: string) => {
    if (!secondaryConnection?.url) return;
    const url = createRecordUrl(secondaryConnection.url, artifact.logicalName, targetId);
    if (!url) return;
    try {
      await window.toolboxAPI.utils.openInConnectionBrowser(url, "secondary");
    } catch (cause) {
      setTransferFatalError(`Could not open target ${artifact.displayName}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  useEffect(() => {
    const updateCount = () => setDiagnosticCount(getDiagnostics().length);
    const eventName = getDiagnosticEventName();
    window.addEventListener(eventName, updateCount);
    return () => window.removeEventListener(eventName, updateCount);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingSecondaryConnection(true);
    setSecondaryConnection(null);
    void window.toolboxAPI.connections.getSecondaryConnection()
      .then((target) => { if (!cancelled) setSecondaryConnection(target); })
      .catch(() => { if (!cancelled) setSecondaryConnection(null); })
      .finally(() => { if (!cancelled) setIsLoadingSecondaryConnection(false); });
    return () => { cancelled = true; };
  }, [connectionRevision]);

  const refreshJourneys = useCallback(async () => {
    const requestId = ++journeyLoadRequestId.current;
    if (!connection) {
      setJourneys([]);
      setDiscovery(null);
      setSelectedJourneyId("");
      setIsLoadingJourneys(false);
      return;
    }
    setIsLoadingJourneys(true);
    setError(null);
    setDiscovery(null);
    try {
      const result = await loadJourneys();
      if (requestId !== journeyLoadRequestId.current) return;
      setJourneys(result.journeys);
      setDiscoveryWarnings(result.warnings);
      setSelectedJourneyStatus("all");
      setSelectedJourneyId((current) => result.journeys.some((journey) => journey.id === current) ? current : "");
    } catch (cause) {
      if (requestId !== journeyLoadRequestId.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[Customer Journey Explorer] Failed to load Journey list", cause);
      setError(message);
      setJourneys([]);
    } finally {
      if (requestId === journeyLoadRequestId.current) setIsLoadingJourneys(false);
    }
  }, [connection]);

  useEffect(() => {
    journeyLoadRequestId.current += 1;
    targetRequestId.current += 1;
    comparisonRequestId.current += 1;
    setIsComparing(false);
    setJourneys([]);
    setSelectedJourneyStatus("all");
    setSelectedJourneyId("");
    setDiscovery(null);
    setSelectedArtifactId("");
    setSelectedDependencyId("");
    setCollapsedNodeIds(new Set());
    setDiscoveryWarnings([]);
    setComparison(null);
    setComparisonProgress("");
    setTargetCandidates({});
    setLoadingTargetId(null);
    setError(null);
    resetTransferState();
    void refreshJourneys();
  }, [refreshJourneys, connectionRevision]);

  const selectedJourney = useMemo(
    () => journeys.find((journey) => journey.id === selectedJourneyId),
    [journeys, selectedJourneyId],
  );
  const journeyStatuses = useMemo(
    () => [...new Set(journeys.map(getCombinedStatusLabel).filter((status): status is string => Boolean(status)))].sort((left, right) => left.localeCompare(right)),
    [journeys],
  );
  const filteredJourneys = useMemo(
    () => selectedJourneyStatus === "all"
      ? journeys
      : journeys.filter((journey) => getCombinedStatusLabel(journey) === selectedJourneyStatus),
    [journeys, selectedJourneyStatus],
  );
  const selectedArtifact = discovery?.artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? discovery?.root;
  const embeddedAction = selectedArtifact?.logicalName === "journey-embedded" && selectedArtifact.kind !== "trigger" ? selectedArtifact.sourceRecord : undefined;
  const actionMappings = embeddedAction ? getActionFieldMappings(embeddedAction) : [];
  const embeddedCondition = selectedArtifact?.logicalName === "journey-embedded" ? getJourneyCondition(selectedArtifact.sourceRecord, selectedArtifact.conditionOptionLabels, selectedArtifact.conditionLookupValues) : undefined;
  const selectedDependency = discovery?.dependencies.find((dependency) => dependency.id === selectedDependencyId);
  const selectedArtifactAttributes = useMemo(() => getArtifactAttributeViews(discovery, selectedArtifact), [discovery, selectedArtifact]);
  const selectedArtifactIncoming = useMemo(
    () => discovery?.dependencies.filter((dependency) => dependency.targetArtifactId === selectedArtifact?.id) ?? [],
    [discovery, selectedArtifact],
  );
  const selectedArtifactOutgoing = useMemo(
    () => discovery?.dependencies.filter((dependency) => dependency.sourceArtifactId === selectedArtifact?.id) ?? [],
    [discovery, selectedArtifact],
  );

  const runDiscovery = async (journey = selectedJourney) => {
    if (!connection || !journey) return;
    setIsDiscovering(true);
    setError(null);
    setDiscovery(null);
    setSelectedArtifactId("");
    setSelectedDependencyId("");
    setCollapsedNodeIds(new Set());
    try {
      const result = await discoverJourney(journey, connection.url);
      setDiscovery(result);
      setSelectedArtifactId(result.root.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[Customer Journey Explorer] Journey dependency discovery failed", cause);
      setError(message);
      try {
        await window.toolboxAPI.utils.showNotification({ title: "Journey discovery failed", body: message, type: "error", duration: 6000 });
      } catch {
        // The in-tool error banner remains available if PPTB notifications fail.
      }
    } finally {
      setIsDiscovering(false);
    }
  };

  const compareWithTarget = async () => {
    if (!migrationEnabled || !selectedJourney || !discovery || !secondaryConnection) return;
    const requestId = ++comparisonRequestId.current;
    resetTransferState();
    targetRequestId.current += 1;
    setTargetCandidates({});
    setLoadingTargetId(null);
    setComparison(null);
    setError(null);
    setComparisonProgress("Starting target comparison…");
    setIsComparing(true);
    try {
      const result = await compareJourney(selectedJourney, discovery, secondaryConnection.url, "secondary", (progress) => {
        if (requestId === comparisonRequestId.current) setComparisonProgress(progress);
      });
      if (requestId !== comparisonRequestId.current) return;
      // Never carry UI overrides from a previous comparison into a new plan.
      result.plan = result.plan.map((item) => item.status === "missing"
        ? { ...item, action: "create", createName: result.source.artifacts.find((artifact) => artifact.id === item.sourceArtifactId)?.displayName ?? "" }
        : item.status === "exact-match" || item.status === "unsupported"
          ? { ...item, action: item.status === "unsupported" ? "embedded" : "automatically-mapped" }
          : item);
      result.blockingErrors = result.blockingErrors.filter((error) => !error.includes("target match requires manual confirmation"));
      setComparison(result);
    } catch (cause) {
      if (requestId !== comparisonRequestId.current) return;
      setError(`Target comparison failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      if (requestId === comparisonRequestId.current) {
        setIsComparing(false);
        setComparisonProgress("");
      }
    }
  };

  const updatePlanAction = (sourceArtifactId: string, action: MigrationAction) => {
    setComparison((current) => current ? {
      ...current,
      plan: current.plan.map((item) => item.sourceArtifactId === sourceArtifactId
        ? {
          ...item,
          action,
          ...(action === "create"
            ? {
              targetArtifactId: undefined,
              targetRecordId: undefined,
              createName: item.createName ?? current.source.artifacts.find((artifact) => artifact.id === sourceArtifactId)?.displayName ?? "",
            }
            : {}),
          ...((action === "manual" || action === "automatically-mapped") && !item.targetRecordId ? { selected: false } : {}),
        }
        : item),
      blockingErrors: action !== "skip" && (action === "manual" || action === "automatically-mapped") && !current.plan.find((item) => item.sourceArtifactId === sourceArtifactId)?.targetRecordId
        ? [...current.blockingErrors.filter((error) => !error.startsWith(`${sourceArtifactId}:`)), `${sourceArtifactId}: target match requires manual confirmation.`]
        : current.blockingErrors.filter((error) => !error.startsWith(`${sourceArtifactId}:`)),
    } : current);
  };

  const selectTargetRecord = (sourceArtifactId: string, targetArtifact: Artifact) => {
    targetRequestId.current += 1;
    setTargetCandidates({});
    setComparison((current) => current ? {
      ...current,
      matches: current.matches.map((match) => match.sourceArtifactId === sourceArtifactId
        ? { ...match, status: "exact-match", targetArtifactId: targetArtifact.id, targetRecordId: targetArtifact.recordId, warnings: [] }
        : match),
      plan: current.plan.map((item) => item.sourceArtifactId === sourceArtifactId
        ? { ...item, status: "exact-match", action: "manual", selected: true, createName: undefined, targetArtifactId: targetArtifact.id, targetRecordId: targetArtifact.recordId, warnings: [] }
        : item),
      target: current.target ? { ...current.target, artifacts: [...current.target.artifacts.filter((item) => item.id !== targetArtifact.id), targetArtifact] } : {
        root: targetArtifact, artifacts: [targetArtifact], dependencies: [], warnings: [], discoveredAt: new Date().toISOString(),
      },
      blockingErrors: current.blockingErrors.filter((error) => !error.startsWith(`${sourceArtifactId}:`)),
    } : current);
    void recheckDependentArtifacts(sourceArtifactId, targetArtifact);
  };

  const loadTargetCandidates = async (sourceArtifactId: string) => {
    if (!comparison || !secondaryConnection) return;
    const sourceArtifact = comparison.source.artifacts.find((artifact) => artifact.id === sourceArtifactId);
    if (!sourceArtifact) return;
    logDiagnostic({
      level: "info",
      phase: "manual-mapping-candidates",
      entity: sourceArtifact.logicalName,
      message: `Started loading target candidates for ${sourceArtifact.displayName} (${sourceArtifact.kind}).`,
      rawResult: { sourceArtifactId, kind: sourceArtifact.kind, displayName: sourceArtifact.displayName },
    });
    const requestId = ++targetRequestId.current;
    setTargetCandidates((current) => ({ ...current, [sourceArtifactId]: [] }));
    setLoadingTargetId(sourceArtifactId);
    if (sourceArtifact.kind === "journey") {
      try {
        const result = await loadJourneys("secondary");
        if (requestId !== targetRequestId.current) return;
        const journeyCandidates: Artifact[] = result.journeys.map((journey) => ({
          id: `${journey.logicalName.toLowerCase()}:${journey.id.toLowerCase()}`,
          kind: "journey",
          logicalName: journey.logicalName,
          entitySetName: journey.entitySetName,
          primaryNameAttribute: journey.primaryNameAttribute,
          recordId: journey.id,
          displayName: journey.name,
          sourceRecord: journey.record,
          warnings: [],
        }));
        setTargetCandidates((current) => ({ ...current, [sourceArtifactId]: journeyCandidates }));
        logDiagnostic({
          level: "info",
          phase: "manual-mapping-candidates",
          entity: sourceArtifact.logicalName,
          message: `Loaded ${journeyCandidates.length} target Journey candidate(s).`,
          rawResult: { sourceArtifactId, candidateCount: journeyCandidates.length },
        });
      } catch (cause) {
        if (requestId === targetRequestId.current) {
          const message = cause instanceof Error ? cause.message : String(cause);
          logDiagnostic({ level: "error", phase: "manual-mapping-candidates", entity: sourceArtifact.logicalName, message: `Failed to load target Journey candidates for ${sourceArtifact.displayName}`, error: cause });
          setError(`Could not load target Journeys: ${message}`);
        }
      } finally {
        if (requestId === targetRequestId.current) setLoadingTargetId(null);
      }
      return;
    }
    const overrides = createSemanticTargetOverrides(
      sourceArtifact,
      comparison.source,
      comparison.plan,
      comparison.target?.artifacts ?? [],
    );
    const ancestors = new Set<string>([sourceArtifactId, ...overrides.keys()]);
    const scopedSource: DiscoveryResult = {
      ...comparison.source,
      artifacts: comparison.source.artifacts.filter((artifact) => ancestors.has(artifact.id)),
      dependencies: comparison.source.dependencies.filter((dependency) => ancestors.has(dependency.sourceArtifactId) && (!dependency.targetArtifactId || ancestors.has(dependency.targetArtifactId))),
    };
    try {
      const refreshed = await discoverArtifactsByIdentity(scopedSource, secondaryConnection.url, "secondary", overrides, true);
      if (requestId !== targetRequestId.current) return;
      const candidates = refreshed.artifacts.filter((artifact) => artifact.logicalName.toLowerCase() === sourceArtifact.logicalName.toLowerCase());
      setTargetCandidates((current) => ({ ...current, [sourceArtifactId]: candidates }));
      logDiagnostic({
        level: "info",
        phase: "manual-mapping-candidates",
        entity: sourceArtifact.logicalName,
        message: `Loaded ${candidates.length} target candidate(s) for ${sourceArtifact.displayName}.`,
        rawResult: { sourceArtifactId, candidateCount: candidates.length, warnings: refreshed.warnings },
      });
      for (const warning of refreshed.warnings) {
        logDiagnostic({ level: "warning", phase: "manual-mapping-candidates", entity: sourceArtifact.logicalName, message: warning });
      }
    } catch (cause) {
      if (requestId === targetRequestId.current) {
        const message = cause instanceof Error ? cause.message : String(cause);
        logDiagnostic({ level: "error", phase: "manual-mapping-candidates", entity: sourceArtifact.logicalName, message: `Failed to load target candidates for ${sourceArtifact.displayName}`, error: cause });
        setError(`Could not load target records: ${message}`);
      }
    } finally {
      if (requestId === targetRequestId.current) setLoadingTargetId(null);
    }
  };

  const recheckDependentArtifacts = async (parentSourceArtifactId: string, targetParent: Artifact) => {
    if (!comparison || !secondaryConnection) return;
    const parentKind = comparison.source.artifacts.find((artifact) => artifact.id === parentSourceArtifactId)?.kind;
    const childKind = parentKind === "brandProfile" ? "sender" : parentKind === "compliance" ? "purpose" : parentKind === "purpose" ? "topic" : undefined;
    if (!childKind) return;
    const dependentIds = new Set(comparison.source.dependencies
      .filter((dependency) => dependency.targetArtifactId === parentSourceArtifactId &&
        comparison.source.artifacts.some((artifact) => artifact.id === dependency.sourceArtifactId && artifact.kind === childKind))
      .map((dependency) => dependency.sourceArtifactId));
    if (!dependentIds.size) return;
    const previousTarget = comparison.plan.find((item) => item.sourceArtifactId === parentSourceArtifactId)?.targetRecordId;
    if (previousTarget?.toLowerCase() !== targetParent.recordId.toLowerCase()) {
      targetRequestId.current += 1;
      setTargetCandidates({});
    }
    const scopedSource: DiscoveryResult = {
      ...comparison.source,
      artifacts: comparison.source.artifacts.filter((artifact) => dependentIds.has(artifact.id) || artifact.id === parentSourceArtifactId),
      dependencies: comparison.source.dependencies.filter((dependency) => dependentIds.has(dependency.sourceArtifactId) || dependency.targetArtifactId === parentSourceArtifactId),
    };
    const overrides = new Map<string, Artifact>([[parentSourceArtifactId, targetParent]]);
    for (const dependency of comparison.source.dependencies) {
      if (!dependency.targetArtifactId || !comparison.source.artifacts.some((artifact) => artifact.id === dependency.targetArtifactId)) continue;
      const mappedParent = comparison.plan.find((item) => item.sourceArtifactId === dependency.targetArtifactId);
      const mappedTarget = mappedParent?.targetArtifactId
        ? comparison.target?.artifacts.find((artifact) => artifact.id === mappedParent.targetArtifactId)
        : undefined;
      if (mappedTarget && dependency.targetArtifactId !== parentSourceArtifactId) overrides.set(dependency.targetArtifactId, mappedTarget);
    }
    const refreshed = await discoverArtifactsByIdentity(scopedSource, secondaryConnection.url, "secondary", overrides);
    setComparison((current) => {
      if (!current || current.plan.find((item) => item.sourceArtifactId === parentSourceArtifactId)?.targetRecordId !== targetParent.recordId) return current;
      const refreshedMatches = new Map<string, ArtifactMatch>();
      for (const sourceId of dependentIds) {
        const sourceArtifact = current.source.artifacts.find((artifact) => artifact.id === sourceId);
        if (!sourceArtifact) continue;
        const candidates = [...new Map(refreshed.artifacts
          .filter((artifact) => artifact.logicalName.toLowerCase() === sourceArtifact.logicalName.toLowerCase() &&
            artifact.displayName.trim().toLowerCase() === sourceArtifact.displayName.trim().toLowerCase())
          .map((artifact) => [artifact.id, artifact])).values()];
        refreshedMatches.set(sourceId, candidates.length === 1
          ? { sourceArtifactId: sourceId, status: "exact-match", targetArtifactId: candidates[0].id, targetRecordId: candidates[0].recordId, warnings: [] }
          : { sourceArtifactId: sourceId, status: candidates.length > 1 ? "ambiguous" : "missing", warnings: candidates.length > 1 ? ["Multiple matching target records were found."] : [] });
      }
      return {
        ...current,
        matches: current.matches.map((match) => refreshedMatches.get(match.sourceArtifactId) ?? match),
        plan: current.plan.map((item) => {
          const match = refreshedMatches.get(item.sourceArtifactId);
          if (!match) return item;
          const action = match.status === "exact-match" ? "automatically-mapped" : match.status === "ambiguous" ? "manual" : "create";
          return { ...item, ...match, action, ...(match.status === "missing" ? { selected: true } : {}) };
        }),
        blockingErrors: [
          ...current.blockingErrors.filter((error) => ![...dependentIds].some((id) => error.startsWith(`${id}:`))),
          ...[...refreshedMatches.values()].filter((match) => match.status === "ambiguous")
            .map((match) => `${match.sourceArtifactId}: target match requires manual confirmation.`),
        ],
        target: current.target ? { ...current.target, artifacts: [...current.target.artifacts.filter((artifact) => !refreshed.artifacts.some((item) => item.id === artifact.id)), ...refreshed.artifacts] } : current.target,
      };
    });
  };

  const canSelectPlanItem = (item: MigrationComparison["plan"][number]) =>
    item.action !== "embedded" && item.action !== "blocked" &&
    !((item.action === "manual" || item.action === "automatically-mapped") && !item.targetRecordId);

  const togglePlanSelection = (sourceArtifactId: string, selected: boolean) => {
    setComparison((current) => current ? {
      ...current,
      plan: current.plan.map((item) => item.sourceArtifactId === sourceArtifactId && canSelectPlanItem(item) ? { ...item, selected } : item),
    } : current);
  };

  const updateCreateName = (sourceArtifactId: string, createName: string) => {
    setComparison((current) => current ? {
      ...current,
      plan: current.plan.map((item) => item.sourceArtifactId === sourceArtifactId ? { ...item, createName } : item),
    } : current);
  };

  const toggleAllSelectable = (selected: boolean) => {
    setComparison((current) => current ? {
      ...current,
      plan: current.plan.map((item) => canSelectPlanItem(item) ? { ...item, selected } : item),
    } : current);
  };

  const startMigration = async () => {
    if (!comparison) return;
    const selectedBlockingErrors = comparison.plan
      .filter((item) => item.selected && item.action !== "skip" && (item.action === "manual" || item.action === "automatically-mapped") && !item.targetRecordId)
      .map((item) => `${item.sourceArtifactId}: target match requires manual confirmation.`);
    if (selectedBlockingErrors.length > 0) {
      setError("The migration preview is blocked until all manual mappings are resolved.");
      return;
    }
    const creates = comparison.plan.filter((item) => item.selected && item.action === "create").length;
    if (!window.confirm(`Create ${creates} element(s) in the target environment? Existing elements will not be changed. Embedded Journey nodes are included in the Journey JSON.`)) return;
    setIsTransferring(true);
    setTransferResult(null);
    setTransferLog([]);
    setTransferFatalError(null);
    setMigrationPreviewStarted(false);
    try {
      const transferComparison: MigrationComparison = { ...comparison, blockingErrors: selectedBlockingErrors };
      const result = await executeCreateOnlyTransfer(transferComparison, (progress) => {
        setTransferLog((current) => [...current, progress]);
      });
      setTransferResult(result);
      await window.toolboxAPI.utils.showNotification({
        title: result.failed.length ? "Migration completed with errors" : "Migration completed",
        body: `${result.created.length} element(s) created, ${result.failed.length} failed.`,
        type: result.failed.length ? "warning" : "success",
        duration: 5000,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTransferFatalError(message);
    } finally {
      setIsTransferring(false);
    }
  };

  const openArtifact = async (artifact: Artifact, connectionTarget: "primary" | "secondary" = "primary") => {
    if (!artifact.dataverseUrl) return;
    try {
      await window.toolboxAPI.utils.openInConnectionBrowser(artifact.dataverseUrl, connectionTarget);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`Dataverse record could not be opened: ${message}`);
    }
  };

  const openDependency = async (dependency: Dependency) => {
    if (!connection?.url || !dependency.targetLogicalName || !dependency.targetRecordId) return;
    const url = createRecordUrl(connection.url, dependency.targetLogicalName, dependency.targetRecordId);
    if (!url) return;
    try {
      await window.toolboxAPI.utils.openInConnectionBrowser(url, "primary");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const selectArtifact = (artifactId: string) => {
    setSelectedArtifactId(artifactId);
    setSelectedDependencyId("");
  };

  const toggleArtifact = (artifactId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(artifactId)) next.delete(artifactId);
      else next.add(artifactId);
      return next;
    });
  };

  const { dependenciesBySource, promotedArtifactIds } = useMemo(() => buildDependencyTree(discovery), [discovery]);
  const openDiagnostics = () => {
    const diagnostics = getDiagnostics();
    const report = {
      generatedAt: new Date().toISOString(),
      app: "Customer Journey Explorer",
      diagnosticCount: diagnostics.length,
      diagnostics,
    };
    openSourceDialog(`Diagnostics (${diagnostics.length})`, JSON.stringify(report, null, 2));
  };

  const clearDiagnosticsLog = () => {
    clearDiagnostics();
    setDiagnosticCount(0);
    if (sourceDialog?.label.startsWith("Diagnostics")) openDiagnostics();
  };

  const exportJourneyMarkdown = async () => {
    if (!discovery) return;
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = await window.toolboxAPI.fileSystem.saveFile(
        `customer-journey-${timestamp}.md`,
        buildJourneyMarkdown(discovery, { dependenciesBySource, promotedArtifactIds }),
        [{ name: "Markdown", extensions: ["md"] }],
      );
      if (filePath) {
        await window.toolboxAPI.utils.showNotification({ title: "Markdown exported", body: "The Journey Markdown report was saved.", type: "success", duration: 4000 });
      }
    } catch (cause) {
      setError(`Markdown export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  return (
    <div className={styles.root}>
      {!connection && !isLoadingConnection && (
        <MessageBar intent="warning"><MessageBarBody><MessageBarTitle>Connection required</MessageBarTitle>Select an active Dataverse connection in PPTB to discover Journeys.</MessageBarBody></MessageBar>
      )}
      {error && <MessageBar intent="error"><MessageBarBody><MessageBarTitle>Operation failed</MessageBarTitle>{error}</MessageBarBody></MessageBar>}
      {discoveryWarnings.map((warning) => <MessageBar key={warning} intent="warning"><MessageBarBody>{warning}</MessageBarBody></MessageBar>)}

      <div className={styles.controls}>
        <Field className={styles.statusSelectGroup} label="Status">
          <Dropdown
            className={styles.controlDropdown}
            value={selectedJourneyStatus === "all" ? "All" : selectedJourneyStatus}
            selectedOptions={[selectedJourneyStatus]}
            disabled={isDiscovering}
            onOptionSelect={(_event, data) => {
              const nextStatus = data.optionValue ?? "all";
              setSelectedJourneyStatus(nextStatus);
              if (selectedJourneyId) {
                const remainsVisible = journeys.some((journey) =>
                  journey.id === selectedJourneyId &&
                  (nextStatus === "all" || getCombinedStatusLabel(journey) === nextStatus),
                );
                if (!remainsVisible) {
                  setSelectedJourneyId("");
                  setSelectedDependencyId("");
                  setSelectedArtifactId("");
                  setDiscovery(null);
                }
              }
            }}
            aria-label="Filter Journeys by status"
          >
            <Option value="all" text="All">All</Option>
            {journeyStatuses.map((status) => <Option key={status} value={status} text={status}>{status}</Option>)}
          </Dropdown>
        </Field>
        <Field className={styles.selectGroup} label="Select a Journey">
          <Dropdown
            className={styles.controlDropdown}
            placeholder={isLoadingJourneys ? "Loading Journeys…" : journeys.length ? "Choose a Journey" : "No Journeys found"}
            value={filteredJourneys.find((journey) => journey.id === selectedJourneyId)?.name ?? ""}
            selectedOptions={selectedJourneyId ? [selectedJourneyId] : []}
            onOptionSelect={(_event, data) => {
              const nextJourneyId = data.optionValue ?? "";
              const nextJourney = filteredJourneys.find((journey) => journey.id === nextJourneyId);
              setSelectedJourneyId(nextJourneyId);
              setSelectedDependencyId("");
              if (nextJourney) {
                void runDiscovery(nextJourney);
              } else {
                setDiscovery(null);
                setSelectedArtifactId("");
              }
            }}
            disabled={!connection || isLoadingJourneys || isDiscovering}
            aria-label="Select a Journey"
          >
            {filteredJourneys.map((journey) => (
              <Option
                key={`${journey.logicalName}:${journey.id}`}
                value={journey.id}
                text={journey.name}
              >
                <span className={styles.journeyOption}>
                  <span className={styles.journeyOptionName}>{journey.name}{journey.version ? ` (v${journey.version})` : ""}</span>
                  {getCombinedStatusLabel(journey) && <Badge className={styles.journeyOptionStatus} appearance="tint" color="informative">{getCombinedStatusLabel(journey)}</Badge>}
                </span>
              </Option>
            ))}
          </Dropdown>
        </Field>
        <div className={styles.optionsMenu}>
          {migrationEnabled && <>
            <Button appearance="primary" disabled={!discovery || !secondaryConnection || isComparing || isLoadingSecondaryConnection} title={!secondaryConnection && !isLoadingSecondaryConnection ? "Configure an optional target connection to compare or migrate" : undefined} onClick={() => void compareWithTarget()}>
              {isComparing ? "Comparing…" : "Compare with target"}
            </Button>
            {!secondaryConnection && !isLoadingSecondaryConnection && <Text size={200} title="Journey discovery works without a target. Comparison and migration need an optional secondary connection.">Target connection not set</Text>}
          </>}
          <Menu>
            <MenuTrigger>
              <Button className={styles.optionsMenuTrigger} appearance="secondary" aria-label="More options" icon={<MoreHorizontal24Filled />} />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem disabled={!discovery} onClick={() => void exportJourneyMarkdown()}>
                  Export Journey as Markdown
                </MenuItem>
                <MenuItem onClick={openDiagnostics}>
                  View diagnostics ({diagnosticCount})
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </div>

      {discovery ? (
        <div className={styles.workspace}>
          <DependencyTree
            discovery={discovery}
            dependenciesBySource={dependenciesBySource}
            promotedArtifactIds={promotedArtifactIds}
            collapsedNodeIds={collapsedNodeIds}
            selectedArtifactId={selectedArtifactId}
            selectedDependencyId={selectedDependencyId}
            onSelectArtifact={selectArtifact}
            onSelectDependency={(dependency) => { setSelectedArtifactId(dependency.sourceArtifactId); setSelectedDependencyId(dependency.id); }}
            onToggleArtifact={toggleArtifact}
          />
          <ArtifactDetails
            discovery={discovery}
            selectedArtifact={selectedArtifact}
            selectedDependency={selectedDependency}
            attributes={selectedArtifactAttributes}
            incoming={selectedArtifactIncoming}
            outgoing={selectedArtifactOutgoing}
            embeddedCondition={embeddedCondition}
            embeddedAction={embeddedAction}
            actionMappings={actionMappings}
            onOpenArtifact={(artifact) => void openArtifact(artifact)}
            onOpenDependency={(dependency) => void openDependency(dependency)}
            onOpenSource={(content) => openSourceDialog(content.label, content.originalText, content.isHtml)}
            onSelectArtifact={selectArtifact}
            onSelectDependency={setSelectedDependencyId}
          />
        </div>
      ) : (
        <div className={styles.empty}>
          {isLoadingConnection || isLoadingJourneys || isDiscovering
            ? <Spinner label={isDiscovering ? "Reading Journey dependencies…" : "Loading Journey data…"} />
            : <Text>Select a Journey and press “Discover dependencies” to load its related records.</Text>}
        </div>
      )}
      <SourceTextDialog
        dialog={sourceDialog}
        onClose={() => setSourceDialog(null)}
        onClearDiagnostics={clearDiagnosticsLog}
        onError={setError}
      />
      {migrationEnabled && <MigrationDialog
        comparison={comparison}
        isComparing={isComparing}
        comparisonProgress={comparisonProgress}
        sourceEnvironment={connection?.name ?? connection?.url ?? "—"}
        targetEnvironment={secondaryConnection?.name ?? secondaryConnection?.url ?? "—"}
        targetCandidates={targetCandidates}
        loadingTargetId={loadingTargetId}
        migrationPreviewStarted={migrationPreviewStarted}
        isTransferring={isTransferring}
        transferResult={transferResult}
        transferLog={transferLog}
        transferFatalError={transferFatalError}
        canSelectPlanItem={canSelectPlanItem}
        onClose={() => { targetRequestId.current += 1; setTargetCandidates({}); setComparison(null); resetTransferState(); }}
        onActionChange={updatePlanAction}
        onTargetSelect={selectTargetRecord}
        onTargetOpen={(artifact) => void openArtifact(artifact, "secondary")}
        onLoadTargetCandidates={(sourceArtifactId) => void loadTargetCandidates(sourceArtifactId)}
        onPlanSelectionChange={togglePlanSelection}
        onToggleAll={toggleAllSelectable}
        onCreateNameChange={updateCreateName}
        onMigratedTargetOpen={(artifact, targetId) => void openMigratedTarget(artifact, targetId)}
        onStartMigration={() => void startMigration()}
        onReturnToDefinition={returnToMigrationDefinition}
      />}
    </div>
  );
}
