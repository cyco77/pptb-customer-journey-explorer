import { describe, expect, it } from "vitest";
import { extractJourneyDefinitionReferences, journeyReferenceKind, owningJourneyNode } from "./journeyDefinition.ts";

describe("journey definition references", () => {
  it("finds nested tasks and emails without losing parent paths", () => {
    const emailId = "c1741a19-65ab-f111-aaab-7ced8d736da7";
    const definition = { trigger: { type: "Event", parameters: { eventName: "msdynmkt_leadcreated" } }, actions: { outer: { type: "ConditionV2", parameters: { branches: [{ label: "Whitepaper", actions: { email: { type: "Email", parameters: { contentId: emailId } }, inner: { type: "ConditionV2", parameters: { branches: [{ label: "Task branch", actions: { task: { type: "CreateRecordV2", parameters: { entityName: "task" } } } }] } } } }, { label: "Fallback", actions: { task: { type: "CreateRecordV2", parameters: { entityName: "task" } } } }], falseActions: { fallback: { type: "CreateRecordV2", parameters: { entityName: "task" } } } } } } };
    const result = extractJourneyDefinitionReferences(JSON.stringify(definition));
    expect(result.emailIds).toEqual([emailId]);
    expect(result.nodes.filter((node) => node.kind === "task")).toHaveLength(3);
    const email = result.nodes.find((node) => node.kind === "email");
    expect(email?.parentKey).toBe("actions.outer.parameters.branches[0]");
    expect(email?.path).toBe("actions.outer.parameters.branches[0].actions.email");
    expect(result.nodes.find((node) => node.name === "Task branch")?.parentKey).toBe("actions.outer.parameters.branches[0].actions.inner");
    expect(result.nodes.find((node) => node.name === "Otherwise")?.parentKey).toBe("actions.outer");
    expect(result.nodes.find((node) => node.kind === "trigger")?.path).toBe("trigger");
  });

  it("keeps sibling content references and resolves their owners", () => {
    const firstEmail = "c1741a19-65ab-f111-aaab-7ced8d736da7";
    const secondEmail = "afb36d6d-43ac-f111-aaac-0022489f29f7";
    const definition = { actions: { condition: { type: "ConditionV2", parameters: { branches: [{ label: "One", actions: { send: { type: "Email", parameters: { contentId: firstEmail } } } }, { label: "Two", actions: { send: { type: "Email", parameters: { contentId: secondEmail } } } }] } } } };
    const result = extractJourneyDefinitionReferences(definition);
    expect(result.emailIds).toEqual([firstEmail, secondEmail]);
    for (const index of [0, 1]) {
      const branch = `actions.condition.parameters.branches[${index}]`;
      const send = result.nodes.find((node) => node.key === `${branch}.actions.send`);
      expect(owningJourneyNode(`msdynmkt_journeyjson.${branch}.actions.send.parameters.contentId`, result.nodes, "msdynmkt_journeyjson")?.key).toBe(send?.key);
      expect(journeyReferenceKind(`${branch}.actions.send.parameters.contentId`, send)).toBe("email");
    }
    expect(owningJourneyNode("msdynmkt_journeyjson.trigger.parameters.eventName", result.nodes, "msdynmkt_journeyjson")).toBeUndefined();
  });

  it("keeps top-level array actions", () => {
    const result = extractJourneyDefinitionReferences({ actions: [{ type: "CreateRecordV2", parameters: { entityName: "task" } }] });
    expect(result.nodes[0]?.kind).toBe("task");
    expect(result.nodes[0]?.key).toBe("actions[0]");
    expect(result.nodes[0]?.parentKey).toBeUndefined();
  });
});
