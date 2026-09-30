import { getJourneyCondition } from "../discovery/journeyConditions.ts";
import type { Artifact, DiscoveryResult } from "../discovery/types.ts";

const embeddedLogicalName = "journey-embedded";

function escapeMarkdown(value: string): string {
  return value.replace(/([\\|`])/g, "\\$1").replace(/\r?\n/g, "<br>");
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
  const details = [artifact.displayName, condition ? `Condition: ${condition}` : undefined].filter(Boolean).join("<br/>");
  return `${artifact.logicalName === embeddedLogicalName ? artifact.entityDisplayName ?? "Journey action" : "Journey"}: ${details}`;
}

function mainArtifacts(discovery: DiscoveryResult): Artifact[] {
  return [
    discovery.root,
    ...discovery.artifacts.filter((artifact) => artifact.logicalName === embeddedLogicalName),
  ];
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

/** Creates a compact Markdown report containing only the journey and embedded journey nodes. */
export function buildJourneyMarkdown(discovery: DiscoveryResult): string {
  const artifacts = mainArtifacts(discovery);
  const triggers = artifacts.filter((artifact) => artifact.kind === "trigger");
  const actions = artifacts.filter((artifact) => artifact.kind !== "trigger" && artifact.logicalName === embeddedLogicalName);
  const relatedKinds = new Set<Artifact["kind"]>(["compliance", "purpose", "topic", "sender", "brandProfile"]);
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
  ];

  if (actions.length || related.length) {
    lines.push("", "## Journey Details", "");
    if (actions.length) {
      lines.push("### Actions", "", "| Action | Type | Trigger | Condition |", "| --- | --- | --- | --- |",
        ...actions.map((artifact) => `| ${escapeMarkdown(artifact.displayName)} | ${escapeMarkdown(artifact.entityDisplayName ?? artifact.kind)} | ${escapeMarkdown(triggers.map((trigger) => trigger.displayName).join(", ") || "—")} | ${escapeMarkdown(getJourneyCondition(artifact.sourceRecord, artifact.conditionOptionLabels, artifact.conditionLookupValues) ?? "—")} |`));
    }
    if (related.length) {
      lines.push("", "### Dataverse records", "", "| Type | Name | Details |", "| --- | --- | --- |",
        ...related.map((artifact) => `| ${escapeMarkdown(artifact.entityDisplayName ?? artifact.kind)} | ${escapeMarkdown(artifact.displayName)} | ${escapeMarkdown(formatArtifactDetails(artifact))} |`));
    }
  }

  if (conditions.length) {
    lines.push("", "## Conditions", "", "| Node | Condition |", "| --- | --- |", ...conditions.map(({ name, condition }) => `| ${escapeMarkdown(name)} | ${escapeMarkdown(condition)} |`));
  }
  if (discovery.warnings.length) lines.push("", "## Warnings", "", ...discovery.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  return `${lines.join("\n")}\n`;
}

function formatArtifactDetails(artifact: Artifact): string {
  const fields = Object.entries(artifact.sourceRecord)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .filter(([key]) => !key.includes("@") && !/^_.*_value$/i.test(key) && !/id$/i.test(key))
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return fields.length ? fields.join("; ") : artifact.recordId;
}
