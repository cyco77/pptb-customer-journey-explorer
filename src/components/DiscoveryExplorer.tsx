import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Divider,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
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
  Spinner,
  Text,
  Title3,
  Option,
} from "@fluentui/react-components";
import { MoreHorizontal24Filled } from "@fluentui/react-icons";
import type { Artifact, Dependency, DiscoveryResult, JourneyOption } from "../discovery/types";
import { discoverJourney, loadJourneys } from "../discovery/discoveryService";
import { createRecordUrl } from "../discovery/dataverseLinks";
import { clearDiagnostics, getDiagnosticEventName, getDiagnostics } from "../discovery/diagnostics";
import { getActionFieldMappings, getActionTargetEntity } from "../discovery/journeyMappings";
import { getJourneyCondition } from "../discovery/journeyConditions";
import { buildJourneyMarkdown } from "../utils/journeyMarkdownExport";

type Props = {
  connection: ToolBoxAPI.Connection | null;
  isLoadingConnection: boolean;
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
  optionsMenu: { flexShrink: 0, marginLeft: "8px" },
  optionsMenuTrigger: { flexShrink: 0, width: "36px", minWidth: "36px", height: "32px", minHeight: "32px", padding: 0 },
  workspace: { display: "grid", gridTemplateColumns: "minmax(280px, 0.9fr) minmax(320px, 1.1fr)", gridTemplateRows: "minmax(0, 1fr)", alignItems: "stretch", gap: "16px", flex: 1, minHeight: 0, "@media (max-width: 800px)": { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "auto auto", overflow: "auto" } },
  panel: { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0, minHeight: 0, overflow: "hidden", padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground1)" },
  treePanel: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, minHeight: 0, overflow: "hidden", padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground1)" },
  panelHeader: { position: "sticky", top: 0, zIndex: 2, flexShrink: 0, display: "flex", flexDirection: "column", gap: "2px", paddingBottom: "6px", backgroundColor: "var(--colorNeutralBackground1)" },
  panelHeaderRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" },
  panelDescription: { color: "var(--colorNeutralForeground3)" },
  panelBody: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" },
  treeScrollArea: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: "4px" },
  tree: { display: "flex", flexDirection: "column", gap: "4px", paddingLeft: "0", listStyle: "none", margin: 0 },
  treeItem: { display: "flex", flexDirection: "column", gap: "3px" },
  treeRow: { display: "flex", alignItems: "center", gap: "4px", width: "100%", borderRadius: "4px", padding: "2px 4px", "&:hover": { backgroundColor: "var(--colorNeutralBackground1Hover)" } },
  treeToggle: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "24px", height: "28px", flexShrink: 0, border: 0, borderRadius: "4px", color: "var(--colorNeutralForeground2)", backgroundColor: "transparent", cursor: "pointer", font: "inherit", "&:hover": { backgroundColor: "var(--colorNeutralBackground1Hover)" }, "&:disabled": { cursor: "default", opacity: 0.55 } },
  treeTitle: { display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0, border: 0, borderRadius: "4px", padding: "6px 4px", textAlign: "left", color: "var(--colorNeutralForeground1)", backgroundColor: "transparent", cursor: "pointer", font: "inherit", "&:hover": { backgroundColor: "var(--colorNeutralBackground1Hover)" } },
  treeTitleSelected: { backgroundColor: "var(--colorSubtleBackgroundSelected)", "&:hover": { backgroundColor: "var(--colorSubtleBackgroundSelected)" } },
  treeChildren: { borderLeft: "1px solid var(--colorNeutralStroke2)", marginLeft: "13px", paddingLeft: "8px", listStyle: "none" },
  treeMeta: { color: "var(--colorNeutralForeground3)", fontSize: "12px", marginLeft: "auto", whiteSpace: "nowrap" },
  details: { display: "flex", flexDirection: "column", gap: "12px" },
  detailHero: { position: "sticky", top: 0, zIndex: 1, display: "flex", flexDirection: "column", gap: "8px", padding: "14px", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground2)" },
  detailHeroRow: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start", gap: "12px" },
  detailHeroIdentity: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  detailHeroTitle: { fontSize: "20px", lineHeight: "26px", fontWeight: 600, overflowWrap: "anywhere" },
  detailHeroAside: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", minWidth: 0 },
  detailBadges: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px", flexWrap: "wrap" },
  detailActions: { display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap", "& button": { height: "36px" } },
  detailSection: { display: "flex", flexDirection: "column", gap: "8px" },
  detailSectionTitle: { paddingTop: "4px" },
  detailList: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", "@media (max-width: 1100px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
  detailCard: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0, padding: "9px 10px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground1)" },
  detailValue: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
  detailKey: { color: "var(--colorNeutralForeground3)" },
  detailDisclosure: { border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", padding: "10px", "& > summary": { cursor: "pointer", fontWeight: 600, color: "var(--colorNeutralForeground1)" } },
  detailDisclosureBody: { paddingTop: "10px" },
  fieldValueCell: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px" },
  fieldPreview: { overflowWrap: "anywhere", whiteSpace: "pre-wrap" },
  sourceDialog: { display: "flex", flexDirection: "column", width: "min(1000px, calc(100vw - 48px))", maxWidth: "1000px", minWidth: 0, height: "min(800px, calc(100vh - 48px))", maxHeight: "calc(100vh - 48px)", overflow: "hidden", boxSizing: "border-box" },
  sourceDialogBody: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, minHeight: 0, width: "100%", flex: 1, overflow: "hidden", boxSizing: "border-box" },
  sourceDialogContent: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, minHeight: 0, width: "100%", flex: 1, overflow: "hidden", boxSizing: "border-box" },
  sourceSearchRow: { display: "flex", alignItems: "center", gap: "10px" },
  sourceSearch: { flex: 1, minWidth: 0, height: "36px", padding: "0 10px", border: "1px solid var(--colorNeutralStroke1)", borderRadius: "4px", color: "var(--colorNeutralForeground1)", backgroundColor: "var(--colorNeutralBackground1)", font: "inherit" },
  sourceSearchCount: { minWidth: "90px", textAlign: "right", color: "var(--colorNeutralForeground3)" },
  sourceText: { display: "block", flex: 1, minWidth: 0, minHeight: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflow: "auto", margin: 0, padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground2)", color: "var(--colorNeutralForeground1)", fontFamily: "Consolas, 'Courier New', monospace", fontSize: "13px", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  sourceMatch: { color: "inherit", backgroundColor: "var(--colorPaletteYellowBackground2)" },
  sourceMatchActive: { color: "var(--colorNeutralForeground1)", backgroundColor: "var(--colorPaletteYellowBackground1)", outline: "2px solid var(--colorPaletteYellowBorderActive)" },
  attributeTable: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed", "& th, & td": { padding: "8px 10px", borderBottom: "1px solid var(--colorNeutralStroke2)", textAlign: "left", verticalAlign: "top" }, "& th": { width: "38%", color: "var(--colorNeutralForeground3)", fontWeight: 400 }, "& td": { overflowWrap: "anywhere", whiteSpace: "pre-wrap" }, "& tr:last-child th, & tr:last-child td": { borderBottom: 0 } },
  technicalValue: { fontFamily: "monospace", fontSize: "12px", userSelect: "all" },
  relatedList: { display: "flex", flexDirection: "column", gap: "4px" },
  relatedButton: { display: "flex", alignItems: "center", gap: "8px", width: "100%", border: 0, borderRadius: "4px", padding: "7px 8px", textAlign: "left", color: "var(--colorNeutralForeground1)", backgroundColor: "var(--colorNeutralBackground2)", cursor: "pointer", font: "inherit", "&:hover": { backgroundColor: "var(--colorNeutralBackground2Hover)" } },
  relatedLabel: { flex: 1, minWidth: 0 },
  warningList: { display: "flex", flexDirection: "column", gap: "6px", paddingLeft: "20px" },
  empty: { display: "flex", flex: 1, alignItems: "center", justifyContent: "center", textAlign: "center", padding: "36px", color: "var(--colorNeutralForeground3)" },
  toolbar: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
});

