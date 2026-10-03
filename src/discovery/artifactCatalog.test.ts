import { describe, expect, it } from "vitest";
import { ARTIFACT_DEFINITIONS, getArtifactDefinition, getArtifactLabel, getMigrationRank, getParentKind, getParentLookupField, getParentNavigationProperty, isSupportedArtifactKind, validateArtifactCatalog, type ArtifactDefinition } from "./artifactCatalog";
import type { ArtifactKind } from "./types";

describe("artifact catalog", () => {
  it("passes validation with unique, complete artifact definitions and acyclic dependencies", () => {
    expect(validateArtifactCatalog()).toEqual([]);
  });

  it("centralizes hierarchy relationships, schema lookups, and migration ordering", () => {
    expect(getParentKind("sender")).toBe("brandProfile");
    expect(getParentLookupField("sender")).toBe("msdynmkt_brandprofileid");
    expect(getParentKind("purpose")).toBe("compliance");
    expect(getParentLookupField("purpose")).toBe("msdynmkt_compliancesettingsid");
    expect(getParentNavigationProperty("purpose")).toBe("msdynmkt_compliancesettings4");
    expect(getParentKind("topic")).toBe("purpose");
    expect(getParentLookupField("topic")).toBe("msdynmkt_purposeid");
    expect(getMigrationRank("compliance")).toBeLessThan(getMigrationRank("purpose"));
    expect(getMigrationRank("purpose")).toBeLessThan(getMigrationRank("topic"));
  });

  it("provides labels and support status from definitions", () => {
    expect(getArtifactLabel("brandProfile")).toBe("Brand profile");
    expect(isSupportedArtifactKind("email")).toBe(true);
    expect(isSupportedArtifactKind("team")).toBe(false);
    expect(ARTIFACT_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it("uses the unknown definition and fallback rank for kinds without explicit metadata", () => {
    expect(getArtifactDefinition("unknown").label).toBe("Unknown");
    expect(getArtifactLabel("businessRecord")).toBe("Related record");
    expect(getMigrationRank("unknown")).toBe(10);
    expect(getMigrationRank("unknown", 42)).toBe(42);
    expect(getParentKind("email")).toBeUndefined();
    expect(getParentLookupField("email")).toBeUndefined();
    expect(getParentNavigationProperty("topic")).toBeUndefined();
  });

  it("reports duplicate, missing, unsupported, and malformed catalog definitions", () => {
    const broken: ArtifactDefinition[] = [
      { kind: "journey", label: "Journey", supported: true },
      { kind: "journey", label: "  ", parentLookupField: "orphan_lookup", parentKind: "asset", expandChildren: ["trigger"] },
      { kind: "email", label: "Email", parentLookupField: "unparented_lookup" },
      { kind: "topic", label: "Topic", parentKind: "asset" },
      { kind: "sender", label: "Sender", parentKind: "brandProfile" },
      { kind: "brandProfile", label: "Brand", parentKind: "sender" },
    ];
    const references: Readonly<Record<string, readonly ArtifactKind[]>> = {
      "": ["asset"],
      not_a_field: ["asset", "unknown"],
    };

    const errors = validateArtifactCatalog(broken, references);

    expect(errors).toContain("Duplicate artifact kind: journey");
    expect(errors).toContain("Missing display label for journey");
    expect(errors).toContain("Supported artifact journey has no discovery terms");
    expect(errors).toContain("email defines parent lookup unparented_lookup without a parent kind");
    expect(errors).toContain("journey expands unknown child kind trigger");
    expect(errors).toContain("topic references unknown parent kind asset");
    expect(errors).toContain("Cyclic artifact dependency includes sender");
    expect(errors).toContain("JSON reference field names cannot be empty");
    expect(errors).toContain("JSON reference not_a_field targets unknown artifact kind asset");
  });
});
