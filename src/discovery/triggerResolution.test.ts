import { describe, expect, it } from "vitest";
import { extractJourneyDefinitionReferences } from "./journeyDefinition";

describe("Journey trigger references", () => {
  it("keeps a custom event name available for Dataverse resolution", () => {
    const result = extractJourneyDefinitionReferences({
      trigger: {
        type: "Event",
        parameters: { eventName: "msdynmkt_dddd_083643294" },
      },
      actions: {},
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.kind).toBe("trigger");
    expect((result.nodes[0]?.record.parameters as Record<string, unknown>).eventName).toBe("msdynmkt_dddd_083643294");
  });
});
