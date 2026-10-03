import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
  makeStyles,
} from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import type { SourceToken, SourceTokenKind } from "../utils/sourceFormatting";
import { formatSourceText, tokenizeSourceText } from "../utils/sourceFormatting";

export type SourceDialogContent = {
  label: string;
  originalText: string;
  isHtml?: boolean;
};

type Props = {
  dialog: SourceDialogContent | null;
  onClose: () => void;
  onClearDiagnostics: () => void;
  onError: (message: string) => void;
};

const useStyles = makeStyles({
  surface: { display: "flex", flexDirection: "column", width: "min(1000px, calc(100vw - 48px))", maxWidth: "1000px", minWidth: 0, height: "min(800px, calc(100vh - 48px))", maxHeight: "calc(100vh - 48px)", overflow: "hidden", boxSizing: "border-box" },
  body: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, minHeight: 0, width: "100%", flex: 1, overflow: "hidden", boxSizing: "border-box" },
  content: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, minHeight: 0, width: "100%", flex: 1, overflow: "hidden", boxSizing: "border-box" },
  titleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
  closeButton: { flexShrink: 0 },
  preview: { display: "block", flex: 1, width: "100%", minWidth: 0, minHeight: 0, border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "#fff" },
  searchRow: { display: "flex", alignItems: "center", gap: "10px" },
  search: { flex: 1, minWidth: 0, height: "36px", padding: "0 10px", border: "1px solid var(--colorNeutralStroke1)", borderRadius: "4px", color: "var(--colorNeutralForeground1)", backgroundColor: "var(--colorNeutralBackground1)", font: "inherit" },
  searchCount: { minWidth: "90px", textAlign: "right", color: "var(--colorNeutralForeground3)" },
  text: { display: "block", flex: 1, minWidth: 0, minHeight: 0, width: "100%", maxWidth: "100%", boxSizing: "border-box", overflow: "auto", margin: 0, padding: "14px", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "6px", backgroundColor: "var(--colorNeutralBackground2)", color: "var(--colorNeutralForeground1)", fontFamily: "Consolas, 'Courier New', monospace", fontSize: "13px", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  jsonKey: { color: "var(--colorPaletteBlueForeground2)" },
  jsonString: { color: "var(--colorPaletteGreenForeground2)" },
  jsonNumber: { color: "var(--colorPaletteMarigoldForeground2)" },
  jsonLiteral: { color: "var(--colorPalettePurpleForeground2)" },
  jsonPunctuation: { color: "var(--colorNeutralForeground2)" },
  htmlTag: { color: "var(--colorPaletteBlueForeground2)" },
  htmlAttribute: { color: "var(--colorPalettePurpleForeground2)" },
  htmlValue: { color: "var(--colorPaletteGreenForeground2)" },
  htmlComment: { color: "var(--colorNeutralForeground3)", fontStyle: "italic" },
  match: { color: "inherit", backgroundColor: "var(--colorPaletteYellowBackground2)" },
  activeMatch: { color: "var(--colorNeutralForeground1)", backgroundColor: "var(--colorPaletteYellowBackground1)", outline: "2px solid var(--colorPaletteYellowBorderActive)" },
});

export function isHtmlSource(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return false;
    } catch {
      // Continue and detect HTML fragments if the JSON-looking text is malformed.
    }
  }
  return /<!doctype\s+html|<\/?[a-z][\w:-]*(?:\s|>|\/)/i.test(trimmed);
}

const SOURCE_TOKEN_STYLES: Record<SourceTokenKind, keyof ReturnType<typeof useStyles>> = {
  jsonKey: "jsonKey",
  jsonString: "jsonString",
  jsonNumber: "jsonNumber",
  jsonLiteral: "jsonLiteral",
  jsonPunctuation: "jsonPunctuation",
  htmlTag: "htmlTag",
  htmlAttribute: "htmlAttribute",
  htmlValue: "htmlValue",
  htmlComment: "htmlComment",
};

