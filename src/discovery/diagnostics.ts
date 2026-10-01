export type DiagnosticEntry = {
  timestamp: string;
  level: "error" | "warning" | "info";
  phase: string;
  message: string;
  entity?: string;
  query?: string;
  rawResult?: unknown;
  error?: Record<string, unknown>;
};

type DiagnosticContext = {
  sourceArtifactId?: string;
  sourceDisplayName?: string;
};

const MAX_ENTRIES = 500;
const DIAGNOSTIC_EVENT = "journey-explorer:diagnostic";
const guidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const sensitiveKeyPattern = /token|authorization|cookie|password|secret|credential/i;
const entries: DiagnosticEntry[] = [];

function sanitizeQuery(query?: string): string | undefined {
  if (!query) return undefined;
  return query.replace(guidPattern, "<guid>").slice(0, 4000);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const result: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    for (const key of Object.getOwnPropertyNames(error)) {
      if (key in result || sensitiveKeyPattern.test(key)) continue;
      const value = (error as Error & Record<string, unknown>)[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        result[key] = value;
      }
    }
    return result;
  }
  if (error && typeof error === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(error)) {
      if (sensitiveKeyPattern.test(key)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") result[key] = value;
      else if (value instanceof Error) result[key] = serializeError(value);
    }
    return result;
  }
  return { message: String(error) };
}

export function logDiagnostic(
  entry: Omit<DiagnosticEntry, "timestamp" | "error"> & { error?: unknown } & DiagnosticContext,
): DiagnosticEntry {
  const diagnostic: DiagnosticEntry = {
    ...entry,
    query: sanitizeQuery(entry.query),
    error: entry.error === undefined ? undefined : serializeError(entry.error),
    timestamp: new Date().toISOString(),
  };
  entries.push(diagnostic);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  const consoleMessage = [
    `[Customer Journey Explorer] ${diagnostic.level.toUpperCase()}`,
    `phase=${diagnostic.phase}`,
    diagnostic.entity ? `entity=${diagnostic.entity}` : undefined,
    entry.sourceDisplayName ? `item=${entry.sourceDisplayName}` : undefined,
    entry.sourceArtifactId ? `itemId=${entry.sourceArtifactId}` : undefined,
    diagnostic.message,
    diagnostic.query ? `query=${diagnostic.query}` : undefined,
    diagnostic.error?.message ? `error=${diagnostic.error.message}` : undefined,
  ].filter(Boolean).join(" | ");
  const consoleDetails = { ...diagnostic, sourceArtifactId: entry.sourceArtifactId, sourceDisplayName: entry.sourceDisplayName };
  if (diagnostic.level === "error") {
    console.error(consoleMessage, consoleDetails);
  } else if (diagnostic.level === "warning") {
    console.warn(consoleMessage, consoleDetails);
  } else {
    console.info(consoleMessage, consoleDetails);
  }

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(DIAGNOSTIC_EVENT, { detail: diagnostic }));
  }
  return diagnostic;
}

export function getDiagnostics(): DiagnosticEntry[] {
  return [...entries];
}

export function clearDiagnostics(): void {
  entries.length = 0;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(DIAGNOSTIC_EVENT, { detail: null }));
  }
}

export function getDiagnosticEventName(): string {
  return DIAGNOSTIC_EVENT;
}
