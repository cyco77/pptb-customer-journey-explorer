export type FieldMapping = { field: string; value: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function inputValue(value: unknown): string | undefined {
  const input = asRecord(value);
  return text(input?.value) ?? text(value);
}

export function describeBinding(value: unknown): string | undefined {
  const binding = asRecord(value);
  if (!binding) return undefined;
  const inputs = asRecord(binding.inputs);
  const sourceType = inputValue(inputs?.sourceType);
  const recordId = asRecord(inputs?.recordId);
  const nestedBinding = asRecord(recordId?.binding);
  const source = text(binding.source);
  const output = text(binding.outputPath);
  const origin = source === "CdsProfileDataSource" ? `Profile ${sourceType ?? ""}`.trim()
    : source === "EventDataSource" ? `Event ${sourceType ?? ""}`.trim()
    : source === "DataverseDataSource" ? `Dataverse ${sourceType ?? ""}`.trim()
    : [source, sourceType].filter(Boolean).join(" ");
  const selectedRecord = nestedBinding ? describeBinding(nestedBinding) : undefined;
  return [origin || "Dynamic value", selectedRecord ? `(record: ${selectedRecord})` : undefined, output ? `→ ${output}` : undefined]
    .filter(Boolean).join(" ");
}

function describeMapping(value: unknown): string {
  const mapping = asRecord(value);
  if (!mapping) return String(value);
  const type = text(mapping.type)?.toLowerCase();
  if (type === "dynamic") {
    return describeBinding(asRecord(mapping.placeholder)?.binding) ?? JSON.stringify(mapping);
  }
  if (type === "static" || type === "rich") {
    const raw = mapping.value;
    if (type === "static" && typeof raw === "string") {
      try {
        const lookup = asRecord(JSON.parse(raw) as unknown);
        const entity = text(lookup?.logicalName);
        const id = text(lookup?.id);
        if (entity && id) return `${entity} (${id})`;
      } catch {
        // Ordinary static text is not JSON.
      }
    }
    return typeof raw === "string" ? raw : JSON.stringify(raw) ?? "—";
  }
  return JSON.stringify(mapping);
}

export function getActionFieldMappings(action: Record<string, unknown>): FieldMapping[] {
  const parameters = asRecord(action.parameters);
  const definitions = asRecord(parameters?.mappingDefinitions);
  return Object.entries(definitions ?? {}).map(([field, definition]) => ({ field, value: describeMapping(definition) }));
}

export function getActionTargetEntity(action: Record<string, unknown>): string | undefined {
  return text(asRecord(action.parameters)?.entityName);
}
