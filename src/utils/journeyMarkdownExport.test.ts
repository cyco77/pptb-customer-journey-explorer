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

  it("includes triggers in action details and related compliance records", () => {
    const root = { id: "journey:1", kind: "journey" as const, logicalName: "msdynmkt_journey", entitySetName: "msdynmkt_journeys", recordId: "1", displayName: "Spring campaign", sourceRecord: {}, warnings: [] };
    const trigger = { id: "trigger:1", kind: "trigger" as const, logicalName: "journey-embedded", entitySetName: "", recordId: "trigger", displayName: "Lead created", sourceRecord: {}, warnings: [] };
    const action = { id: "action:1", kind: "journeyAction" as const, logicalName: "journey-embedded", entitySetName: "", recordId: "action", displayName: "Send email", sourceRecord: { type: "Email" }, warnings: [] };
    const compliance = { id: "compliance:1", kind: "compliance" as const, logicalName: "msdynmkt_compliancesettings", entitySetName: "", recordId: "2", displayName: "Commercial email", entityDisplayName: "Compliance Profile", sourceRecord: { name: "Commercial email" }, warnings: [] };
    const markdown = buildJourneyMarkdown({ root, artifacts: [root, trigger, action, compliance], dependencies: [], warnings: [], discoveredAt: "2026-09-29T20:00:00.000Z" });
    expect(markdown).toContain("| Send email | journeyAction | Lead created |");
    expect(markdown).toContain("| Compliance Profile | Commercial email |");
  });
});
