import { describe, expect, it } from "vitest";
import { buildJourneyMarkdown } from "./journeyMarkdownExport.ts";

describe("journey Markdown export", () => {
  it("exports the Journey map, dependency tree, object links, and conditions", () => {
    const root = { id: "journey:1", kind: "journey" as const, logicalName: "msdynmkt_journey", entitySetName: "msdynmkt_journeys", recordId: "1", displayName: "Spring campaign", sourceRecord: {}, warnings: [] };
    const condition = { id: "journey-embedded:1:actions.condition", kind: "journeyAction" as const, logicalName: "journey-embedded", entitySetName: "", recordId: "actions.condition", displayName: "Audience check", sourceRecord: { type: "ConditionV2", parameters: { condition: { type: "Grouping", conditionType: 1, expressions: [] } } }, warnings: [] };
    const detail = { ...condition, id: "email:2", kind: "email" as const, logicalName: "msdynmkt_email", displayName: "Email detail", recordId: "2", state: "0", stateDisplay: "Active", status: "2", statusLabels: { "2": "Ready to send" }, sourceRecord: { subject: "Welcome" } };
    const markdown = buildJourneyMarkdown({ root, artifacts: [root, condition, detail], dependencies: [
      { id: "root-condition", sourceArtifactId: root.id, targetArtifactId: condition.id, label: "contains", relationType: "embedded-in-json", resolved: true, warnings: [] },
      { id: "condition-detail", sourceArtifactId: condition.id, targetArtifactId: detail.id, label: "email", relationType: "lookup", resolved: true, warnings: [] },
    ], warnings: [], discoveredAt: "2026-09-29T20:00:00.000Z" });
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("Spring campaign");
    expect(markdown).toContain("Audience check");
    expect(markdown).toContain("Alle Übereinstimmungen");
    expect(markdown).toContain("## Dependency Tree");
    expect(markdown).toContain("- [Journey: Spring campaign](#object-1)");
    expect(markdown).toContain("  - [Journey action: Audience check](#object-2)");
    expect(markdown).toContain("    - [Email: Email detail](#object-3)");
    expect(markdown).toContain("### Object 3");
    expect(markdown).toContain("| type | ConditionV2 |");
    expect(markdown).toContain("| Type | Name | ID | Status | Status reason |");
    expect(markdown).toContain("| Email | [Email detail](#object-3) | 2 | Active | Ready to send |");
    expect(markdown).not.toContain("subject: Welcome");
    expect(markdown).toContain("## Conditions");
  });

  it("places promoted tree objects at the root and links repeated references to their details", () => {
    const root = { id: "journey:1", kind: "journey" as const, logicalName: "msdynmkt_journey", entitySetName: "msdynmkt_journeys", recordId: "1", displayName: "Spring campaign", sourceRecord: {}, warnings: [] };
    const action = { id: "action:1", kind: "journeyAction" as const, logicalName: "journey-embedded", entitySetName: "", recordId: "action", displayName: "Send email", sourceRecord: { type: "Email" }, warnings: [] };
    const email = { id: "email:1", kind: "email" as const, logicalName: "msdynmkt_email", entitySetName: "emails", recordId: "email-record", displayName: "Welcome email", sourceRecord: { subject: "Welcome" }, warnings: [] };
    const discovery = { root, artifacts: [root, action, email], dependencies: [
      { id: "root-action", sourceArtifactId: root.id, targetArtifactId: action.id, label: "contains", relationType: "embedded-in-json" as const, resolved: true, warnings: [] },
      { id: "action-email", sourceArtifactId: action.id, targetArtifactId: email.id, label: "sends", relationType: "lookup" as const, resolved: true, warnings: [] },
    ], warnings: [], discoveredAt: "2026-09-29T20:00:00.000Z" };
    const markdown = buildJourneyMarkdown(discovery, {
      dependenciesBySource: new Map([[root.id, [discovery.dependencies[0]]], [action.id, [discovery.dependencies[1]]]]),
      promotedArtifactIds: new Set([email.id]),
    });

    expect(markdown).toContain("- [Journey: Spring campaign](#object-1)");
    expect(markdown).toContain("  - [Journey action: Send email](#object-2)");
    expect(markdown).toContain("- [Email: Welcome email](#object-3)");
    expect(markdown).toContain("### Object 3");
    expect(markdown).toContain("| subject | Welcome |");
  });

  it("includes triggers in action details and related compliance records", () => {
    const root = { id: "journey:1", kind: "journey" as const, logicalName: "msdynmkt_journey", entitySetName: "msdynmkt_journeys", recordId: "1", displayName: "Spring campaign", sourceRecord: {}, warnings: [] };
    const trigger = { id: "trigger:1", kind: "trigger" as const, logicalName: "journey-embedded", entitySetName: "", recordId: "trigger", displayName: "Lead created", sourceRecord: {}, warnings: [] };
    const action = { id: "action:1", kind: "journeyAction" as const, logicalName: "journey-embedded", entitySetName: "", recordId: "action", displayName: "Send email", sourceRecord: { type: "Email" }, warnings: [] };
    const compliance = { id: "compliance:1", kind: "compliance" as const, logicalName: "msdynmkt_compliancesettings", entitySetName: "", recordId: "2", displayName: "Commercial email", entityDisplayName: "Compliance Profile", sourceRecord: { name: "Commercial email" }, warnings: [] };
    const markdown = buildJourneyMarkdown({ root, artifacts: [root, trigger, action, compliance], dependencies: [], warnings: [], discoveredAt: "2026-09-29T20:00:00.000Z" });
    expect(markdown).toContain("| Send email | journeyAction | Lead created |");
    expect(markdown).toContain("| Type | Name | ID | Status | Status reason |");
    expect(markdown).toContain("| Compliance Profile | [Commercial email](#object-4) | 2 | — | — |");
  });

  it("omits raw JSON and HTML values without emitting HTML markup", () => {
    const root = { id: "journey:1", kind: "journey" as const, logicalName: "msdynmkt_journey", entitySetName: "msdynmkt_journeys", recordId: "1", displayName: "Plain <Campaign>", sourceRecord: { name: "Plain <Campaign>", payload: "{\"internal\":true}", description: "<p>Details</p>", subject: "Safe text" }, warnings: [] };
    const markdown = buildJourneyMarkdown({ root, artifacts: [root], dependencies: [], warnings: [], discoveredAt: "2026-09-29T20:00:00.000Z" });

    expect(markdown).toContain("Plain \\<Campaign\\>");
    expect(markdown).toContain("| subject | Safe text |");
    expect(markdown).not.toContain("<a ");
    expect(markdown).not.toContain("<p>");
    expect(markdown).not.toContain('"internal"');
  });
});