const kindLabels: Record<Artifact["kind"], string> = {
  journey: "Journey",
  journeyVersion: "Journey version",
  journeyAction: "Journey action",
  task: "Task",
  trigger: "Trigger / event",
  email: "Email",
  marketingForm: "Marketing form",
  compliance: "Compliance",
  purpose: "Purpose",
  topic: "Topic",
  sender: "Sender",
  brandProfile: "Brand profile",
  template: "Template",
  contentBlock: "Content block",
  segment: "Segment",
  asset: "Digital asset",
  team: "Team",
  businessRecord: "Related record",
  unknown: "Unknown",
};

function getOptionLabel(value: string | undefined, labels: Record<string, string> | undefined): string {
  if (!value) return "Unknown";
  return labels?.[value] ?? value;
}

function humanizeFieldName(name: string): string {
  return name
    .replace(/^msdynmkt_/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatFieldValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toLocaleString();
  return undefined;
}

function toSourceText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function isJsonOrHtmlField(key: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (/\b(json|html|content|body|definition|payload)\b/i.test(key)) return true;
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      JSON.parse(text);
      return true;
    } catch {
      // A JSON-looking field can still be opened as source even if malformed.
      return true;
    }
  }
  return /<!doctype\s+html|<\/?[a-z][\s\S]*?>/i.test(text);
}

