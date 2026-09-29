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
  return nodes
    .filter((node) => path.startsWith(`${field}.${node.path}.`))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

export function journeyReferenceKind(path: string, owner: EmbeddedJourneyNode | undefined): "email" | "default" {
  return owner?.kind === "email" && path === `${owner.path}.parameters.contentId` ? "email" : "default";
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function label(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function entries(value: unknown, path: string): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.map((item, index) => [`${path}[${index}]`, item]);
  return Object.entries(asRecord(value) ?? {}).map(([key, item]) => [`${path}.${key}`, item]);
}

export function extractJourneyDefinitionReferences(value: unknown): JourneyDefinitionReferences {
  let definition: unknown = value;
  if (typeof value === "string") {
    try {
      definition = JSON.parse(value) as unknown;
    } catch {
      return { emailIds: [], nodes: [] };
    }
  }
  const root = asRecord(definition);
  if (!root) return { emailIds: [], nodes: [] };

  const nodes: EmbeddedJourneyNode[] = [];
  const emailIds = new Set<string>();
  const triggers: Array<[string, unknown]> = root.triggers === undefined
    ? root.trigger ? [["trigger", root.trigger]] : []
    : entries(root.triggers, "triggers");
  for (const [path, value] of triggers) {
    const trigger = asRecord(value);
    if (!trigger) continue;
    const parameters = asRecord(trigger.parameters);
    nodes.push({ key: path, kind: "trigger", name: label(parameters?.eventName, trigger.eventName, trigger.name, trigger.displayName, parameters?.name, trigger.type) ?? "Journey trigger", path, record: trigger });
  }

  function walkActions(actions: unknown, path: string, parentKey?: string): void {
    for (const [actionPath, value] of entries(actions, path)) {
      const action = asRecord(value);
      if (!action) continue;
      const parameters = asRecord(action.parameters);
      const type = label(action.type) ?? "";
      const isEmail = type.toLowerCase() === "email";
      if (isEmail && typeof parameters?.contentId === "string" && GUID.test(parameters.contentId)) emailIds.add(parameters.contentId);
      const isTask = /task/i.test(type) || (/^createrecord/i.test(type) && label(parameters?.entityName)?.toLowerCase() === "task");
      const cachedEmail = asRecord(asRecord(parameters?.persistedUIState)?.cachedEmailEntity);
      nodes.push({
        key: actionPath,
        parentKey,
        kind: isEmail ? "email" : isTask ? "task" : "journeyAction",
        name: label(action.name, action.displayName, action.title, cachedEmail?.msdynmkt_name, parameters?.name, parameters?.title, parameters?.subject, action.type) ?? "Journey action",
        path: actionPath,
        record: action,
      });

      // ConditionV2 stores its nested actions in branches and falseActions;
      // other composite action types may use the same containers.
      const branches = Array.isArray(parameters?.branches) ? parameters.branches : [];
      for (const [index, branchValue] of branches.entries()) {
        const branch = asRecord(branchValue);
        if (!branch) continue;
        const branchPath = `${actionPath}.parameters.branches[${index}]`;
        nodes.push({
          key: branchPath,
          parentKey: actionPath,
          kind: "journeyAction",
          name: label(branch.label) ?? `Branch ${index + 1}`,
          path: branchPath,
          record: branch,
        });
        walkActions(branch.actions, `${branchPath}.actions`, branchPath);
      }
      if (parameters?.falseActions) {
        const falsePath = `${actionPath}.parameters.falseActions`;
        if (entries(parameters.falseActions, falsePath).length) {
          nodes.push({ key: falsePath, parentKey: actionPath, kind: "journeyAction", name: "Otherwise", path: falsePath, record: asRecord(parameters.falseActions) ?? { actions: parameters.falseActions } });
          walkActions(parameters.falseActions, falsePath, falsePath);
        }
      }
      if (parameters?.actions) walkActions(parameters.actions, `${actionPath}.parameters.actions`, actionPath);
    }
  }

  walkActions(root.actions, "actions");
  return { emailIds: [...emailIds], nodes };
}
