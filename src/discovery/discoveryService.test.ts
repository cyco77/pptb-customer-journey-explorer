import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadJourneys } from "./discoveryService.ts";

describe("loadJourneys pagination", () => {
  beforeEach(() => {
    const firstPage = Array.from({ length: 5000 }, (_, index) => ({
      msdynmkt_journeyid: `journey-${index}`,
      msdynmkt_name: `Journey ${index}`,
    }));
    const secondPage = Array.from({ length: 101 }, (_, index) => ({
      msdynmkt_journeyid: `journey-${5000 + index}`,
      msdynmkt_name: `Journey ${5000 + index}`,
    }));
    const queryData = vi.fn()
      .mockResolvedValueOnce({
        value: firstPage,
        "@odata.nextLink": "https://org.crm.dynamics.com/api/data/v9.2/msdynmkt_journeys?$skiptoken=page-2",
      })
      .mockResolvedValueOnce({ value: secondPage });

    vi.stubGlobal("window", {
      dataverseAPI: {
        getAllEntitiesMetadata: vi.fn().mockResolvedValue({ value: [{
          LogicalName: "msdynmkt_journey",
          DisplayName: { UserLocalizedLabel: { Label: "Journey" } },
          EntitySetName: "msdynmkt_journeys",
          PrimaryIdAttribute: "msdynmkt_journeyid",
          PrimaryNameAttribute: "msdynmkt_name",
        }] }),
        getEntityRelatedMetadata: vi.fn().mockResolvedValue({ value: [] }),
        queryData,
      },
    });
  });

  it("loads Journey records from pages beyond the 5,000-record Dataverse limit", async () => {
    const { journeys, warnings } = await loadJourneys();

    expect(journeys).toHaveLength(5101);
    expect(journeys.some((journey) => journey.id === "journey-5000")).toBe(true);
    expect(warnings).toEqual([]);
    expect(window.dataverseAPI.queryData).toHaveBeenCalledTimes(2);
    expect(window.dataverseAPI.queryData).toHaveBeenLastCalledWith(
      "msdynmkt_journeys?$skiptoken=page-2",
      "primary",
    );
  });
});
