import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Divider,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
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
  Option,
} from "@fluentui/react-components";
import { ArrowRight24Regular, DocumentSearch20Regular, Info16Regular, MoreHorizontal24Filled, TextBulletListTree20Regular } from "@fluentui/react-icons";
import type { Artifact, ArtifactMatch, Dependency, DiscoveryResult, JourneyOption, MigrationComparison, MigrationAction } from "../discovery/types";
import type { TransferProgress, TransferResult } from "../migration/transferService";
import { executeCreateOnlyTransfer } from "../migration/transferService";
import { discoverArtifactsByIdentity, discoverJourney, loadJourneys } from "../discovery/discoveryService";
import { compareJourney } from "../discovery/comparisonService";
import { getArtifactLabel } from "../discovery/artifactCatalog";
import { createRecordUrl } from "../discovery/dataverseLinks";
import { clearDiagnostics, getDiagnosticEventName, getDiagnostics } from "../discovery/diagnostics";
import { getActionFieldMappings, getActionTargetEntity } from "../discovery/journeyMappings";
import { getJourneyCondition } from "../discovery/journeyConditions";
import { buildJourneyMarkdown } from "../utils/journeyMarkdownExport";
import { formatSourceText, tokenizeSourceText, type SourceToken, type SourceTokenKind } from "../utils/sourceFormatting";

