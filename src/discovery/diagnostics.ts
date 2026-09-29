export type DiagnosticEntry = {
  timestamp: string;
  level: "error" | "warning" | "info";
  phase: string;
  message: string;
  entity?: string;
  query?: string;
  error?: Record<string, unknown>;
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
  entry: Omit<DiagnosticEntry, "timestamp" | "error"> & { error?: unknown },
): DiagnosticEntry {
  const diagnostic: DiagnosticEntry = {
    ...entry,
    query: sanitizeQuery(entry.query),
    error: entry.error === undefined ? undefined : serializeError(entry.error),
    timestamp: new Date().toISOString(),
  };
  entries.push(diagnostic);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  if (diagnostic.level === "error") {
    console.error("[Customer Journey Explorer]", diagnostic, entry.error);
  } else if (diagnostic.level === "warning") {
    console.warn("[Customer Journey Explorer]", diagnostic);
  } else {
    console.info("[Customer Journey Explorer]", diagnostic);
  }

  window.dispatchEvent(new CustomEvent(DIAGNOSTIC_EVENT, { detail: diagnostic }));
  return diagnostic;
}

export function getDiagnostics(): DiagnosticEntry[] {
  return [...entries];
}

export function clearDiagnostics(): void {
  entries.length = 0;
  window.dispatchEvent(new CustomEvent(DIAGNOSTIC_EVENT, { detail: null }));
}

export function getDiagnosticEventName(): string {
  return DIAGNOSTIC_EVENT;
}
