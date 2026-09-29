import assert from "node:assert/strict";
import { test } from "node:test";
import { getJourneyCondition } from "./src/discovery/journeyConditions.ts";
import { extractJourneyDefinitionReferences } from "./src/discovery/journeyDefinition.ts";

test("describes the conditions on their own ConditionV2 branches", () => {
  const definition = { actions: { outer: { type: "ConditionV2", parameters: { branches: [
    { label: "Energie", actions: {}, condition: { type: "BinaryOperator", operator: 2,
      leftOperand: { binding: { source: "DataverseDataSource", inputs: { sourceType: { value: "msdynmkt_marketingform" }, recordId: { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "lead" } }, outputPath: "msdynmkt_marketingformid" } } }, outputPath: "msdynmkt_name" } },
      rightOperand: { type: "Static", value: "Whitepaper - Energie" } } },
    { label: "Wasser", actions: {}, condition: { type: "BinaryOperator", operator: 2,
      leftOperand: { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "lead" } }, outputPath: "akq_werbemassnahmeneinwilligung" } },
      rightOperand: { type: "Static", value: "true" } } },
  ] } } } };
  const branches = extractJourneyDefinitionReferences(definition).nodes.filter((node) => node.key.includes(".branches["));
  assert.equal(branches.length, 2);
  assert.equal(getJourneyCondition(branches[0].record), 'Dataverse msdynmkt_marketingform (record: Profile lead → msdynmkt_marketingformid) → msdynmkt_name equals "Whitepaper - Energie"');
  assert.equal(getJourneyCondition(branches[1].record), 'Profile lead → akq_werbemassnahmeneinwilligung equals "true"');
  assert.equal(getJourneyCondition(definition.actions.outer), undefined);
});

test("describes trigger grouping and unary expressions", () => {
  const trigger = { parameters: { condition: { type: "Grouping", conditionType: 1, expressions: [
    { type: "BinaryOperator", operator: 1, leftOperand: { binding: { source: "DataverseDataSource", inputs: { sourceType: { value: "lead" } }, outputPath: "subject" } }, rightOperand: { type: "Static", value: "Produktformular" } },
    { type: "UnaryOperator", operator: 4, operand: { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "lead" } }, outputPath: "leadid" } } },
  ] } } };
  assert.equal(getJourneyCondition(trigger), 'Group (condition type 1)\n1. Dataverse lead → subject contains "Produktformular"\n2. Profile lead → leadid is not empty');
  assert.equal(getJourneyCondition({ condition: { type: "UnaryOperator", operator: 2, operand: { type: "Static", value: "x" } } }), '"x" equals');
  assert.equal(getJourneyCondition({ condition: { type: "FutureCondition" } }), "Unknown condition (FutureCondition; see JSON)");
});

test("translates known operators and preserves unknown codes", () => {
  const labels = {
    1: "contains", 2: "equals", 3: "not equal", 4: "is not empty",
    6: "starts with", 7: "does not start with", 8: "does not contain",
    9: "less than", 10: "less than or equal to", 11: "greater than", 12: "greater than or equal to",
    17: "is before", 18: "is on or before", 19: "is after", 20: "is on or after", 21: "is between",
  };
  for (const [code, label] of Object.entries(labels)) {
    const result = getJourneyCondition({ condition: { type: "BinaryOperator", operator: Number(code), leftOperand: { type: "Static", value: "a" }, rightOperand: { type: "Static", value: "b" } } });
    assert.equal(result, code === "3" ? '"a" ends with "b"' : code === "4" ? `"a" ${label}` : `"a" ${label} "b"`);
  }
  for (const code of [5, 13, 14, 15, 16, 99]) {
    assert.equal(getJourneyCondition({ condition: { type: "BinaryOperator", operator: code, leftOperand: { type: "Static", value: "a" }, rightOperand: { type: "Static", value: "b" } } }), `"a" [operator ${code}] "b"`);
  }
});

test("operator 3 uses the right-hand value across operand variants", () => {
  for (const [outputType, rightOperand, expected] of [
    ["string", { type: "Static", value: "endet mit", valueType: 2 }, '"endet mit"'],
    ["dateTime", { type: "Static", value: "2026-09-29T22:00:00.000Z", valueType: 4 }, '"2026-09-29T22:00:00.000Z"'],
    ["number", { type: "Number", value: 0 }, "0"],
    ["boolean", { type: "Static", value: false }, "false"],
    ["string", "suffix", '"suffix"'],
  ]) {
    const leftOperand = { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "contact" } }, outputPath: "firstname", outputType } };
    assert.equal(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand, operator: 3 } }), `Profile contact → firstname ends with ${expected}`);
  }
  const leftOperand = { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "contact" } }, outputPath: "firstname" } };
  const dynamicRight = { type: "Dynamic", binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "contact" } }, outputPath: "lastname" } };
  assert.equal(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand: dynamicRight, operator: 3 } }), "Profile contact → firstname ends with Profile contact → lastname");
  for (const rightOperand of [undefined, null, { type: "Static", value: null }, { type: "Static", value: "" }, { type: "Dynamic" }]) {
    assert.equal(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand, operator: 3 } }), "Profile contact → firstname not equal");
    assert.equal(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand, operator: 4 } }), "Profile contact → firstname is not empty");
  }
  assert.equal(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand: { type: "Static", value: "suffix" }, operator: 4 } }), "Profile contact → firstname is not empty");
});

test("operator 21 displays both bounds of a date-time Range", () => {
  const leftOperand = { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "contact" } }, outputPath: "sittso_ablaufdatum", outputType: "dateTime" } };
  const start = "2026-09-28T22:00:00.000Z";
  const end = "2026-09-29T22:00:00.000Z";
  assert.equal(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand: { type: "Range", valueType: 4, start, end }, operator: 21 } }),
    `Profile contact → sittso_ablaufdatum is between "${start}" and "${end}"`);
  assert.equal(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand: { type: "Range", start }, operator: 21 } }),
    "Profile contact → sittso_ablaufdatum is between [incomplete range; see JSON]");
});