type Props = {
  connection: ToolBoxAPI.Connection | null;
  isLoadingConnection: boolean;
  connectionRevision: number;
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
  treePanel: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, minHeight: 0, overflow: "hidden", padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground1)" },
  panelHeader: { position: "sticky", top: 0, zIndex: 2, flexShrink: 0, display: "flex", flexDirection: "column", gap: "2px", paddingBottom: "6px", backgroundColor: "var(--colorNeutralBackground1)" },
  panelHeaderRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" },
  panelTitle: { display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "18px", lineHeight: "24px", fontWeight: 600 },
  panelTitleIcon: { display: "inline-flex", alignItems: "center", color: "var(--colorNeutralForeground1)" },
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
  detailRecordHeader: { flexShrink: 0, minWidth: 0, margin: "0 1px 10px", padding: "14px", borderRadius: "8px", backgroundColor: "var(--colorNeutralBackground2)" },
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
  sourcePreview: { display: "block", flex: 1, width: "100%", minWidth: 0, minHeight: 0, border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "#fff" },
  sourceDialogBody: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, minHeight: 0, width: "100%", flex: 1, overflow: "hidden", boxSizing: "border-box" },
  sourceDialogContent: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, minHeight: 0, width: "100%", flex: 1, overflow: "hidden", boxSizing: "border-box" },
  sourceSearchRow: { display: "flex", alignItems: "center", gap: "10px" },
  sourceSearch: { flex: 1, minWidth: 0, height: "36px", padding: "0 10px", border: "1px solid var(--colorNeutralStroke1)", borderRadius: "4px", color: "var(--colorNeutralForeground1)", backgroundColor: "var(--colorNeutralBackground1)", font: "inherit" },
  sourceSearchCount: { minWidth: "90px", textAlign: "right", color: "var(--colorNeutralForeground3)" },
  sourceText: { display: "block", flex: 1, minWidth: 0, minHeight: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflow: "auto", margin: 0, padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground2)", color: "var(--colorNeutralForeground1)", fontFamily: "Consolas, 'Courier New', monospace", fontSize: "13px", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  sourceJsonKey: { color: "var(--colorPaletteBlueForeground2)" },
  sourceJsonString: { color: "var(--colorPaletteGreenForeground2)" },
  sourceJsonNumber: { color: "var(--colorPaletteMarigoldForeground2)" },
  sourceJsonLiteral: { color: "var(--colorPalettePurpleForeground2)" },
  sourceJsonPunctuation: { color: "var(--colorNeutralForeground2)" },
  sourceHtmlTag: { color: "var(--colorPaletteBlueForeground2)" },
  sourceHtmlAttribute: { color: "var(--colorPalettePurpleForeground2)" },
  sourceHtmlValue: { color: "var(--colorPaletteGreenForeground2)" },
  sourceHtmlComment: { color: "var(--colorNeutralForeground3)", fontStyle: "italic" },
  comparisonDialog: { display: "flex", flexDirection: "column", width: "min(1400px, calc(100vw - 48px))", maxWidth: "1400px", height: "min(900px, calc(100vh - 48px))", maxHeight: "calc(100vh - 48px)", overflow: "hidden" },
  comparisonDialogBody: { display: "flex", flexDirection: "column", flex: "1 1 auto", alignSelf: "stretch", width: "100%", minHeight: 0, overflow: "hidden", boxSizing: "border-box" },
  comparisonDialogHeader: { flexShrink: 0 },
  comparisonDialogContent: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: "4px" },
  comparisonDialogActions: { position: "relative", zIndex: 2, display: "flex", justifyContent: "flex-end", gap: "8px", flex: "0 0 auto", marginTop: "0", paddingTop: "12px", borderTop: "1px solid var(--colorNeutralStroke2)", backgroundColor: "var(--colorNeutralBackground1)" },
  comparisonLoading: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", padding: "12px 14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground2)" },
  comparisonLoadingCopy: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  comparisonLoadingTitle: { fontWeight: 600 },
  comparisonLoadingDetail: { color: "var(--colorNeutralForeground2)", overflowWrap: "anywhere" },
  comparisonDropdown: { width: "100%", minWidth: 0, "& .fui-Dropdown__button": { display: "block", position: "relative", height: "32px", minHeight: "32px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: "30px" }, "& .fui-Dropdown__expandIcon": { position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)" } },
  comparisonNameInput: { width: "100%", minWidth: 0, height: "32px", minHeight: "32px" },
  comparisonTargetListbox: { minWidth: "min(520px, calc(100vw - 64px))", maxWidth: "min(620px, calc(100vw - 64px))", maxHeight: "320px", overflowY: "auto", "& [role=option]": { boxSizing: "border-box", flexShrink: 0, height: "32px", minHeight: "32px", maxHeight: "32px", overflow: "hidden" } },
  comparisonTargetOptionText: { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  comparisonCellText: { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  comparisonStatus: { display: "flex", alignItems: "center", minWidth: 0, whiteSpace: "nowrap", "& > span:first-child": { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
  comparisonEnvironments: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: "16px", marginBottom: "12px", "@media (max-width: 640px)": { gridTemplateColumns: "1fr", gap: "6px" } },
  comparisonEnvironment: { minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  comparisonEnvironmentLabel: { color: "var(--colorNeutralForeground3)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" },
  comparisonEnvironmentValue: { overflowWrap: "anywhere" },
  comparisonArrow: { display: "flex", alignItems: "center", justifyContent: "center", color: "var(--colorNeutralForeground3)", "@media (max-width: 640px)": { transform: "rotate(90deg)" } },
  comparisonSummary: { display: "flex", gap: "10px", rowGap: "8px", flexWrap: "wrap", marginBottom: "12px" },
  comparisonTable: { width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", "& th, & td": { boxSizing: "border-box", padding: "8px", borderBottom: "1px solid var(--colorNeutralStroke2)", textAlign: "left", verticalAlign: "middle" }, "& th": { position: "sticky", top: 0, zIndex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--colorNeutralForeground3)", fontWeight: 600, backgroundColor: "var(--colorNeutralBackground1)", boxShadow: "0 1px 0 var(--colorNeutralStroke2)" }, "& th:nth-child(1), & td:nth-child(1)": { width: "40px", paddingLeft: "6px", paddingRight: "4px" }, "& th:nth-child(2), & td:nth-child(2)": { width: "12%" }, "& th:nth-child(3), & td:nth-child(3)": { width: "22%" }, "& th:nth-child(4), & td:nth-child(4)": { width: "13%" }, "& th:nth-child(5), & td:nth-child(5)": { width: "20%" }, "& th:nth-child(6), & td:nth-child(6)": { width: "29%" } },
  comparisonHint: { display: "inline-flex", alignItems: "center", marginLeft: "6px", color: "var(--colorNeutralForeground3)", verticalAlign: "middle", cursor: "help" },
  comparisonActionText: { display: "inline-flex", alignItems: "center", minHeight: "32px", color: "var(--colorNeutralForeground2)" },
  transferLog: { display: "flex", flexDirection: "column", gap: "8px", padding: "10px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground2)" },
  transferLogEntry: { display: "grid", gridTemplateColumns: "76px minmax(0, 1fr)", gap: "8px", alignItems: "start", fontSize: "13px" },
  transferLogError: { gridColumn: "2", color: "var(--colorPaletteRedForeground1)", overflowWrap: "anywhere" },
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
  journey: getArtifactLabel("journey"),
  journeyVersion: getArtifactLabel("journeyVersion"),
  journeyAction: getArtifactLabel("journeyAction"),
  task: getArtifactLabel("task"),
  trigger: getArtifactLabel("trigger"),
  email: getArtifactLabel("email"),
  marketingForm: getArtifactLabel("marketingForm"),
  compliance: getArtifactLabel("compliance"),
  purpose: getArtifactLabel("purpose"),
  topic: getArtifactLabel("topic"),
  sender: getArtifactLabel("sender"),
  brandProfile: getArtifactLabel("brandProfile"),
  template: getArtifactLabel("template"),
  contentBlock: getArtifactLabel("contentBlock"),
  segment: getArtifactLabel("segment"),
  asset: getArtifactLabel("asset"),
  team: getArtifactLabel("team"),
  businessRecord: getArtifactLabel("businessRecord"),
  unknown: getArtifactLabel("unknown"),
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

function formatFieldValue(value: unknown, fieldName?: string, record?: Record<string, unknown>, optionSetLabels?: Record<string, Record<string, string>>): string | undefined {
  if (fieldName && record) {
    const formatted = record[`${fieldName}@OData.Community.Display.V1.FormattedValue`];
    if (typeof formatted === "string" && formatted.trim()) {
      return typeof value === "number" ? `${formatted} (${value})` : formatted;
    }
    if (typeof value === "number") {
      const label = optionSetLabels?.[fieldName.toLowerCase()]?.[String(value)];
      if (label) return `${label} (${value})`;
    }
  }
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

function isHtmlSource(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return false;
    } catch {
      // Continue and identify HTML fragments, if any.
    }
  }
  return /<!doctype\s+html|<\/?[a-z][\w:-]*(?:\s|>|\/)/i.test(trimmed);
}

export function DiscoveryExplorer({ connection, isLoadingConnection, connectionRevision }: Props) {
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
  const [sourceDialog, setSourceDialog] = useState<{ label: string; text: string; originalText: string; isHtml: boolean } | null>(null);
  const [isHtmlPreview, setIsHtmlPreview] = useState(false);
  const [sourceSyntaxTokens, setSourceSyntaxTokens] = useState<SourceToken[]>([]);
  const [sourceSearchQuery, setSourceSearchQuery] = useState("");
  const [sourceSearchRun, setSourceSearchRun] = useState(0);
  const [activeSourceMatch, setActiveSourceMatch] = useState(0);
  const [sourceCopied, setSourceCopied] = useState(false);
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
  const sourceTextRef = useRef<HTMLPreElement>(null);
  const journeyLoadRequestId = useRef(0);
  const comparisonRequestId = useRef(0);

  const resetTransferState = () => {
    setMigrationPreviewStarted(false);
    setIsTransferring(false);
    setTransferResult(null);
    setTransferLog([]);
    setTransferFatalError(null);
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
  const embeddedCondition = selectedArtifact?.logicalName === "journey-embedded" ? getJourneyCondition(selectedArtifact.sourceRecord, selectedArtifact.conditionOptionLabels, selectedArtifact.conditionLookupValues) : undefined;
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
    return [...scalarFields, ...formattedLookupFields, ...resolvedLookupFields].slice(0, 60);
  }, [discovery, selectedArtifact]);
  const selectedArtifactAttributes = useMemo(() => {
    if (!selectedArtifact) return [];
    const record = selectedArtifact.sourceRecord;
    return selectedArtifactFields.map(([key, value]) => {
      const friendlyKey = key.replace(/^_/, "").replace(/_value$/, "").toLowerCase();
      return {
        key,
        label: selectedArtifact.fieldDisplayNames?.[friendlyKey] ?? humanizeFieldName(friendlyKey),
        value: formatFieldValue(value, key, record, selectedArtifact.optionSetLabels) ?? "—",
        sourceText: typeof value === "string" && (
          isJsonOrHtmlField(key, value) ||
          selectedArtifact.fieldTypes?.[friendlyKey] === "Memo" ||
          (value.includes("\n") && value.length > 160)
        ) ? toSourceText(value) : undefined,
        sourceIsHtml: typeof value === "string" && isJsonOrHtmlField(key, value) && isHtmlSource(value),
      };
    }).sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) || left.key.localeCompare(right.key));
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
  const openSourceDialog = (label: string, text: string, isHtmlOverride?: boolean) => {
    const formattedText = formatSourceText(text);
    setSourceDialog({ label, text: formattedText, originalText: text, isHtml: isHtmlOverride ?? isHtmlSource(text) });
    setIsHtmlPreview(false);
    setSourceSyntaxTokens(tokenizeSourceText(formattedText));
    setSourceSearchQuery("");
    setActiveSourceMatch(0);
    setSourceSearchRun(0);
    setSourceCopied(false);
  };
  const copySourceText = async () => {
    if (!sourceDialog) return;
    try {
      await window.toolboxAPI.utils.copyToClipboard(sourceDialog.originalText);
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

  const sourceTokenClass: Record<SourceTokenKind, string> = {
    jsonKey: styles.sourceJsonKey,
    jsonString: styles.sourceJsonString,
    jsonNumber: styles.sourceJsonNumber,
    jsonLiteral: styles.sourceJsonLiteral,
    jsonPunctuation: styles.sourceJsonPunctuation,
    htmlTag: styles.sourceHtmlTag,
    htmlAttribute: styles.sourceHtmlAttribute,
    htmlValue: styles.sourceHtmlValue,
    htmlComment: styles.sourceHtmlComment,
  };

  const renderSourceText = () => {
    if (!sourceDialog) return null;
    const highlights = sourceSearchQuery && sourceMatches.length
      ? sourceMatches.map((match, index) => ({ ...match, className: index === activeSourceMatch ? styles.sourceMatchActive : styles.sourceMatch, active: index === activeSourceMatch }))
      : [];
    const boundaries = new Set<number>([0, sourceDialog.text.length]);
    for (const token of sourceSyntaxTokens) { boundaries.add(token.start); boundaries.add(token.end); }
    for (const highlight of highlights) { boundaries.add(highlight.start); boundaries.add(highlight.end); }
    const sorted = [...boundaries].sort((left, right) => left - right);
    return sorted.slice(0, -1).map((start, index) => {
      const end = sorted[index + 1];
      if (end <= start) return null;
      const token = sourceSyntaxTokens.find((candidate) => candidate.start <= start && candidate.end >= end);
      const highlight = highlights.find((candidate) => candidate.start <= start && candidate.end >= end);
      const text = sourceDialog.text.slice(start, end);
      const className = [token ? sourceTokenClass[token.kind] : "", highlight?.className ?? ""].filter(Boolean).join(" ") || undefined;
      return <span key={`${start}:${end}`} className={className} data-active-source-match={highlight?.active ? "true" : undefined}>{text}</span>;
    });
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

  const compareWithTarget = async () => {
    if (!selectedJourney || !discovery || !secondaryConnection) return;
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

  const matchLabel = (match: ArtifactMatch) => ({
    "missing": "Missing",
    "exact-match": "Already exists",
    "changed": "Changed",
    "ambiguous": "Ambiguous",
    "unsupported": "Embedded node",
  }[match.status]);

  const matchColor = (match: ArtifactMatch): "success" | "warning" | "danger" | "informative" | "subtle" => ({
    "missing": "warning",
    "exact-match": "success",
    "changed": "danger",
    "ambiguous": "danger",
    "unsupported": "subtle",
  } as const)[match.status];

  const actionLabels: Record<MigrationAction, string> = {
    create: "Create",
    skip: "Skip",
    "automatically-mapped": "Automatically mapped",
    manual: "Manual mapping",
    blocked: "Blocked",
    embedded: "Included in Journey JSON",
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
      } catch (cause) {
        if (requestId === targetRequestId.current) setError(`Could not load target Journeys: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        if (requestId === targetRequestId.current) setLoadingTargetId(null);
      }
      return;
    }
    const ancestors = new Set<string>([sourceArtifactId]);
    let pending = [sourceArtifactId];
    while (pending.length) {
      const parentIds = comparison.source.dependencies
        .filter((dependency) => pending.includes(dependency.sourceArtifactId) && dependency.targetArtifactId)
        .map((dependency) => dependency.targetArtifactId!)
        .filter((id) => !ancestors.has(id));
      parentIds.forEach((id) => ancestors.add(id));
      pending = parentIds;
    }
    const scopedSource: DiscoveryResult = {
      ...comparison.source,
      artifacts: comparison.source.artifacts.filter((artifact) => ancestors.has(artifact.id)),
      dependencies: comparison.source.dependencies.filter((dependency) => ancestors.has(dependency.sourceArtifactId) && (!dependency.targetArtifactId || ancestors.has(dependency.targetArtifactId))),
    };
    const overrides = new Map<string, Artifact>();
    for (const id of ancestors) {
      if (id === sourceArtifactId) continue;
      const planItem = comparison.plan.find((item) => item.sourceArtifactId === id);
      const target = planItem?.targetArtifactId ? comparison.target?.artifacts.find((artifact) => artifact.id === planItem.targetArtifactId) : undefined;
      if (target) overrides.set(id, target);
    }
    try {
      const refreshed = await discoverArtifactsByIdentity(scopedSource, secondaryConnection.url, "secondary", overrides, true);
      if (requestId !== targetRequestId.current) return;
      setTargetCandidates((current) => ({ ...current, [sourceArtifactId]: refreshed.artifacts.filter((artifact) => artifact.logicalName.toLowerCase() === sourceArtifact.logicalName.toLowerCase()) }));
    } catch (cause) {
      if (requestId === targetRequestId.current) setError(`Could not load target records: ${cause instanceof Error ? cause.message : String(cause)}`);
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
            {!artifact.deleted && artifact.logicalName !== "journey-embedded" && statusLabel && <Badge className={styles.treeMeta} appearance="tint" color={artifact.status ? "warning" : "success"}>{statusLabel}</Badge>}
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
          <Button appearance="primary" disabled={!discovery || !secondaryConnection || isComparing || isLoadingSecondaryConnection} title={!secondaryConnection && !isLoadingSecondaryConnection ? "Configure an optional target connection to compare or migrate" : undefined} onClick={() => void compareWithTarget()}>
            {isComparing ? "Comparing…" : "Compare with target"}
          </Button>
          {!secondaryConnection && !isLoadingSecondaryConnection && <Text size={200} title="Journey discovery works without a target. Comparison and migration need an optional secondary connection.">Target connection not set</Text>}
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
                <div id="dependency-tree-title" className={styles.panelTitle}>
                  <span className={styles.panelTitleIcon} aria-hidden="true"><TextBulletListTree20Regular /></span>
                  <span>Dependency tree</span>
                </div>
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
              <div id="object-details-title" className={styles.panelTitle}>
                <span className={styles.panelTitleIcon} aria-hidden="true"><DocumentSearch20Regular /></span>
                <span>Object details</span>
              </div>
              <Divider />
            </header>
            {selectedDependency ? <div className={styles.detailRecordHeader}>
              <div className={styles.detailHeroRow}>
                <Text className={styles.detailHeroTitle}>{selectedDependency.label}</Text>
                <div className={styles.detailHeroAside}>
                  <div className={styles.detailBadges}><Badge appearance="tint" color={selectedDependency.targetDeleted ? "danger" : "warning"}>{selectedDependency.targetDeleted ? "Deleted in Dataverse" : "Unresolved reference"}</Badge></div>
                </div>
              </div>
            </div> : selectedArtifact ? <div className={styles.detailRecordHeader}>
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
                    {selectedArtifact.status && <Badge appearance="tint" color="warning">{selectedArtifact.statusDisplay ?? getOptionLabel(selectedArtifact.status, selectedArtifact.statusLabels)}</Badge>}
                  </div>
                  <div className={styles.detailActions}>
                    {selectedArtifact.logicalName === "journey-embedded"
                      ? <Button appearance="secondary" onClick={() => openSourceDialog(selectedArtifact.displayName, toSourceText(selectedArtifact.sourceRecord))}>Open JSON</Button>
                      : <Button appearance="primary" onClick={() => void openArtifact(selectedArtifact)} disabled={!selectedArtifact.dataverseUrl || selectedArtifact.deleted}>Open in Dataverse</Button>}
                  </div>
                </div>
              </div>
            </div> : null}
            <div className={styles.panelBody}>
                {selectedDependency ? (
                  <div className={styles.details}>
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
                          {selectedArtifactAttributes.map(({ key, label, value, sourceText, sourceIsHtml }) => (
                            <tr key={key}>
                              <th scope="row">{label}</th>
                              <td>
                                <div className={styles.fieldValueCell}>
                                  {sourceText && (
                                    <Button size="small" appearance="subtle" onClick={() => openSourceDialog(label, sourceText, sourceIsHtml)}>
                                      {sourceIsHtml ? "Open JSON / HTML" : "Open text"}
                                    </Button>
                                  )}
                                  {!sourceText && <Text className={styles.fieldPreview}>{value}</Text>}
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
                  {sourceDialog?.isHtml && <Button appearance={isHtmlPreview ? "primary" : "secondary"} onClick={() => setIsHtmlPreview((current) => !current)}>
                    {isHtmlPreview ? "View source" : "Preview"}
                  </Button>}
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
              {isHtmlPreview && sourceDialog?.isHtml
                ? <iframe
                    className={styles.sourcePreview}
                    title={`Safe HTML preview: ${sourceDialog.label}`}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';"></head><body>${sourceDialog.originalText}</body></html>`}
                  />
                : <pre className={styles.sourceText} ref={sourceTextRef}>{renderSourceText()}</pre>}
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={comparison !== null || isComparing} onOpenChange={(_event, data) => { if (!data.open && !isComparing) { targetRequestId.current += 1; setTargetCandidates({}); setComparison(null); resetTransferState(); } }}>
        <DialogSurface className={styles.comparisonDialog}>
           <DialogBody className={styles.comparisonDialogBody}>
             <DialogTitle>Target comparison</DialogTitle>
             <div className={styles.comparisonDialogHeader}>
               <div className={styles.comparisonEnvironments}>
                <div className={styles.comparisonEnvironment}>
                  <Text className={styles.comparisonEnvironmentLabel}>Source</Text>
                  <Text className={styles.comparisonEnvironmentValue}>{connection?.name ?? connection?.url ?? "—"}</Text>
                </div>
                <div className={styles.comparisonArrow} aria-hidden="true"><ArrowRight24Regular /></div>
                <div className={styles.comparisonEnvironment}>
                  <Text className={styles.comparisonEnvironmentLabel}>Target</Text>
                  <Text className={styles.comparisonEnvironmentValue}>{secondaryConnection?.name ?? secondaryConnection?.url ?? "—"}</Text>
                </div>
              </div>
               {isComparing && <div className={styles.comparisonLoading} role="status" aria-live="polite">
                <Spinner size="tiny" label="Loading target comparison" />
                <div className={styles.comparisonLoadingCopy}>
                  <Text className={styles.comparisonLoadingTitle}>Comparing target</Text>
                  <Text className={styles.comparisonLoadingDetail}>{comparisonProgress || "Loading target artifacts…"}</Text>
                 </div>
               </div>}
                {comparison && (() => {
                 const counts = comparison.matches.reduce<Record<string, number>>((result, match) => ({ ...result, [match.status]: (result[match.status] ?? 0) + 1 }), {});
                  const plannedCreates = comparison.plan.filter((item) => item.selected && item.action === "create").length;
                 return <div className={styles.comparisonSummary}>
                   <Badge color="success">Already exists: {counts["exact-match"] ?? 0}</Badge>
                   <Badge color="warning">Missing: {counts.missing ?? 0}</Badge>
                   <Badge color="danger">Changed: {counts.changed ?? 0}</Badge>
                   <Badge color="danger">Ambiguous: {counts.ambiguous ?? 0}</Badge>
                   <Badge color="informative">Planned creates: {plannedCreates}</Badge>
                  </div>;
                })()}
                {comparison && <MessageBar intent="info"><MessageBarBody><MessageBarTitle>Create-only migration</MessageBarTitle>Missing elements are selected for creation. Existing elements are skipped and never updated. Embedded nodes are written as part of the Journey JSON.</MessageBarBody></MessageBar>}
              </div>
              <DialogContent className={styles.comparisonDialogContent}>
                {comparison && (() => {
                  return <>
                  {migrationPreviewStarted && <MessageBar intent="success"><MessageBarBody><MessageBarTitle>Preview prepared</MessageBarTitle>The migration plan was copied to the clipboard. Dataverse was not changed.</MessageBarBody></MessageBar>}
                  {Boolean(isTransferring || transferResult || transferFatalError) ? <div className={styles.transferLog} role="log" aria-live="polite">
                    <Text weight="semibold">Migration log</Text>
                    {transferLog.map((entry, index) => <div className={styles.transferLogEntry} key={`${entry.artifact.id}:${index}`}>
                      <Badge color={entry.status === "failed" ? "danger" : entry.status === "created" ? "success" : "informative"}>{entry.status}</Badge>
                      <Text>{entry.message ?? `${entry.artifact.displayName}: ${entry.status}`}</Text>
                      {entry.error && <Text className={styles.transferLogError}>{entry.error}</Text>}
                    </div>)}
                    {transferResult ? <Text>Migration result: {transferResult.created.length} created, {transferResult.skipped.length} skipped, {transferResult.failed.length} failed.</Text> : null}
                    {transferFatalError && <MessageBar intent="error"><MessageBarBody><MessageBarTitle>Migration stopped</MessageBarTitle>{transferFatalError}</MessageBarBody></MessageBar>}
                  </div> : <>
                   {comparison.warnings.map((warning) => <MessageBar key={warning} intent="warning"><MessageBarBody>{warning}</MessageBarBody></MessageBar>)}
                  <table className={styles.comparisonTable}>
                    <thead><tr><th><Checkbox
                      checked={comparison.plan.filter(canSelectPlanItem).length > 0 && comparison.plan.filter(canSelectPlanItem).every((item) => item.selected)}
                      onChange={(_event, data) => toggleAllSelectable(Boolean(data.checked))}
                      aria-label="Select all migratable elements"
                    /></th><th title="Type">Type</th><th title="Element">Element</th><th title="Target status">Target status</th><th title="Planned action">Planned action</th><th title="Target record">Target record</th></tr></thead>
                    <tbody>{comparison.plan.map((match) => {
                      const artifact = comparison.source.artifacts.find((item) => item.id === match.sourceArtifactId);
                      return <tr key={match.sourceArtifactId}>
                        <td><Checkbox checked={match.selected} disabled={!canSelectPlanItem(match)} onChange={(_event, data) => togglePlanSelection(match.sourceArtifactId, Boolean(data.checked))} aria-label={`Include ${artifact?.displayName ?? match.sourceArtifactId}`} /></td>
                         <td><span className={styles.comparisonCellText} title={artifact ? kindLabels[artifact.kind] : "Unknown"}>{artifact ? kindLabels[artifact.kind] : "Unknown"}</span></td>
                         <td><span className={styles.comparisonCellText} title={artifact?.displayName ?? match.sourceArtifactId}>{artifact?.displayName ?? match.sourceArtifactId}</span></td>
                         <td><div className={styles.comparisonStatus}><Badge color={matchColor(match)} title={matchLabel(match)}>{matchLabel(match)}</Badge>{[...match.warnings, ...comparison.blockingErrors.filter((blockingError) => blockingError.startsWith(`${match.sourceArtifactId}:`))].map((warning) => <span key={warning} className={styles.comparisonHint} title={warning} aria-label={warning}><Info16Regular /></span>)}</div></td>
                         <td>
                           {match.action === "embedded" ? <span className={`${styles.comparisonActionText} ${styles.comparisonCellText}`} title="Included in Journey JSON">Included in Journey JSON</span> : <Dropdown
                             className={styles.comparisonDropdown}
                             inlinePopup
                             value={actionLabels[match.action]}
                             title={actionLabels[match.action]}
                             selectedOptions={[match.action]}
                             onOptionSelect={(_event, data) => updatePlanAction(match.sourceArtifactId, (data.optionValue ?? "skip") as MigrationAction)}
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
                              className={styles.comparisonNameInput}
                              value={match.createName ?? artifact.displayName}
                              title={match.createName ?? artifact.displayName}
                              aria-label={`Target name for ${artifact.displayName}`}
                              onChange={(_event, data) => updateCreateName(match.sourceArtifactId, data.value)}
                            />}
                            {artifact && match.action !== "embedded" && match.action !== "create" && match.action !== "skip" && match.action !== "blocked" && (() => {
                             const options = new Map<string, Artifact>();
                             const selected = match.targetArtifactId ? comparison.target?.artifacts.find((item) => item.id === match.targetArtifactId) : undefined;
                             if (selected) options.set(selected.id, selected);
                              for (const candidate of targetCandidates[match.sourceArtifactId] ?? []) options.set(candidate.id, candidate);
                              const sortedOptions = [...options.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) || left.recordId.localeCompare(right.recordId));
                              const selectedLabel = selected ? `${selected.displayName} (${selected.recordId})` : "";
                             return <Dropdown
                               className={styles.comparisonDropdown}
                               inlinePopup
                               listbox={{ className: styles.comparisonTargetListbox }}
                               positioning={{ position: "below", align: "end", fallbackPositions: [] }}
                               placeholder={loadingTargetId === match.sourceArtifactId ? "Loading…" : "Select target record"}
                               value={selectedLabel}
                               title={selectedLabel || (loadingTargetId === match.sourceArtifactId ? "Loading target records…" : "Select target record")}
                               selectedOptions={selected ? [selected.id] : []}
                               onOpenChange={(_event, data) => { if (data.open) void loadTargetCandidates(match.sourceArtifactId); }}
                               onOptionSelect={(_event, data) => {
                                 const target = options.get(data.optionValue ?? "");
                                 if (target) selectTargetRecord(match.sourceArtifactId, target);
                               }}
                               aria-label={`Target record for ${artifact.displayName}`}
                             >
                                {sortedOptions.map((candidate) => <Option key={candidate.id} value={candidate.id} text={`${candidate.displayName} (${candidate.recordId})`} title={`${candidate.displayName} (${candidate.recordId})`}><span className={styles.comparisonTargetOptionText}>{candidate.displayName} ({candidate.recordId})</span></Option>)}
                               {!options.size && <Option value="no-target-records" disabled>{loadingTargetId === match.sourceArtifactId ? "Loading target records…" : "No target records found"}</Option>}
                             </Dropdown>;
                           })()}
                         </td>
                      </tr>;
                    })}</tbody>
                  </table></>}
                </>;
              })()}
            </DialogContent>
            <DialogActions className={styles.comparisonDialogActions}><Button appearance="secondary" onClick={() => { setComparison(null); resetTransferState(); }} disabled={isTransferring}>Close</Button><Button appearance="primary" disabled={isTransferring || !comparison?.plan.some((item) => item.selected && item.action === "create") || Boolean(comparison?.plan.some((item) => item.selected && item.action !== "skip" && (item.action === "manual" || item.action === "automatically-mapped") && !item.targetRecordId))} onClick={() => void startMigration()}>{isTransferring ? "Migrating…" : "Start migration"}</Button></DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
