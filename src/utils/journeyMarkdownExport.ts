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
    ? getJourneyCondition(artifact.sourceRecord)
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
  const conditions = artifacts
    .filter((artifact) => artifact.logicalName === embeddedLogicalName)
    .map((artifact) => ({ name: artifact.displayName, condition: getJourneyCondition(artifact.sourceRecord) }))
    .filter((entry): entry is { name: string; condition: string } => Boolean(entry.condition));
  const lines = [
    `# ${discovery.root.displayName}`,
    "",
    `- **Journey:** ${escapeMarkdown(discovery.root.displayName)}`,
    `- **Discovered:** ${escapeMarkdown(new Date(discovery.discoveredAt).toLocaleString())}`,
    `- **Main nodes:** ${artifacts.length}`,
    "",
    "## Journey Map",
    "",
    "```mermaid",
    buildMermaid(discovery, artifacts),
    "```",
  ];

  if (conditions.length) {
    lines.push("", "## Conditions", "", "| Node | Condition |", "| --- | --- |", ...conditions.map(({ name, condition }) => `| ${escapeMarkdown(name)} | ${escapeMarkdown(condition)} |`));
  }
  if (discovery.warnings.length) lines.push("", "## Warnings", "", ...discovery.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  return `${lines.join("\n")}\n`;
}
