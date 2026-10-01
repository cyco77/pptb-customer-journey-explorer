const VOID_HTML_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

export type SourceTokenKind = "jsonKey" | "jsonString" | "jsonNumber" | "jsonLiteral" | "jsonPunctuation" | "htmlTag" | "htmlAttribute" | "htmlValue" | "htmlComment";
export type SourceToken = { start: number; end: number; kind: SourceTokenKind };

export function formatHtmlSource(source: string): string {
  let depth = 0;
  const tokens = source.match(/<[^>]+>|[^<]+/g) ?? [source];
  const lines: string[] = [];
  for (const token of tokens) {
    const line = token.trim();
    if (!line) continue;
    const isTag = line.startsWith("<");
    const isClosing = isTag && /^<\//.test(line);
    if (isClosing) depth = Math.max(0, depth - 1);
    lines.push(`${"  ".repeat(depth)}${line}`);
    const tagName = isTag ? line.match(/^<\s*([a-z][\w:-]*)\b/i)?.[1]?.toLowerCase() : undefined;
    const isOpening = isTag && /^<[a-z][\w:-]*(?:\s|>|\/)/i.test(line);
    const isSelfClosing = /\/\s*>$/.test(line);
    if (isOpening && !isClosing && !isSelfClosing && tagName && !VOID_HTML_TAGS.has(tagName)) depth += 1;
  }
  return lines.join("\n");
}

export function formatSourceText(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return source;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed) as unknown, null, 2);
    } catch {
      // Keep malformed JSON unchanged so its source is still inspectable.
    }
  }
  if (/<\/?[a-z][\s\S]*?>|<!doctype\s+html/i.test(trimmed)) return formatHtmlSource(source);
  return source;
}

export function tokenizeSourceText(source: string): SourceToken[] {
  const trimmed = source.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return tokenizeJson(source);
    } catch {
      // Invalid JSON falls through to plain-text / HTML detection.
    }
  }
  if (/<\/?[a-z][\s\S]*?>|<!doctype\s+html/i.test(trimmed)) return tokenizeHtml(source);
  return [];
}

function tokenizeJson(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  const pattern = /"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b|[{}\[\],:]/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const value = match[0];
    let kind: SourceTokenKind;
    if (value.startsWith('"')) {
      kind = /^\s*:/.test(source.slice(start + value.length)) ? "jsonKey" : "jsonString";
    } else if (/^-?\d/.test(value)) kind = "jsonNumber";
    else if (/^(?:true|false|null)$/.test(value)) kind = "jsonLiteral";
    else kind = "jsonPunctuation";
    tokens.push({ start, end: start + value.length, kind });
  }
  return tokens;
}

function tokenizeHtml(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  const markup = /<!--[\s\S]*?-->|<!doctype\b[^>]*>|<\/?[a-z][^>]*>/gi;
  for (const match of source.matchAll(markup)) {
    const start = match.index ?? 0;
    const value = match[0];
    if (value.startsWith("<!--") || /^<!doctype/i.test(value)) {
      tokens.push({ start, end: start + value.length, kind: "htmlComment" });
      continue;
    }
    const nameMatch = value.match(/^<\/?([a-z][\w:-]*)/i);
    if (nameMatch) tokens.push({ start, end: start + nameMatch[0].length, kind: "htmlTag" });
    const nameEnd = nameMatch ? nameMatch[0].length : 1;
    const rest = value.slice(nameEnd, value.endsWith(">") ? -1 : undefined);
    const attributes = /([:\w-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g;
    for (const attributeMatch of rest.matchAll(attributes)) {
      const attributeStart = start + nameEnd + (attributeMatch.index ?? 0);
      tokens.push({ start: attributeStart, end: attributeStart + attributeMatch[1].length, kind: "htmlAttribute" });
      const valueOffset = attributeMatch[0].lastIndexOf(attributeMatch[3]);
      tokens.push({ start: attributeStart + valueOffset, end: attributeStart + valueOffset + attributeMatch[3].length, kind: "htmlValue" });
    }
    const delimiterStart = start + value.length - (value.endsWith("/>") ? 2 : 1);
    if (delimiterStart >= start + nameEnd) tokens.push({ start: delimiterStart, end: start + value.length, kind: "htmlTag" });
  }
  return tokens.sort((left, right) => left.start - right.start);
}
