import { asRecord, entries, label, walkActions, type JourneyTraversalContext } from "./journeyDefinitionTraversal.ts";

export type EmbeddedJourneyNode = {
  key: string;
  parentKey?: string;
  kind: "task" | "journeyAction" | "email" | "trigger";
  name: string;
  path: string;
  record: Record<string, unknown>;
};

export type JourneyDefinitionReferences = { emailIds: string[]; nodes: EmbeddedJourneyNode[] };

export function owningJourneyNode(path: string, nodes: EmbeddedJourneyNode[], field: string): EmbeddedJourneyNode | undefined {
  return nodes.filter((node) => path.startsWith(`${field}.${node.path}.`)).sort((left, right) => right.path.length - left.path.length)[0];
}

export function journeyReferenceKind(path: string, owner: EmbeddedJourneyNode | undefined): "email" | "default" {
  return owner?.kind === "email" && path === `${owner.path}.parameters.contentId` ? "email" : "default";
}

/** Extracts embedded actions, triggers, and email references from tolerant journey JSON. */
export function extractJourneyDefinitionReferences(value: unknown): JourneyDefinitionReferences {
  let definition: unknown = value;
  if (typeof value === "string") {
    try { definition = JSON.parse(value) as unknown; } catch { return { emailIds: [], nodes: [] }; }
  }
  const root = asRecord(definition);
  if (!root) return { emailIds: [], nodes: [] };

  const context: JourneyTraversalContext = { nodes: [], emailIds: new Set<string>() };
  const triggers: Array<[string, unknown]> = root.triggers === undefined ? root.trigger ? [["trigger", root.trigger]] : [] : entries(root.triggers, "triggers");
  for (const [path, value] of triggers) {
    const trigger = asRecord(value);
    if (!trigger) continue;
    const parameters = asRecord(trigger.parameters);
    context.nodes.push({ key: path, kind: "trigger", name: label(parameters?.eventName, trigger.eventName, trigger.name, trigger.displayName, parameters?.name, trigger.type) ?? "Journey trigger", path, record: trigger });
  }
  walkActions(context, root.actions, "actions");
  return { emailIds: [...context.emailIds], nodes: context.nodes };
}
