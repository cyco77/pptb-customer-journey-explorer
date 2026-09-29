import { describeBinding } from "./journeyMappings.ts";

const operatorLabels: Record<string, string> = {
  "1": "contains",
  "2": "equals",
  "3": "not equals",
  "4": "is not empty",
  "6": "starts with",
  "7": "does not start with",
  "8": "does not contain",
  "9": "less than",
  "10": "less than or equal to",
  "11": "greater than",
  "12": "greater than or equal to",
  "17": "is before",
  "18": "is on or before",
  "19": "is after",
  "20": "is on or after",
  "21": "is between",
};

const conditionTypeLabels: Record<string, string> = {
  "1": "Alle Übereinstimmungen",
  "2": "Beliebige Übereinstimmung",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function describeOperand(value: unknown): string {
  const operand = asRecord(value);
  if (!operand) return JSON.stringify(value) ?? "Unknown value";
  const binding = describeBinding(operand.binding);
  if (binding) return binding;
  if (operand.value != null) return JSON.stringify(operand.value);
  return typeof operand.type === "string" ? `Unknown value (${operand.type})` : "Unknown value";
}

export function describeJourneyCondition(value: unknown): string {
  const condition = asRecord(value);
  if (!condition) return "Unknown condition (see JSON)";
  const type = condition.type;
  if (type === "Grouping") {
    const expressions = Array.isArray(condition.expressions) ? condition.expressions : [];
    const conditionType = condition.conditionType === undefined ? "unknown" : String(condition.conditionType);
    const groupLabel = conditionTypeLabels[conditionType] ?? `condition type ${conditionType}`;
    return [`Group (${groupLabel})`, ...expressions.map((expression, index) => `${index + 1}. ${describeJourneyCondition(expression)}`)].join("\n");
  }
  const operator = condition.operator === undefined ? "unknown" : String(condition.operator);
  const operatorLabel = operatorLabels[operator] ?? `[operator ${operator}]`;
  if (type === "BinaryOperator") {
    const left = describeOperand(condition.leftOperand);
    const right = asRecord(condition.rightOperand);
    if (operator === "3") {
      if (condition.rightOperand === undefined || condition.rightOperand === null) return `${left} is empty`;
      const rightValue = right ? (describeBinding(right.binding) ? right.binding : right.value) : condition.rightOperand;
      return rightValue != null && rightValue !== ""
        ? `${left} ${operatorLabel} ${describeOperand(condition.rightOperand)}`
        : `${left} is empty`;
    }
    if (operator === "21" && right?.type === "Range") {
      return typeof right.start === "string" && right.start.length > 0 && typeof right.end === "string" && right.end.length > 0
        ? `${left} is between ${JSON.stringify(right.start)} and ${JSON.stringify(right.end)}`
        : `${left} is between [incomplete range; see JSON]`;
    }
    return operator === "4"
      ? `${left} ${operatorLabel}`
      : `${left} ${operatorLabel} ${describeOperand(condition.rightOperand)}`;
  }
  if (type === "UnaryOperator") {
    return `${describeOperand(condition.operand)} ${operatorLabel}`;
  }
  return `Unknown condition (${String(type ?? "untyped")}; see JSON)`;
}

export function getJourneyCondition(record: Record<string, unknown>): string | undefined {
  const parameters = asRecord(record.parameters);
  const condition = record.condition ?? parameters?.condition;
  return condition == null ? undefined : describeJourneyCondition(condition);
}
