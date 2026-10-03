import { getJourneyCondition } from "../discovery/journeyConditions.ts";
import { getArtifactLabel } from "../discovery/artifactCatalog.ts";
import type { Artifact, Dependency, DiscoveryResult } from "../discovery/types.ts";

const embeddedLogicalName = "journey-embedded";

export type JourneyTree = {
  dependenciesBySource: Map<string, Dependency[]>;
  promotedArtifactIds: Set<string>;
};

function escapeMarkdown(value: string): string {
  return value.replace(/([\\|`<>])/g, "\\$1").replace(/[\r\n]+/g, " ");
}

function escapeMermaid(value: string): string {
  return value.replace(/["`]/g, "'").replace(/[\r\n]+/g, " ").replace(/[<>]/g, "");
}

function mermaidId(index: number): string {
  return `journeyNode${index}`;
}

function nodeLabel(artifact: Artifact): string {
  const condition = artifact.logicalName === embeddedLogicalName
    ? getJourneyCondition(artifact.sourceRecord, artifact.conditionOptionLabels, artifact.conditionLookupValues)
    : undefined;
  const details = [artifact.displayName, condition ? `Condition: ${condition}` : undefined].filter(Boolean).join(" — ");
  return `${artifact.logicalName === embeddedLogicalName ? artifact.entityDisplayName ?? "Journey action" : "Journey"}: ${details}`;
}

function mainArtifacts(discovery: DiscoveryResult): Artifact[] {
  return [
    discovery.root,
    ...discovery.artifacts.filter((artifact) => artifact.logicalName === embeddedLogicalName),
  ];
}

function objectHeading(index: number): string {
  return `Object ${index + 1}`;
}

function treeNodeLabel(artifact: Artifact): string {
  const type = artifact.logicalName === embeddedLogicalName && artifact.kind === "email"
    ? "Email action"
    : getArtifactLabel(artifact.kind);
  return `${type}: ${artifact.displayName}`;
}

function buildDependencyTree(discovery: DiscoveryResult, tree: JourneyTree, objectNumberById: Map<string, number>): string[] {
  const artifactById = new Map(discovery.artifacts.map((artifact) => [artifact.id, artifact]));
  artifactById.set(discovery.root.id, discovery.root);
  const lines: string[] = [];
  const renderNode = (artifact: Artifact, depth: number, ancestry: Set<string>) => {
    const objectNumber = objectNumberById.get(artifact.id);
    const indent = "  ".repeat(depth);
    const repeated = ancestry.has(artifact.id);
    lines.push(`${indent}- [${escapeMarkdown(treeNodeLabel(artifact))}](#object-${objectNumber})${repeated ? " (already in path)" : ""}`);
    if (repeated) return;

    const nextAncestry = new Set(ancestry).add(artifact.id);
    const children = (tree.dependenciesBySource.get(artifact.id) ?? []).filter((dependency) =>
      !(artifact.id === discovery.root.id && dependency.targetArtifactId && tree.promotedArtifactIds.has(dependency.targetArtifactId)),
    );
    for (const dependency of children) {
      const target = dependency.targetArtifactId ? artifactById.get(dependency.targetArtifactId) : undefined;
      if (!target) {
        const reference = dependency.targetLogicalName ?? "Unknown reference";
        const recordId = dependency.targetRecordId ? ` (${dependency.targetRecordId})` : "";
        lines.push(`${"  ".repeat(depth + 1)}- ${escapeMarkdown(dependency.label)}: ${escapeMarkdown(reference + recordId)} — unresolved`);
      } else if (tree.promotedArtifactIds.has(target.id) && artifact.id !== discovery.root.id) {
        lines.push(`${"  ".repeat(depth + 1)}- ${escapeMarkdown(dependency.label)}: [${escapeMarkdown(treeNodeLabel(target))}](#object-${objectNumberById.get(target.id)}) (see root level)`);
      } else {
        renderNode(target, depth + 1, nextAncestry);
      }
    }
  };

  renderNode(discovery.root, 0, new Set());
  for (const artifact of discovery.artifacts.filter((item) => tree.promotedArtifactIds.has(item.id))) {
    renderNode(artifact, 0, new Set());
  }
  return lines;
}

function containsHtmlOrJson(key: string, value: string): boolean {
  if (/\b(?:json|html|payload|definition|content|body)\b/i.test(key) || /<!doctype\s+html|<\/?[a-z][\s\S]*?>/i.test(value)) return true;
  const trimmed = value.trim();
  if (!((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function markdownDetailFields(artifact: Artifact): Array<[string, string]> {
  return Object.entries(artifact.sourceRecord)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .filter(([key, value]) => !key.includes("@") && !/^_.*_value$/i.test(key) && !key.toLowerCase().endsWith("id") && !containsHtmlOrJson(key, String(value)))
    .slice(0, 60)
    .map(([key, value]) => [key, String(value)]);
}

function statusValue(value: string | undefined, display: string | undefined, labels: Record<string, string> | undefined): string {
  if (display?.trim()) return display.trim();
  if (!value) return "—";
  return labels?.[value] ?? value;
}

function buildMermaid(discovery: DiscoveryResult, artifacts: Artifact[]): string {
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const ids = new Map(artifacts.map((artifact, index) => [artifact.id, mermaidId(index)]));
  const lines = ["flowchart TD"];

  for (const artifact of artifacts) {
    const id = ids.get(artifact.id);
    if (!id) continue;
    lines.push(`  ${id}["${escapeMermaid(nodeLabel(artifact))}"]`);
  }

  const seenEdges = new Set<string>();
  for (const dependency of discovery.dependencies) {
    if (!dependency.targetArtifactId || !artifactIds.has(dependency.sourceArtifactId) || !artifactIds.has(dependency.targetArtifactId)) continue;
    const source = ids.get(dependency.sourceArtifactId);
    const target = ids.get(dependency.targetArtifactId);
    if (!source || !target) continue;
    const edgeKey = `${source}->${target}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    lines.push(`  ${source} -->|${escapeMermaid(dependency.label)}| ${target}`);
  }

  return lines.join("\n");
}

/** Creates a Markdown report with a navigable dependency tree and details for each tree object. */
export function buildJourneyMarkdown(discovery: DiscoveryResult, tree?: JourneyTree): string {
  const effectiveTree = tree ?? {
    dependenciesBySource: discovery.dependencies.reduce((grouped, dependency) => {
      const dependencies = grouped.get(dependency.sourceArtifactId) ?? [];
      dependencies.push(dependency);
      grouped.set(dependency.sourceArtifactId, dependencies);
      return grouped;
    }, new Map<string, Dependency[]>()),
    promotedArtifactIds: new Set<string>(),
  };
  const objects = [discovery.root, ...discovery.artifacts.filter((artifact) => artifact.id !== discovery.root.id)];
  const objectNumberById = new Map(objects.map((artifact, index) => [artifact.id, index + 1]));
  const artifacts = mainArtifacts(discovery);
  const triggers = artifacts.filter((artifact) => artifact.kind === "trigger");
  const actions = artifacts.filter((artifact) => artifact.kind !== "trigger" && artifact.logicalName === embeddedLogicalName);
  const relatedKinds = new Set<Artifact["kind"]>(["email", "compliance", "purpose", "topic", "sender", "brandProfile"]);
  const related = discovery.artifacts.filter((artifact) => relatedKinds.has(artifact.kind));
  const conditions = artifacts
    .filter((artifact) => artifact.logicalName === embeddedLogicalName)
    .map((artifact) => ({ name: artifact.displayName, condition: getJourneyCondition(artifact.sourceRecord, artifact.conditionOptionLabels, artifact.conditionLookupValues) }))
    .filter((entry): entry is { name: string; condition: string } => Boolean(entry.condition));
  const lines = [
    `# ${discovery.root.displayName}`,
    "",
    `- **Journey:** ${escapeMarkdown(discovery.root.displayName)}`,
    `- **Discovered:** ${escapeMarkdown(new Date(discovery.discoveredAt).toLocaleString())}`,
    `- **Main nodes:** ${artifacts.length}`,
    `- **Trigger:** ${triggers.length ? triggers.map((artifact) => escapeMarkdown(artifact.displayName)).join(", ") : "—"}`,
    "",
    "## Journey Map",
    "",
    "```mermaid",
    buildMermaid(discovery, artifacts),
    "```",
    "",
    "## Dependency Tree",
    "",
    ...buildDependencyTree(discovery, effectiveTree, objectNumberById),
  ];

  if (actions.length || related.length) {
    lines.push("", "## Journey Details", "");
    if (actions.length) {
      lines.push("### Actions", "", "| Action | Type | Trigger | Condition |", "| --- | --- | --- | --- |",
        ...actions.map((artifact) => `| ${escapeMarkdown(artifact.displayName)} | ${escapeMarkdown(artifact.entityDisplayName ?? artifact.kind)} | ${escapeMarkdown(triggers.map((trigger) => trigger.displayName).join(", ") || "—")} | ${escapeMarkdown(getJourneyCondition(artifact.sourceRecord, artifact.conditionOptionLabels, artifact.conditionLookupValues) ?? "—")} |`));
    }
    if (related.length) {
      lines.push("", "### Dataverse records", "", "| Type | Name | ID | Status | Status reason |", "| --- | --- | --- | --- | --- |",
        ...related.map((artifact) => `| ${escapeMarkdown(artifact.entityDisplayName ?? getArtifactLabel(artifact.kind))} | [${escapeMarkdown(artifact.displayName)}](#object-${objectNumberById.get(artifact.id)}) | ${escapeMarkdown(artifact.recordId)} | ${escapeMarkdown(statusValue(artifact.state, artifact.stateDisplay, artifact.stateLabels))} | ${escapeMarkdown(statusValue(artifact.status, artifact.statusDisplay, artifact.statusLabels))} |`));
    }
  }

  lines.push("", "## Object Details");
  for (const artifact of objects) {
    const objectNumber = objectNumberById.get(artifact.id)!;
    const fields = markdownDetailFields(artifact);
    lines.push("", `### ${objectHeading(objectNumber)}`, "", `**${escapeMarkdown(treeNodeLabel(artifact))}**`, "", `- **Logical name:** ${escapeMarkdown(artifact.logicalName)}`, `- **Record ID:** ${escapeMarkdown(artifact.recordId)}`);
    if (artifact.version) lines.push(`- **Version:** ${escapeMarkdown(artifact.version)}`);
    if (fields.length) {
      lines.push("", "| Field | Value |", "| --- | --- |", ...fields.map(([key, value]) => `| ${escapeMarkdown(key)} | ${escapeMarkdown(value)} |`));
    } else {
      lines.push("", "_No scalar fields available._");
    }
  }

  if (conditions.length) {
    lines.push("", "## Conditions", "", "| Node | Condition |", "| --- | --- |", ...conditions.map(({ name, condition }) => `| ${escapeMarkdown(name)} | ${escapeMarkdown(condition)} |`));
  }
  if (discovery.warnings.length) lines.push("", "## Warnings", "", ...discovery.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  return `${lines.join("\n")}\n`;
}