export function SourceTextDialog({ dialog, onClose, onClearDiagnostics, onError }: Props) {
  const styles = useStyles();
  const isHtml = dialog?.isHtml ?? isHtmlSource(dialog?.originalText ?? "");
  const [isHtmlPreview, setIsHtmlPreview] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [sourceTokens, setSourceTokens] = useState<SourceToken[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRun, setSearchRun] = useState(0);
  const [activeMatch, setActiveMatch] = useState(0);
  const [copied, setCopied] = useState(false);
  const sourceTextRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!dialog) return;
    const formatted = formatSourceText(dialog.originalText);
    setSourceText(formatted);
    setSourceTokens(tokenizeSourceText(formatted));
    setIsHtmlPreview(false);
    setSearchQuery("");
    setSearchRun(0);
    setActiveMatch(0);
    setCopied(false);
  }, [dialog]);

  const matches = useMemo(() => {
    if (!searchQuery) return [];
    const found: Array<{ start: number; end: number }> = [];
    const haystack = sourceText.toLocaleLowerCase();
    const needle = searchQuery.toLocaleLowerCase();
    let fromIndex = 0;
    while (fromIndex <= haystack.length - needle.length) {
      const start = haystack.indexOf(needle, fromIndex);
      if (start < 0) break;
      found.push({ start, end: start + needle.length });
      fromIndex = start + Math.max(needle.length, 1);
    }
    return found;
  }, [sourceText, searchQuery]);

  const copyText = async () => {
    if (!dialog) return;
    try {
      await window.toolboxAPI.utils.copyToClipboard(dialog.originalText);
      setCopied(true);
    } catch (cause) {
      onError(`Could not copy field text: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const searchNext = () => {
    if (!matches.length) return;
    setActiveMatch((current) => searchRun === 0 && current === 0 ? 0 : (current + 1) % matches.length);
    setSearchRun((current) => current + 1);
  };

  useEffect(() => {
    if (!searchRun) return;
    sourceTextRef.current
      ?.querySelector<HTMLElement>('[data-active-source-match="true"]')
      ?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [searchRun, activeMatch]);

  const renderSourceText = () => {
    const highlights = searchQuery && matches.length
      ? matches.map((match, index) => ({
        ...match,
        className: index === activeMatch ? styles.activeMatch : styles.match,
        active: index === activeMatch,
      }))
      : [];
    const boundaries = new Set<number>([0, sourceText.length]);
    for (const token of sourceTokens) { boundaries.add(token.start); boundaries.add(token.end); }
    for (const highlight of highlights) { boundaries.add(highlight.start); boundaries.add(highlight.end); }
    const sorted = [...boundaries].sort((left, right) => left - right);
    return sorted.slice(0, -1).map((start, index) => {
      const end = sorted[index + 1];
      if (end <= start) return null;
      const token = sourceTokens.find((candidate) => candidate.start <= start && candidate.end >= end);
      const highlight = highlights.find((candidate) => candidate.start <= start && candidate.end >= end);
      const className = [token ? styles[SOURCE_TOKEN_STYLES[token.kind]] : "", highlight?.className ?? ""].filter(Boolean).join(" ") || undefined;
      return <span key={`${start}:${end}`} className={className} data-active-source-match={highlight?.active ? "true" : undefined}>{sourceText.slice(start, end)}</span>;
    });
  };

  return (
    <Dialog open={dialog !== null} onOpenChange={(_event, data) => { if (!data.open) { setIsHtmlPreview(false); onClose(); } }}>
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.body}>
          <div className={styles.titleRow}>
            <DialogTitle>{dialog?.label ?? "Field source"}</DialogTitle>
            <Button
              className={styles.closeButton}
              appearance="subtle"
              size="small"
              icon={<Dismiss20Regular />}
              aria-label="Close dialog"
              title="Close"
              onClick={() => { setIsHtmlPreview(false); onClose(); }}
            />
          </div>
          <DialogContent className={styles.content}>
            <div className={styles.searchRow}>
              <input
                className={styles.search}
                type="search"
                placeholder="Search in text…"
                aria-label="Search in dialog text"
                value={searchQuery}
                onChange={(event) => { setSearchQuery(event.target.value); setActiveMatch(0); setSearchRun(0); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); searchNext(); }
                }}
              />
              <Text size={200} className={styles.searchCount}>
                {searchQuery ? (matches.length ? `${activeMatch + 1} / ${matches.length}` : "No matches") : "Enter to find"}
              </Text>
              <DialogActions>
                {isHtml && <Button appearance={isHtmlPreview ? "primary" : "secondary"} onClick={() => setIsHtmlPreview((current) => !current)}>
                  {isHtmlPreview ? "View source" : "Preview"}
                </Button>}
                <Button appearance="secondary" onClick={() => void copyText()} disabled={!dialog}>
                  {copied ? "Copied" : "Copy text"}
                </Button>
                {dialog?.label.startsWith("Diagnostics") && <Button appearance="secondary" onClick={onClearDiagnostics}>Clear log</Button>}
              </DialogActions>
            </div>
            {isHtmlPreview && isHtml
              ? <iframe
                  className={styles.preview}
                  title={`Safe HTML preview: ${dialog?.label ?? "source"}`}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: http: https:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';"></head><body>${dialog?.originalText ?? ""}</body></html>`}
                />
              : <pre className={styles.text} ref={sourceTextRef}>{renderSourceText()}</pre>}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