export function DiscoveryExplorer({ connection, isLoadingConnection }: Props) {
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
  const [sourceDialog, setSourceDialog] = useState<{ label: string; text: string } | null>(null);
  const [sourceSearchQuery, setSourceSearchQuery] = useState("");
  const [sourceSearchRun, setSourceSearchRun] = useState(0);
  const [activeSourceMatch, setActiveSourceMatch] = useState(0);
  const [sourceCopied, setSourceCopied] = useState(false);
  const sourceTextRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const updateCount = () => setDiagnosticCount(getDiagnostics().length);
    const eventName = getDiagnosticEventName();
    window.addEventListener(eventName, updateCount);
    return () => window.removeEventListener(eventName, updateCount);
  }, []);

  const refreshJourneys = useCallback(async () => {
    if (!connection) {
      setJourneys([]);
      setDiscovery(null);
      setSelectedJourneyId("");
      return;
    }
    setIsLoadingJourneys(true);
    setError(null);
    setDiscovery(null);
    try {
      const result = await loadJourneys();
      setJourneys(result.journeys);
      setDiscoveryWarnings(result.warnings);
      setSelectedJourneyStatus("all");
      setSelectedJourneyId((current) => result.journeys.some((journey) => journey.id === current) ? current : "");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[Customer Journey Explorer] Failed to load Journey list", cause);
      setError(message);
      setJourneys([]);
    } finally {
      setIsLoadingJourneys(false);
    }
  }, [connection]);

  useEffect(() => {
    void refreshJourneys();
  }, [refreshJourneys]);

  const selectedJourney = useMemo(
    () => journeys.find((journey) => journey.id === selectedJourneyId),
    [journeys, selectedJourneyId],
  );
  const journeyStatuses = useMemo(
    () => [...new Set(journeys.map((journey) => journey.statusDisplay ?? journey.status).filter((status): status is string => Boolean(status)))].sort((left, right) => left.localeCompare(right)),
    [journeys],
  );
  const filteredJourneys = useMemo(
    () => selectedJourneyStatus === "all"
      ? journeys
      : journeys.filter((journey) => (journey.statusDisplay ?? journey.status) === selectedJourneyStatus),
    [journeys, selectedJourneyStatus],
  );
  const selectedArtifact = discovery?.artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? discovery?.root;
  const embeddedAction = selectedArtifact?.logicalName === "journey-embedded" && selectedArtifact.kind !== "trigger" ? selectedArtifact.sourceRecord : undefined;
  const actionMappings = embeddedAction ? getActionFieldMappings(embeddedAction) : [];
  const embeddedCondition = selectedArtifact?.logicalName === "journey-embedded" ? getJourneyCondition(selectedArtifact.sourceRecord) : undefined;
  const selectedDependency = discovery?.dependencies.find((dependency) => dependency.id === selectedDependencyId);
  const selectedArtifactFields = useMemo(() => {
    if (!selectedArtifact) return [];
    const primaryId = `${selectedArtifact.logicalName}id`.toLowerCase();
    const record = selectedArtifact.sourceRecord;
    const formattedLookupFields = Object.entries(record).flatMap(([key, value]) => {
      const formattedLookupMatch = key.match(/^_(.+)_value@OData\.Community\.Display\.V1\.FormattedValue$/i);
      if (!formattedLookupMatch || typeof value !== "string" || !value.trim()) return [];
      const logicalName = formattedLookupMatch[1].toLowerCase();
      return [[logicalName, value] as [string, unknown]];
    });
    const formattedLookupNames = new Set(formattedLookupFields.map(([key]) => key));
    const resolvedLookupFields = (discovery?.dependencies ?? []).flatMap((dependency) => {
      if (dependency.sourceArtifactId !== selectedArtifact.id || dependency.relationType !== "lookup" || !dependency.targetArtifactId || !dependency.targetRecordId) return [];
      const target = discovery?.artifacts.find((artifact) => artifact.id === dependency.targetArtifactId);
      if (!target) return [];
      const lookupEntry = Object.entries(record).find(([key, value]) =>
        /^_.*_value$/i.test(key) && typeof value === "string" && value.toLowerCase() === dependency.targetRecordId!.toLowerCase(),
      );
      if (!lookupEntry) return [];
      const key = lookupEntry[0].replace(/^_/, "").replace(/_value$/i, "").toLowerCase();
      if (formattedLookupNames.has(key)) return [];
      return [[key, target.displayName] as [string, unknown]];
    });
    const scalarFields = Object.entries(record)
      .filter(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes("@") || lowerKey === primaryId || /^_.*_value$/i.test(key)) return false;
        if (/(?:name|yominame)$/.test(lowerKey) || /^(?:statecode|statuscode)$/.test(lowerKey)) return false;
        if (/^(?:createdby|modifiedby|createdonbehalfby|modifiedonbehalfby|ownerid|owningbusinessunit|owningteam|owninguser)/i.test(key)) return false;
        if (formattedLookupNames.has(lowerKey)) return false;
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
      })
      .map(([key, value]) => [key, value] as [string, unknown]);
    return [...scalarFields, ...formattedLookupFields, ...resolvedLookupFields]
      .sort(([left], [right]) => {
        const rank = (key: string) => /(subject|email|purpose|topic|sender|brand|trigger|segment|form|journey|status|state|version|unique|type|start|end)/i.test(key) ? 0 : 1;
        return rank(left) - rank(right) || left.localeCompare(right);
      })
      .slice(0, 60);
  }, [discovery, selectedArtifact]);
  const selectedArtifactAttributes = useMemo(() => {
    if (!selectedArtifact) return [];
    return selectedArtifactFields.map(([key, value]) => {
      const friendlyKey = key.replace(/^_/, "").replace(/_value$/, "").toLowerCase();
      return {
        key,
        label: selectedArtifact.fieldDisplayNames?.[friendlyKey] ?? humanizeFieldName(friendlyKey),
        value: formatFieldValue(value) ?? "—",
        sourceText: isJsonOrHtmlField(key, value) ? toSourceText(value) : undefined,
      };
    });
  }, [selectedArtifact, selectedArtifactFields]);
  const sourceMatches = useMemo(() => {
    if (!sourceDialog || !sourceSearchQuery) return [];
    const matches: Array<{ start: number; end: number }> = [];
    const haystack = sourceDialog.text.toLocaleLowerCase();
    const needle = sourceSearchQuery.toLocaleLowerCase();
    let fromIndex = 0;
    while (fromIndex <= haystack.length - needle.length) {
      const start = haystack.indexOf(needle, fromIndex);
      if (start < 0) break;
      matches.push({ start, end: start + needle.length });
      fromIndex = start + Math.max(needle.length, 1);
    }
    return matches;
  }, [sourceDialog, sourceSearchQuery]);
  const openSourceDialog = (label: string, text: string) => {
    setSourceDialog({ label, text });
    setSourceSearchQuery("");
    setActiveSourceMatch(0);
    setSourceSearchRun(0);
    setSourceCopied(false);
  };
  const copySourceText = async () => {
    if (!sourceDialog) return;
    try {
      await window.toolboxAPI.utils.copyToClipboard(sourceDialog.text);
      setSourceCopied(true);
    } catch (cause) {
      setError(`Could not copy field text: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  const searchNext = () => {
    if (!sourceMatches.length) return;
    setActiveSourceMatch((current) => sourceSearchRun === 0 && current === 0 ? 0 : (current + 1) % sourceMatches.length);
    setSourceSearchRun((current) => current + 1);
  };

  useEffect(() => {
    if (!sourceSearchRun) return;
    sourceTextRef.current
      ?.querySelector<HTMLElement>('[data-active-source-match="true"]')
      ?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [sourceSearchRun, activeSourceMatch]);
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

  const openArtifact = async (artifact: Artifact) => {
    if (!artifact.dataverseUrl) return;
    try {
      await window.toolboxAPI.utils.openInConnectionBrowser(artifact.dataverseUrl, "primary");
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

  const { dependenciesBySource, promotedArtifactIds, rootArtifacts } = useMemo(() => {
    const grouped = new Map<string, Dependency[]>();
    const dependencies = discovery?.dependencies ?? [];
    const artifactById = new Map(discovery?.artifacts.map((artifact) => [artifact.id, artifact]) ?? []);
    const semanticParentKind: Partial<Record<Artifact["kind"], Artifact["kind"]>> = {
      compliance: "email",
      purpose: "compliance",
      topic: "purpose",
      sender: "brandProfile",
    };
    const canonicalSemanticEdges: Dependency[] = [];
    const canonicalSemanticChildIds = new Set<string>();
    const semanticTreeParentByChild = new Map<string, Set<string>>();
    const recordReferences = (record: Record<string, unknown>, recordId: string): boolean =>
      Object.entries(record).some(([key, value]) =>
        /^_.*_value$/i.test(key) && typeof value === "string" && value.toLowerCase() === recordId.toLowerCase(),
      );
    const hasLookupToBoth = (record: Record<string, unknown>, firstId: string, secondId: string): boolean =>
      recordReferences(record, firstId) && recordReferences(record, secondId);
    for (const child of discovery?.artifacts ?? []) {
      const expectedParent = semanticParentKind[child.kind];
      if (!expectedParent) continue;
      const matchingEdges = dependencies.filter((dependency) => {
        if (!dependency.targetArtifactId) return false;
        const source = artifactById.get(dependency.sourceArtifactId);
        const target = artifactById.get(dependency.targetArtifactId);
        return (source?.id === child.id && target?.kind === expectedParent) ||
          (target?.id === child.id && source?.kind === expectedParent);
      });
      const edgesByParent = new Map<string, { edge: Dependency; parent: Artifact }>();
      for (const edge of matchingEdges) {
        const originalSource = artifactById.get(edge.sourceArtifactId);
        const originalTarget = artifactById.get(edge.targetArtifactId!);
        const parent = originalSource?.id === child.id ? originalTarget : originalSource;
        if (parent) edgesByParent.set(parent.id, { edge, parent });
      }
      // Lookup discovery can omit an edge when Dataverse metadata is incomplete.
      // Recover the semantic parent from the raw lookup values on either record.
      if (edgesByParent.size === 0) {
        for (const parent of discovery?.artifacts ?? []) {
          if (parent.kind !== expectedParent) continue;
          if (!recordReferences(child.sourceRecord, parent.recordId) && !recordReferences(parent.sourceRecord, child.recordId)) continue;
          edgesByParent.set(parent.id, {
            parent,
            edge: {
              id: `tree:lookup:${parent.id}->${child.id}`,
              sourceArtifactId: parent.id,
              targetArtifactId: child.id,
              targetRecordId: child.recordId,
              targetLogicalName: child.logicalName,
              relationType: "lookup",
              label: child.entityDisplayName ?? kindLabels[child.kind],
              resolved: true,
              warnings: [],
            },
          });
        }
      }
      // Email and form records carry their selected Purpose/Topic lookups.
      // Use the record's explicit selections to establish the displayed
      // purpose-topic hierarchy when relationship metadata is missing.
      if (edgesByParent.size === 0 && child.kind === "purpose") {
        for (const parent of discovery?.artifacts ?? []) {
          if (parent.kind !== "compliance") continue;
          const emailOrFormUsesPair = (discovery?.artifacts ?? []).some((record) => {
            if (record.kind !== "email" && record.kind !== "marketingForm") return false;
            return hasLookupToBoth(record.sourceRecord, child.recordId, parent.recordId);
          });
          if (emailOrFormUsesPair) edgesByParent.set(parent.id, {
            parent,
            edge: {
              id: `tree:record-semantic:${parent.id}->${child.id}`,
              sourceArtifactId: parent.id,
              targetArtifactId: child.id,
              targetRecordId: child.recordId,
              targetLogicalName: child.logicalName,
              relationType: "lookup",
              label: child.entityDisplayName ?? kindLabels[child.kind],
              resolved: true,
              warnings: [],
            },
          });
        }
      }
      if (edgesByParent.size === 0 && child.kind === "topic") {
        for (const parent of discovery?.artifacts ?? []) {
          if (parent.kind !== "purpose") continue;
          const emailOrFormUsesPair = (discovery?.artifacts ?? []).some((record) => {
            if (record.kind !== "email" && record.kind !== "marketingForm") return false;
            return hasLookupToBoth(record.sourceRecord, child.recordId, parent.recordId);
          });
          if (emailOrFormUsesPair) edgesByParent.set(parent.id, {
            parent,
            edge: {
              id: `tree:record-semantic:${parent.id}->${child.id}`,
              sourceArtifactId: parent.id,
              targetArtifactId: child.id,
              targetRecordId: child.recordId,
              targetLogicalName: child.logicalName,
              relationType: "lookup",
              label: child.entityDisplayName ?? kindLabels[child.kind],
              resolved: true,
              warnings: [],
            },
          });
        }
      }
      // Resolve the compliance/purpose hierarchy from the email's actual
      // Dataverse lookups. Journey JSON may separately reference a default
      // compliance profile, so global ambiguity must not prevent this link.
      if (edgesByParent.size === 0 && (child.kind === "purpose" || child.kind === "topic")) {
        const relatedRecords = (discovery?.artifacts ?? []).filter((artifact) => {
          if (artifact.kind !== "email" && artifact.kind !== "marketingForm") return false;
          return dependencies.some((dependency) =>
            dependency.sourceArtifactId === artifact.id && dependency.targetArtifactId === child.id,
          ) || recordReferences(artifact.sourceRecord, child.recordId);
        });
        const candidateParents = (discovery?.artifacts ?? []).filter((candidate) => candidate.kind === expectedParent);
        const linkedParentIds = new Set<string>();
        for (const record of relatedRecords) {
          for (const parent of candidateParents) {
            const hasLookup = dependencies.some((dependency) =>
              dependency.sourceArtifactId === record.id &&
              dependency.targetArtifactId === parent.id &&
              dependency.relationType === "lookup",
            );
            if (hasLookup || recordReferences(record.sourceRecord, parent.recordId)) linkedParentIds.add(parent.id);
          }
        }
        for (const parentId of linkedParentIds) {
          const parent = artifactById.get(parentId);
          if (!parent) continue;
          edgesByParent.set(parent.id, {
            parent,
            edge: {
              id: `tree:email-lookup:${parent.id}->${child.id}`,
              sourceArtifactId: parent.id,
              targetArtifactId: child.id,
              targetRecordId: child.recordId,
              targetLogicalName: child.logicalName,
              relationType: "lookup",
              label: child.entityDisplayName ?? kindLabels[child.kind],
              resolved: true,
              warnings: [],
            },
          });
        }
      }
      // Some Customer Insights tables do not expose the lookup in the selected
      // record shape. If the semantic parent is unambiguous, use that one
      // parent to keep Purpose → Compliance and Topic → Purpose intact.
      if (edgesByParent.size === 0 && (child.kind === "purpose" || child.kind === "topic")) {
        const candidates = (discovery?.artifacts ?? []).filter((artifact) => artifact.kind === expectedParent);
        const expectedCandidateCount = child.kind === "purpose"
          ? (discovery?.artifacts.filter((artifact) => artifact.kind === "purpose").length === 1 ? 1 : 0)
          : 1;
        if (expectedCandidateCount === 1 && candidates.length === 1) {
          const parent = candidates[0];
          edgesByParent.set(parent.id, {
            parent,
            edge: {
              id: `tree:semantic:${parent.id}->${child.id}`,
              sourceArtifactId: parent.id,
              targetArtifactId: child.id,
              targetRecordId: child.recordId,
              targetLogicalName: child.logicalName,
              relationType: "lookup",
              label: child.entityDisplayName ?? kindLabels[child.kind],
              resolved: true,
              warnings: [],
            },
          });
        }
      }
      const semanticParents = [...edgesByParent.values()];
      if (semanticParents.length === 0) continue;
      canonicalSemanticChildIds.add(child.id);
      semanticTreeParentByChild.set(child.id, new Set(semanticParents.map(({ parent }) => parent.id)));
      // A Compliance Profile with multiple mail parents is intentionally
      // promoted to the root; the renderer shows references beneath each mail.
      // A profile linked to one mail remains nested beneath that mail.
      const parentsToRender = child.kind === "compliance" ? semanticParents : semanticParents.slice(0, 1);
      for (const { edge, parent } of parentsToRender) {
        canonicalSemanticEdges.push({
          ...edge,
          id: `tree:${parent.id}->${child.id}`,
          sourceArtifactId: parent.id,
          targetArtifactId: child.id,
          targetRecordId: child.recordId,
          targetLogicalName: child.logicalName,
          label: child.entityDisplayName ?? kindLabels[child.kind],
        });
      }
    }
    // A semantic child belongs in exactly one place. Discard all original
    // edges touching it, then add back only the canonical parent → child edge.
    const treeDependencies = [
      ...dependencies.filter((dependency) =>
        !canonicalSemanticChildIds.has(dependency.sourceArtifactId) &&
        !(dependency.targetArtifactId && canonicalSemanticChildIds.has(dependency.targetArtifactId)),
      ),
      ...canonicalSemanticEdges,
    ].filter((dependency) => {
      if (!dependency.targetArtifactId) return true;
      // Compliance profiles belong to the email record, not to the journey's
      // embedded email action. The email node still renders the canonical link.
      if (artifactById.get(dependency.sourceArtifactId)?.logicalName === "journey-embedded" &&
          artifactById.get(dependency.sourceArtifactId)?.kind === "email" &&
          artifactById.get(dependency.targetArtifactId)?.kind === "compliance") return false;
      if (artifactById.get(dependency.sourceArtifactId)?.logicalName === "journey-embedded" &&
          artifactById.get(dependency.targetArtifactId)?.logicalName !== "journey-embedded" &&
          artifactById.get(dependency.targetArtifactId)?.kind !== "email") return true;
      // Related-record queries can find the same email as its action JSON.
      // Keep each email beneath the action(s) that actually send it.
      if (artifactById.get(dependency.targetArtifactId)?.kind === "email" &&
          artifactById.get(dependency.sourceArtifactId)?.logicalName !== "journey-embedded" &&
          dependencies.some((candidate) => candidate.targetArtifactId === dependency.targetArtifactId &&
            artifactById.get(candidate.sourceArtifactId)?.logicalName === "journey-embedded" &&
            artifactById.get(candidate.sourceArtifactId)?.kind === "email")) return false;
      const allowedParents = semanticTreeParentByChild.get(dependency.targetArtifactId);
      return !allowedParents || allowedParents.has(dependency.sourceArtifactId);
    });
    const treeDependenciesWithoutDirectDuplicates = treeDependencies.filter((dependency) => {
      const source = artifactById.get(dependency.sourceArtifactId);
      const target = dependency.targetArtifactId ? artifactById.get(dependency.targetArtifactId) : undefined;
      // If a semantic tree route exists, don't render the same purpose/topic
      // again as a direct email lookup alongside that hierarchy.
      if (!source || source.kind !== "email" || !target) return true;
      if (target.kind === "purpose") {
        return !treeDependencies.some((candidate) => {
          if (!candidate.targetArtifactId) return false;
          const candidateTarget = artifactById.get(candidate.targetArtifactId);
          const candidateSource = artifactById.get(candidate.sourceArtifactId);
          return candidateTarget?.id === target.id && candidateSource?.kind === "compliance";
        });
      }
      if (target.kind === "topic") {
        return !treeDependencies.some((candidate) => {
          if (!candidate.targetArtifactId) return false;
          const candidateTarget = artifactById.get(candidate.targetArtifactId);
          const candidateSource = artifactById.get(candidate.sourceArtifactId);
          return candidateTarget?.id === target.id && candidateSource?.kind === "purpose";
        });
      }
      return true;
    });
    const usedPurposeTopicPairs = new Set<string>();
    for (const record of discovery?.artifacts ?? []) {
      if (record.kind !== "email" && record.kind !== "marketingForm") continue;
      const referencedIds = new Set<string>();
      for (const dependency of dependencies) {
        if (dependency.sourceArtifactId === record.id && dependency.targetArtifactId) {
          referencedIds.add(dependency.targetArtifactId);
        }
      }
      for (const candidate of discovery?.artifacts ?? []) {
        if (recordReferences(record.sourceRecord, candidate.recordId)) referencedIds.add(candidate.id);
      }
      const purposes = [...referencedIds].filter((id) => artifactById.get(id)?.kind === "purpose");
      const topics = [...referencedIds].filter((id) => artifactById.get(id)?.kind === "topic");
      for (const purposeId of purposes) {
        for (const topicId of topics) usedPurposeTopicPairs.add(`${purposeId}->${topicId}`);
      }
    }
    const normalizedTreeDependencies = treeDependenciesWithoutDirectDuplicates.filter((dependency) => {
      if (!dependency.targetArtifactId) return true;
      const source = artifactById.get(dependency.sourceArtifactId);
      const target = artifactById.get(dependency.targetArtifactId);
      if (source?.kind === "purpose" && target?.kind === "topic") {
        return usedPurposeTopicPairs.has(`${source.id}->${target.id}`);
      }
      return true;
    });
    const inboundParents = new Map<string, Set<string>>();
    for (const dependency of normalizedTreeDependencies) {
      if (dependency.targetArtifactId) {
        const parents = inboundParents.get(dependency.targetArtifactId) ?? new Set<string>();
        parents.add(dependency.sourceArtifactId);
        inboundParents.set(dependency.targetArtifactId, parents);
      }
    }
    const rootIds = new Set<string>();
    for (const [artifactId, parents] of inboundParents) {
      if (parents.size <= 1 || artifactId === discovery?.root.id) continue;
      const artifact = artifactById.get(artifactId);
      // Purpose stays under Compliance, Topics under Purpose, and Senders under Brand Profile.
      // Promote other multiply referenced records so they still appear only once.
       if (!artifact || artifact.kind === "purpose" || artifact.kind === "topic" || artifact.kind === "sender" ||
         (artifact.kind === "email" && [...parents].some((id) => artifactById.get(id)?.logicalName === "journey-embedded" && artifactById.get(id)?.kind === "email"))) continue;
      rootIds.add(artifactId);
    }
    const promotedIds = rootIds;
    for (const dependency of normalizedTreeDependencies) {
      const dependencies = grouped.get(dependency.sourceArtifactId) ?? [];
      dependencies.push(dependency);
      grouped.set(dependency.sourceArtifactId, dependencies);
    }
    const rootArtifacts = discovery
      ? discovery.artifacts.filter((artifact) => promotedIds.has(artifact.id))
      : [];
    return {
      dependenciesBySource: grouped,
      promotedArtifactIds: promotedIds,
      rootArtifacts,
    };
  }, [discovery]);

  const renderNode = (artifact: Artifact, ancestry: Set<string>): React.ReactNode => {
    const repeated = ancestry.has(artifact.id);
    const children = (dependenciesBySource.get(artifact.id) ?? []).filter((dependency) =>
      !(artifact.id === discovery?.root.id && dependency.targetArtifactId && promotedArtifactIds.has(dependency.targetArtifactId)),
    );
    const nextAncestry = new Set(ancestry).add(artifact.id);
    const isCollapsed = collapsedNodeIds.has(artifact.id);
    const statusLabel = artifact.status
      ? artifact.statusDisplay ?? getOptionLabel(artifact.status, artifact.statusLabels)
      : artifact.state
        ? artifact.stateDisplay ?? getOptionLabel(artifact.state, artifact.stateLabels)
        : undefined;
    return (
      <li className={styles.treeItem} key={artifact.id} role="treeitem" aria-selected={selectedArtifactId === artifact.id}>
        <div className={styles.treeRow}>
          <button
            className={styles.treeToggle}
            type="button"
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${artifact.displayName}`}
            aria-expanded={!isCollapsed}
            disabled={!children.length}
            onClick={() => toggleArtifact(artifact.id)}
          >
            <span aria-hidden="true">{children.length ? (isCollapsed ? "▸" : "▾") : "·"}</span>
          </button>
          <button
            className={`${styles.treeTitle} ${selectedArtifactId === artifact.id && !selectedDependencyId ? styles.treeTitleSelected : ""}`}
            onClick={() => selectArtifact(artifact.id)}
            type="button"
            aria-label={`Show details for ${kindLabels[artifact.kind]} ${artifact.displayName}`}
          >
            <span>{artifact.deleted ? "Deleted in Dataverse · " : ""}{artifact.logicalName === "journey-embedded" && artifact.kind === "email" ? "Email action" : kindLabels[artifact.kind]}: {artifact.displayName}</span>
            {artifact.deleted && <Badge className={styles.treeMeta} appearance="tint" color="danger">Deleted</Badge>}
            {!artifact.deleted && artifact.logicalName !== "journey-embedded" && statusLabel && <Badge className={styles.treeMeta} appearance="tint" color="informative">{statusLabel}</Badge>}
          </button>
        </div>
        {!repeated && !isCollapsed && children.length > 0 && (
          <ul className={styles.treeChildren} role="group">
            {children.map((dependency) => {
              const target = discovery?.artifacts.find((item) => item.id === dependency.targetArtifactId);
              if (target) {
                if (promotedArtifactIds.has(target.id) && artifact.id !== discovery?.root.id) {
                  return (
                    <li key={dependency.id} className={styles.treeItem} role="treeitem">
                      <button
                        className={styles.treeTitle}
                        onClick={() => selectArtifact(target.id)}
                        type="button"
                      >
                        <span aria-hidden="true">↗</span>
                        <span>{dependency.label}: {target.displayName} (see root level)</span>
                      </button>
                    </li>
                  );
                }
                if (nextAncestry.has(target.id)) {
                  return <li key={dependency.id} className={styles.treeItem} role="treeitem"><button className={styles.treeTitle} onClick={() => selectArtifact(target.id)} type="button">↪ {dependency.label}: {target.displayName} (already in path)</button></li>;
                }
                return <Fragment key={dependency.id}>{renderNode(target, nextAncestry)}</Fragment>;
              }
              return (
                <li key={dependency.id} className={styles.treeItem} role="treeitem">
                  <button className={styles.treeTitle} onClick={() => {
                    setSelectedArtifactId(dependency.sourceArtifactId);
                    setSelectedDependencyId(dependency.id);
                  }} type="button">
                    <span aria-hidden="true">⚠</span>
                    <span>{dependency.label}: {dependency.targetLogicalName ?? "Unknown reference"}</span>
                    <span className={styles.treeMeta}>{dependency.targetRecordId?.slice(0, 8)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

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
        buildJourneyMarkdown(discovery),
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
                  (nextStatus === "all" || (journey.statusDisplay ?? journey.status) === nextStatus),
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
                  {journey.statusDisplay && <Badge className={styles.journeyOptionStatus} appearance="tint" color="informative">{journey.statusDisplay}</Badge>}
                </span>
              </Option>
            ))}
          </Dropdown>
        </Field>
        <div className={styles.optionsMenu}>
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
          <section className={styles.treePanel} aria-labelledby="dependency-tree-title">
            <header className={styles.panelHeader}>
              <div className={styles.panelHeaderRow}>
                <Title3 id="dependency-tree-title">Dependency tree</Title3>
                <Text size={200} className={styles.panelDescription}>
                  {discovery.artifacts.length} objects · {discovery.dependencies.length} references
                </Text>
              </div>
              <Divider />
            </header>
            <div className={styles.treeScrollArea}>
              <ul className={styles.tree} role="tree" aria-label="Journey dependency tree">
                {renderNode(discovery.root, new Set())}
                {rootArtifacts.map((artifact) => renderNode(artifact, new Set()))}
              </ul>
              {discovery.warnings.map((warning) => <MessageBar key={warning} intent="warning"><MessageBarBody>{warning}</MessageBarBody></MessageBar>)}
            </div>
          </section>
          <section className={styles.panel} aria-labelledby="object-details-title">
            <header className={styles.panelHeader}>
              <Title3 id="object-details-title">Object details</Title3>
              <Divider />
            </header>
            <div className={styles.panelBody}>
                {selectedDependency ? (
                  <div className={styles.details}>
                    <div className={styles.detailHero}>
                      <div className={styles.detailHeroRow}>
                        <Text className={styles.detailHeroTitle}>{selectedDependency.label}</Text>
                        <div className={styles.detailHeroAside}>
                          <div className={styles.detailBadges}><Badge appearance="tint" color={selectedDependency.targetDeleted ? "danger" : "warning"}>{selectedDependency.targetDeleted ? "Deleted in Dataverse" : "Unresolved reference"}</Badge></div>
                        </div>
                      </div>
                    </div>
                  <div className={styles.detailList}>
                    <div className={styles.detailCard}><Text className={styles.detailKey}>Target table</Text><Text className={styles.detailValue}>{selectedDependency.targetLogicalName ?? "Unknown"}</Text></div>
                    <div className={styles.detailCard}><Text className={styles.detailKey}>Record ID</Text><Text className={styles.detailValue}>{selectedDependency.targetRecordId ?? "—"}</Text></div>
                    <div className={styles.detailCard}><Text className={styles.detailKey}>Reference path</Text><Text className={styles.detailValue}>{selectedDependency.path ?? "Dataverse lookup"}</Text></div>
                  </div>
                  {selectedDependency.targetLogicalName && selectedDependency.targetRecordId && (
                    <div className={styles.detailActions}><Button appearance="primary" onClick={() => void openDependency(selectedDependency)}>Open referenced record in Dataverse</Button></div>
                  )}
                  {selectedDependency.warnings.length > 0 && <ul className={styles.warningList}>{selectedDependency.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                </div>
              ) : selectedArtifact ? (
                  <div className={styles.details}>
                    <div className={styles.detailHero}>
                      <div className={styles.detailHeroRow}>
                        <div className={styles.detailHeroIdentity}>
                          <Text className={styles.detailHeroTitle}>{selectedArtifact.displayName}</Text>
                          <Text className={styles.panelDescription}>{selectedArtifact.entityDisplayName ?? selectedArtifact.logicalName}</Text>
                        </div>
                        <div className={styles.detailHeroAside}>
                          <div className={styles.detailBadges}>
                            <Badge appearance="tint">{kindLabels[selectedArtifact.kind]}</Badge>
                            {selectedArtifact.deleted && <Badge appearance="tint" color="danger">Deleted in Dataverse</Badge>}
                            {selectedArtifact.state && <Badge appearance="tint" color="success">{selectedArtifact.stateDisplay ?? getOptionLabel(selectedArtifact.state, selectedArtifact.stateLabels)}</Badge>}
                            {selectedArtifact.status && <Badge appearance="tint" color="informative">{selectedArtifact.statusDisplay ?? getOptionLabel(selectedArtifact.status, selectedArtifact.statusLabels)}</Badge>}
                          </div>
                          <div className={styles.detailActions}>
                            {selectedArtifact.logicalName === "journey-embedded"
                              ? <Button appearance="secondary" onClick={() => openSourceDialog(selectedArtifact.displayName, toSourceText(selectedArtifact.sourceRecord))}>Open JSON</Button>
                              : <Button appearance="primary" onClick={() => void openArtifact(selectedArtifact)} disabled={!selectedArtifact.dataverseUrl || selectedArtifact.deleted}>Open in Dataverse</Button>}
                          </div>
                        </div>
                      </div>
                    </div>
                  {embeddedCondition && (
                    <div className={styles.detailSection}>
                      <Text weight="semibold" className={styles.detailSectionTitle}>Condition</Text>
                      <div className={styles.detailCard}>
                        <Text className={styles.detailValue}>{embeddedCondition}</Text>
                      </div>
                    </div>
                  )}
                  {embeddedAction && (
                    <div className={styles.detailSection}>
                      <Text weight="semibold" className={styles.detailSectionTitle}>Action configuration</Text>
                      <div className={styles.detailList}>
                        <div className={styles.detailCard}><Text className={styles.detailKey}>Action type</Text><Text className={styles.detailValue}>{formatFieldValue(embeddedAction.type) ?? "—"}</Text></div>
                        {getActionTargetEntity(embeddedAction) && <div className={styles.detailCard}><Text className={styles.detailKey}>Target table</Text><Text className={styles.detailValue}>{getActionTargetEntity(embeddedAction)}</Text></div>}
                      </div>
                      {actionMappings.length > 0 && (
                        <>
                          <Text weight="semibold">Field mappings</Text>
                          <div className={styles.detailList}>
                            {actionMappings.map(({ field, value }) => (
                              <div className={styles.detailCard} key={field}>
                                <Text className={styles.detailKey}>{humanizeFieldName(field)} ({field})</Text>
                                <Text className={styles.detailValue}>{value}</Text>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {selectedArtifactAttributes.length > 0 && (
                    <details className={styles.detailDisclosure} open>
                      <summary>Dataverse fields ({selectedArtifactAttributes.length})</summary>
                      <div className={styles.detailDisclosureBody}>
                        <table className={styles.attributeTable}>
                          <tbody>
                          {selectedArtifactAttributes.map(({ key, label, value, sourceText }) => (
                            <tr key={key}>
                              <th scope="row">{label}</th>
                              <td>
                                <div className={styles.fieldValueCell}>
                                  <Text className={styles.fieldPreview}>{value}</Text>
                                  {sourceText && (
                                    <Button size="small" appearance="subtle" onClick={() => openSourceDialog(label, sourceText)}>
                                      Open JSON / HTML
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                  {(selectedArtifactOutgoing.length > 0 || selectedArtifactIncoming.length > 0) && (
                    <details className={styles.detailDisclosure} open>
                      <summary>Dependency relationships ({selectedArtifactOutgoing.length + selectedArtifactIncoming.length})</summary>
                      <div className={styles.detailDisclosureBody}>
                        <div className={styles.relatedList}>
                          {selectedArtifactOutgoing.map((dependency) => {
                            const target = discovery.artifacts.find((artifact) => artifact.id === dependency.targetArtifactId);
                            return (
                              <button className={styles.relatedButton} type="button" key={`out:${dependency.id}`} onClick={() => target ? selectArtifact(target.id) : setSelectedDependencyId(dependency.id)}>
                                <span aria-hidden="true">↳</span>
                                <Text className={styles.relatedLabel}>{dependency.label}: {target?.displayName ?? dependency.targetLogicalName ?? "Unresolved reference"}</Text>
                                <Text size={200}>{target?.entityDisplayName ?? (target ? kindLabels[target.kind] : "Unresolved")}</Text>
                              </button>
                            );
                          })}
                          {selectedArtifactIncoming.map((dependency) => {
                            const source = discovery.artifacts.find((artifact) => artifact.id === dependency.sourceArtifactId);
                            return (
                              <button className={styles.relatedButton} type="button" key={`in:${dependency.id}`} onClick={() => source && selectArtifact(source.id)}>
                                <span aria-hidden="true">↰</span>
                                <Text className={styles.relatedLabel}>{dependency.label}: {source?.displayName ?? dependency.sourceArtifactId}</Text>
                                <Text size={200}>Referenced by</Text>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </details>
                  )}
                  <details className={styles.detailDisclosure}>
                    <summary>Technical details</summary>
                    <div className={styles.detailDisclosureBody}>
                      <div className={styles.detailList}>
                        <div className={styles.detailCard}><Text className={styles.detailKey}>Logical name</Text><Text className={styles.technicalValue}>{selectedArtifact.logicalName}</Text></div>
                        <div className={styles.detailCard}><Text className={styles.detailKey}>Record ID</Text><Text className={styles.technicalValue}>{selectedArtifact.recordId}</Text></div>
                        <div className={styles.detailCard}><Text className={styles.detailKey}>Entity set</Text><Text className={styles.technicalValue}>{selectedArtifact.entitySetName || "—"}</Text></div>
                        <div className={styles.detailCard}><Text className={styles.detailKey}>Version</Text><Text className={styles.detailValue}>{selectedArtifact.version ?? "—"}</Text></div>
                        <div className={styles.detailCard}><Text className={styles.detailKey}>Related records</Text><Text className={styles.detailValue}>{selectedArtifactOutgoing.length} outgoing · {selectedArtifactIncoming.length} incoming</Text></div>
                        <div className={styles.detailCard}><Text className={styles.detailKey}>Discovered</Text><Text className={styles.detailValue}>{new Date(discovery.discoveredAt).toLocaleString()}</Text></div>
                      </div>
                    </div>
                  </details>
                  {selectedArtifact.warnings.length > 0 && <ul className={styles.warningList}>{selectedArtifact.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                </div>
              ) : <div className={styles.empty}>Select an object in the tree to view its details.</div>}
            </div>
          </section>
        </div>
      ) : (
        <div className={styles.empty}>
          {isLoadingConnection || isLoadingJourneys || isDiscovering
            ? <Spinner label={isDiscovering ? "Reading Journey dependencies…" : "Loading Journey data…"} />
            : <Text>Select a Journey and press “Discover dependencies” to load its related records.</Text>}
        </div>
      )}
      <Dialog
        open={sourceDialog !== null}
        onOpenChange={(_event, data) => {
          if (!data.open) setSourceDialog(null);
        }}
        modalType="modal"
      >
        <DialogSurface className={styles.sourceDialog}>
          <DialogBody className={styles.sourceDialogBody}>
            <DialogTitle>{sourceDialog?.label ?? "Field source"}</DialogTitle>
            <DialogContent className={styles.sourceDialogContent}>
              <div className={styles.sourceSearchRow}>
                <input
                  className={styles.sourceSearch}
                  type="search"
                  placeholder="Search in text…"
                  aria-label="Search in dialog text"
                  value={sourceSearchQuery}
                  onChange={(event) => {
                    setSourceSearchQuery(event.target.value);
                    setActiveSourceMatch(0);
                    setSourceSearchRun(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      searchNext();
                    }
                  }}
                />
                <Text size={200} className={styles.sourceSearchCount}>
                  {sourceSearchQuery ? (sourceMatches.length ? `${activeSourceMatch + 1} / ${sourceMatches.length}` : "No matches") : "Enter to find"}
                </Text>
                <DialogActions>
                  <Button appearance="secondary" onClick={() => void copySourceText()} disabled={!sourceDialog}>
                    {sourceCopied ? "Copied" : "Copy text"}
                  </Button>
                  {sourceDialog?.label.startsWith("Diagnostics") && (
                    <Button appearance="secondary" onClick={clearDiagnosticsLog} disabled={diagnosticCount === 0}>
                      Clear log
                    </Button>
                  )}
                </DialogActions>
              </div>
              <pre className={styles.sourceText} ref={sourceTextRef}>
                {sourceDialog && sourceSearchQuery && sourceMatches.length
                  ? (() => {
                      const pieces: React.ReactNode[] = [];
                      let cursor = 0;
                      sourceMatches.forEach((match, index) => {
                        if (match.start > cursor) pieces.push(sourceDialog.text.slice(cursor, match.start));
                        pieces.push(
                          <mark
                            key={`match:${index}`}
                            className={index === activeSourceMatch ? styles.sourceMatchActive : styles.sourceMatch}
                            data-active-source-match={index === activeSourceMatch ? "true" : undefined}
                          >
                            {sourceDialog.text.slice(match.start, match.end)}
                          </mark>,
                        );
                        cursor = match.end;
                      });
                      if (cursor < sourceDialog.text.length) pieces.push(sourceDialog.text.slice(cursor));
                      return pieces;
                    })()
                  : sourceDialog?.text}
              </pre>
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
