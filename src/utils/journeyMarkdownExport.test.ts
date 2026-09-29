import { describe, expect, it } from "vitest";
import { buildJourneyMarkdown } from "./journeyMarkdownExport.ts";

describe("journey Markdown export", () => {
  it("exports main Journey nodes and conditions as Mermaid", () => {
    const root = { id: "journey:1", kind: "journey" as const, logicalName: "msdynmkt_journey", entitySetName: "msdynmkt_journeys", recordId: "1", displayName: "Spring campaign", sourceRecord: {}, warnings: [] };
    const condition = { id: "journey-embedded:1:actions.condition", kind: "journeyAction" as const, logicalName: "journey-embedded", entitySetName: "", recordId: "actions.condition", displayName: "Audience check", sourceRecord: { type: "ConditionV2", parameters: { condition: { type: "Grouping", conditionType: 1, expressions: [] } } }, warnings: [] };
    const detail = { ...condition, id: "email:2", logicalName: "msdynmkt_email", displayName: "Email detail", recordId: "2" };
    const markdown = buildJourneyMarkdown({ root, artifacts: [root, condition, detail], dependencies: [
      { id: "root-condition", sourceArtifactId: root.id, targetArtifactId: condition.id, label: "contains", relationType: "embedded-in-json", resolved: true, warnings: [] },
      { id: "condition-detail", sourceArtifactId: condition.id, targetArtifactId: detail.id, label: "email", relationType: "lookup", resolved: true, warnings: [] },
    ], warnings: [], discoveredAt: "2026-09-29T20:00:00.000Z" });
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("Spring campaign");
    expect(markdown).toContain("Audience check");
    expect(markdown).toContain("Alle Übereinstimmungen");
    expect(markdown).not.toContain("Email detail");
    expect(markdown).toContain("## Conditions");
  });
});
