import { describe, expect, it } from "vitest";
import { describeJourneyCondition, getJourneyCondition } from "./journeyConditions.ts";
import { extractJourneyDefinitionReferences } from "./journeyDefinition.ts";

describe("journey conditions", () => {
  it("describes conditions on their own ConditionV2 branches", () => {
    const definition = { actions: { outer: { type: "ConditionV2", parameters: { branches: [
      { label: "Energie", actions: {}, condition: { type: "BinaryOperator", operator: 2,
        leftOperand: { binding: { source: "DataverseDataSource", inputs: { sourceType: { value: "msdynmkt_marketingform" }, recordId: { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "lead" } }, outputPath: "msdynmkt_marketingformid" } } }, outputPath: "msdynmkt_name" } },
        rightOperand: { type: "Static", value: "Whitepaper - Energie" } } },
      { label: "Wasser", actions: {}, condition: { type: "BinaryOperator", operator: 2,
        leftOperand: { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "lead" } }, outputPath: "akq_werbemassnahmeneinwilligung" } },
        rightOperand: { type: "Static", value: "true" } } },
    ] } } } };
    const branches = extractJourneyDefinitionReferences(definition).nodes.filter((node) => node.key.includes(".branches["));
    expect(branches).toHaveLength(2);
    expect(getJourneyCondition(branches[0].record)).toBe('Dataverse msdynmkt_marketingform (record: Profile lead → msdynmkt_marketingformid) → msdynmkt_name equals "Whitepaper - Energie"');
    expect(getJourneyCondition(branches[1].record)).toBe('Profile lead → akq_werbemassnahmeneinwilligung equals "true"');
    expect(getJourneyCondition(definition.actions.outer)).toBeUndefined();
  });

  it("describes grouping, condition types, and unary expressions", () => {
    const trigger = { parameters: { condition: { type: "Grouping", conditionType: 1, expressions: [
      { type: "BinaryOperator", operator: 1, leftOperand: { binding: { source: "DataverseDataSource", inputs: { sourceType: { value: "lead" } }, outputPath: "subject" } }, rightOperand: { type: "Static", value: "Produktformular" } },
      { type: "UnaryOperator", operator: 4, operand: { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "lead" } }, outputPath: "leadid" } } },
    ] } } };
    expect(getJourneyCondition(trigger)).toBe('Group (Alle Übereinstimmungen)\n1. Dataverse lead → subject contains "Produktformular"\n2. Profile lead → leadid is not empty');
    expect(getJourneyCondition({ condition: { type: "Grouping", conditionType: 2, expressions: [] } })).toBe("Group (Beliebige Übereinstimmung)");
    expect(getJourneyCondition({ condition: { type: "Grouping", conditionType: 99, expressions: [] } })).toBe("Group (condition type 99)");
    expect(getJourneyCondition({ condition: { type: "UnaryOperator", operator: 2, operand: { type: "Static", value: "x" } } })).toBe('"x" equals');
    expect(getJourneyCondition({ condition: { type: "FutureCondition" } })).toBe("Unknown condition (FutureCondition; see JSON)");
  });

  it("describes operators and preserves unknown codes", () => {
    const labels = { 1: "contains", 2: "equals", 3: "not equals", 4: "is not empty", 6: "starts with", 7: "does not start with", 8: "does not contain", 9: "less than", 10: "less than or equal to", 11: "greater than", 12: "greater than or equal to", 17: "is before", 18: "is on or before", 19: "is after", 20: "is on or after", 21: "is between" };
    for (const [code, label] of Object.entries(labels)) {
      const result = getJourneyCondition({ condition: { type: "BinaryOperator", operator: Number(code), leftOperand: { type: "Static", value: "a" }, rightOperand: { type: "Static", value: "b" } } });
      expect(result).toBe(code === "4" ? `"a" ${label}` : `"a" ${label} "b"`);
    }
    for (const code of [5, 13, 14, 15, 16, 99]) {
      expect(getJourneyCondition({ condition: { type: "BinaryOperator", operator: code, leftOperand: { type: "Static", value: "a" }, rightOperand: { type: "Static", value: "b" } } })).toBe(`"a" [operator ${code}] "b"`);
    }
  });

  it("uses not equals or is empty for operator 3", () => {
    const leftOperand = { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "contact" } }, outputPath: "firstname" } };
    expect(getJourneyCondition({ condition: { type: "BinaryOperator", operator: 3, leftOperand } })).toBe("Profile contact → firstname is empty");
    expect(getJourneyCondition({ condition: { type: "BinaryOperator", operator: 3, leftOperand, rightOperand: { type: "Static", value: "Hans" } } })).toBe('Profile contact → firstname not equals "Hans"');
    expect(getJourneyCondition({ condition: { type: "BinaryOperator", operator: 3, leftOperand, rightOperand: { type: "Dynamic", binding: leftOperand.binding } } })).toBe("Profile contact → firstname not equals Profile contact → firstname");
  });

  it("describes date-time ranges", () => {
    const leftOperand = { binding: { source: "CdsProfileDataSource", inputs: { sourceType: { value: "contact" } }, outputPath: "sittso_ablaufdatum", outputType: "dateTime" } };
    const start = "2026-09-28T22:00:00.000Z";
    const end = "2026-09-29T22:00:00.000Z";
    expect(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand: { type: "Range", valueType: 4, start, end }, operator: 21 } })).toBe(`Profile contact → sittso_ablaufdatum is between "${start}" and "${end}"`);
    expect(getJourneyCondition({ condition: { type: "BinaryOperator", leftOperand, rightOperand: { type: "Range", start }, operator: 21 } })).toBe("Profile contact → sittso_ablaufdatum is between [incomplete range; see JSON]");
  });

  it("handles invalid conditions and operand values safely", () => {
    expect(describeJourneyCondition(null)).toBe("Unknown condition (see JSON)");
    expect(describeJourneyCondition("condition")).toBe("Unknown condition (see JSON)");
    expect(describeJourneyCondition({ type: "Grouping" })).toBe("Group (condition type unknown)");
    expect(describeJourneyCondition({ type: "Grouping", conditionType: 1, expressions: [null] })).toBe("Group (Alle Übereinstimmungen)\n1. Unknown condition (see JSON)");
    expect(describeJourneyCondition({ type: "BinaryOperator", operator: 2, leftOperand: null, rightOperand: null })).toBe("null equals null");
    expect(describeJourneyCondition({ type: "BinaryOperator", operator: 2, leftOperand: { type: "FutureOperand" }, rightOperand: { type: "FutureOperand" } })).toBe("Unknown value (FutureOperand) equals Unknown value (FutureOperand)");
    expect(describeJourneyCondition({ type: "BinaryOperator", operator: 2, leftOperand: { type: "Static", value: false }, rightOperand: { type: "Static", value: 0 } })).toBe("false equals 0");
    expect(describeJourneyCondition({ type: "BinaryOperator", operator: 4, leftOperand: { type: "Static", value: "field" }, rightOperand: { type: "Static", value: "ignored" } })).toBe('"field" is not empty');
    expect(describeJourneyCondition({ type: "BinaryOperator", operator: 3, leftOperand: { type: "Static", value: "field" }, rightOperand: { type: "Static", value: "" } })).toBe('"field" is empty');
  });

  it("handles non-string range bounds and record condition locations", () => {
    expect(describeJourneyCondition({ type: "BinaryOperator", operator: 21, leftOperand: { type: "Static", value: "date" }, rightOperand: { type: "Range", start: 1, end: 2 } })).toBe('"date" is between [incomplete range; see JSON]');
    expect(getJourneyCondition({ condition: null, parameters: { condition: { type: "UnaryOperator", operator: 4, operand: { type: "Static", value: "x" } } } })).toBe('"x" is not empty');
    expect(getJourneyCondition({ condition: null })).toBeUndefined();
    expect(getJourneyCondition({ condition: { type: "BinaryOperator", operator: 99, leftOperand: { type: "Static", value: "x" }, rightOperand: { type: "Static", value: "y" } } })).toBe('"x" [operator 99] "y"');
    expect(describeJourneyCondition({})).toBe("Unknown condition (untyped; see JSON)");
  });
});
