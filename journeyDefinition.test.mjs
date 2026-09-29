import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJourneyDefinitionReferences, journeyReferenceKind, owningJourneyNode } from "./src/discovery/journeyDefinition.ts";

const emailId = "c1741a19-65ab-f111-aaab-7ced8d736da7";

test("finds tasks and emails nested in ConditionV2 branches without losing their parent paths", () => {
  const definition = {
    trigger: { type: "Event", parameters: { eventName: "msdynmkt_leadcreated" } },
    actions: {
      outer: { type: "ConditionV2", parameters: {
        branches: [
          { label: "Whitepaper - Energie", actions: {
            email: { type: "Email", parameters: { contentId: emailId } },
            inner: { type: "ConditionV2", parameters: { branches: [
              { label: "Werbemaßnahmen", actions: {
                task: { type: "CreateRecordV2", displayName: "Aufgabe", parameters: { entityName: "task", mappingDefinitions: { subject: { type: "rich", value: "Neuer Lead" } } } },
              } },
            ], falseActions: {} } },
          } },
          { label: "Whitepaper - Wasser", actions: {
            task: { type: "CreateRecordV2", displayName: "Aufgabe", parameters: { entityName: "task" } },
          } },
        ],
        falseActions: { fallback: { type: "CreateRecordV2", parameters: { entityName: "task" } } },
      } },
    },
  };

  const { nodes, emailIds } = extractJourneyDefinitionReferences(JSON.stringify(definition));
  assert.deepEqual(emailIds, [emailId]);
  assert.equal(nodes.filter((node) => node.kind === "task").length, 3);
  const email = nodes.find((node) => node.kind === "email");
  assert.equal(email?.parentKey, "actions.outer.parameters.branches[0]");
  assert.equal(email?.path, "actions.outer.parameters.branches[0].actions.email");
  const innerBranch = nodes.find((node) => node.name === "Werbemaßnahmen");
  assert.ok(innerBranch);
  assert.equal(innerBranch.parentKey, "actions.outer.parameters.branches[0].actions.inner");
  const task = nodes.find((node) => node.key.endsWith("branches[0].actions.task"));
  assert.equal(task?.parentKey, innerBranch.key);
  assert.equal(nodes.find((node) => node.name === "Otherwise")?.parentKey, "actions.outer");
  assert.equal(nodes.find((node) => node.key.endsWith("falseActions.fallback"))?.parentKey, "actions.outer.parameters.falseActions");
  assert.equal(nodes.find((node) => node.kind === "trigger")?.path, "trigger");
});

test("keeps multiple content references in their respective sibling branches", () => {
  const secondEmailId = "afb36d6d-43ac-f111-aaac-0022489f29f7";
  const definition = { actions: { condition: { type: "ConditionV2", parameters: { branches: [
    { label: "Energie", actions: { send: { type: "Email", parameters: { contentId: emailId } }, task: { type: "CreateRecordV2", parameters: { entityName: "task" } } } },
    { label: "Wasser", actions: { send: { type: "Email", parameters: { contentId: secondEmailId } }, task: { type: "CreateRecordV2", parameters: { entityName: "task" } } } },
  ] } } } };
  const result = extractJourneyDefinitionReferences(definition);
  assert.deepEqual(result.emailIds, [emailId, secondEmailId]);
  for (const index of [0, 1]) {
    const branch = `actions.condition.parameters.branches[${index}]`;
    assert.equal(result.nodes.find((node) => node.key === `${branch}.actions.send`)?.parentKey, branch);
    assert.equal(result.nodes.find((node) => node.key === `${branch}.actions.task`)?.parentKey, branch);
    assert.equal(owningJourneyNode(`msdynmkt_journeyjson.${branch}.actions.send.parameters.contentId`, result.nodes, "msdynmkt_journeyjson")?.key, `${branch}.actions.send`);
    assert.equal(owningJourneyNode(`msdynmkt_journeyjson.${branch}.actions.task.parameters.mappingDefinitions.ownerid.value`, result.nodes, "msdynmkt_journeyjson")?.key, `${branch}.actions.task`);
    assert.equal(journeyReferenceKind(`${branch}.actions.send.parameters.contentId`, result.nodes.find((node) => node.key === `${branch}.actions.send`)), "email");
  }
  assert.equal(journeyReferenceKind("actions.condition.parameters.branches[0].actions.task.parameters.contentId", result.nodes.find((node) => node.kind === "task")), "default");
  assert.equal(owningJourneyNode("msdynmkt_journeyjson.trigger.parameters.eventName", result.nodes, "msdynmkt_journeyjson"), undefined);
});

test("keeps top-level task discovery and handles array action collections", () => {
  const result = extractJourneyDefinitionReferences({ actions: [{ type: "CreateRecordV2", parameters: { entityName: "task" } }] });
  assert.equal(result.nodes[0]?.kind, "task");
  assert.equal(result.nodes[0]?.key, "actions[0]");
  assert.equal(result.nodes[0]?.parentKey, undefined);
});
