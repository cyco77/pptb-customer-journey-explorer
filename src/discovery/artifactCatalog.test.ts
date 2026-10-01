import { describe, expect, it } from "vitest";
import { ARTIFACT_DEFINITIONS, getArtifactLabel, getMigrationRank, getParentKind, getParentLookupField, isSupportedArtifactKind, validateArtifactCatalog } from "./artifactCatalog";

describe("artifact catalog", () => {
  it("passes validation with unique, complete artifact definitions and acyclic dependencies", () => {
    expect(validateArtifactCatalog()).toEqual([]);
  });

  it("centralizes hierarchy relationships, schema lookups, and migration ordering", () => {
    expect(getParentKind("sender")).toBe("brandProfile");
    expect(getParentLookupField("sender")).toBe("msdynmkt_brandprofileid");
    expect(getParentKind("purpose")).toBe("compliance");
    expect(getParentKind("topic")).toBe("purpose");
    expect(getMigrationRank("compliance")).toBeLessThan(getMigrationRank("purpose"));
    expect(getMigrationRank("purpose")).toBeLessThan(getMigrationRank("topic"));
  });

  it("provides labels and support status from definitions", () => {
    expect(getArtifactLabel("brandProfile")).toBe("Brand profile");
    expect(isSupportedArtifactKind("email")).toBe(true);
    expect(isSupportedArtifactKind("team")).toBe(false);
    expect(ARTIFACT_DEFINITIONS.length).toBeGreaterThan(0);
  });
});
