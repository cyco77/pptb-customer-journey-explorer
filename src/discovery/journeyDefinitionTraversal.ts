import type { EmbeddedJourneyNode } from "./journeyDefinition.ts";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function label(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

/** Converts object and array containers into stable, human-readable paths. */
export function entries(value: unknown, path: string): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.map((item, index) => [`${path}[${index}]`, item]);
  return Object.entries(asRecord(value) ?? {}).map(([key, item]) => [`${path}.${key}`, item]);
}

export type JourneyTraversalContext = { nodes: EmbeddedJourneyNode[]; emailIds: Set<string> };

function classifyAction(action: Record<string, unknown>): EmbeddedJourneyNode["kind"] {
  const parameters = asRecord(action.parameters);
  const type = label(action.type) ?? "";
  if (type.toLowerCase() === "email") return "email";
  if (/task/i.test(type) || (/^createrecord/i.test(type) && label(parameters?.entityName)?.toLowerCase() === "task")) return "task";
  return "journeyAction";
}

function addAction(context: JourneyTraversalContext, action: Record<string, unknown>, path: string, parentKey?: string): void {
  const parameters = asRecord(action.parameters);
  const kind = classifyAction(action);
  const contentId = parameters?.contentId;
  if (kind === "email" && typeof contentId === "string" && GUID.test(contentId)) context.emailIds.add(contentId);
  const cachedEmail = asRecord(asRecord(parameters?.persistedUIState)?.cachedEmailEntity);
  context.nodes.push({ key: path, parentKey, kind, name: label(action.name, action.displayName, action.title, cachedEmail?.msdynmkt_name, parameters?.name, parameters?.title, parameters?.subject, action.type) ?? "Journey action", path, record: action });
  walkCompositeActions(context, parameters, path);
}

function walkCompositeActions(context: JourneyTraversalContext, parameters: Record<string, unknown> | undefined, actionPath: string): void {
  if (!parameters) return;
  const branches = Array.isArray(parameters.branches) ? parameters.branches : [];
  for (const [index, branchValue] of branches.entries()) {
    const branch = asRecord(branchValue);
    if (!branch) continue;
    const branchPath = `${actionPath}.parameters.branches[${index}]`;
    context.nodes.push({ key: branchPath, parentKey: actionPath, kind: "journeyAction", name: label(branch.label) ?? `Branch ${index + 1}`, path: branchPath, record: branch });
    walkActions(context, branch.actions, `${branchPath}.actions`, branchPath);
  }
  if (parameters.falseActions && entries(parameters.falseActions, `${actionPath}.parameters.falseActions`).length) {
    const falsePath = `${actionPath}.parameters.falseActions`;
    context.nodes.push({ key: falsePath, parentKey: actionPath, kind: "journeyAction", name: "Otherwise", path: falsePath, record: asRecord(parameters.falseActions) ?? { actions: parameters.falseActions } });
    walkActions(context, parameters.falseActions, falsePath, falsePath);
  }
  if (parameters.actions) walkActions(context, parameters.actions, `${actionPath}.parameters.actions`, actionPath);
}

export function walkActions(context: JourneyTraversalContext, actions: unknown, path: string, parentKey?: string): void {
  for (const [actionPath, value] of entries(actions, path)) {
    const action = asRecord(value);
    if (action) addAction(context, action, actionPath, parentKey);
  }
}
