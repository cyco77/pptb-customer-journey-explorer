import { describe, expect, it } from "vitest";
import type { Artifact, Dependency } from "./types";
import { getSemanticParentArtifact } from "./semanticRelationships";

const compliance: Artifact = {
  id: "compliance:1", kind: "compliance", logicalName: "compliance", entitySetName: "compliances",
  recordId: "1", displayName: "Profile", sourceRecord: {}, warnings: [],
};
const purpose: Artifact = {
  id: "purpose:1", kind: "purpose", logicalName: "purpose", entitySetName: "purposes",
  recordId: "2", displayName: "Transactional", sourceRecord: {}, warnings: [],
};

describe("semantic parent resolution", () => {
  it("resolves a Purpose parent when the dependency points from parent to child", () => {
    const dependency: Dependency = {
      id: "compliance-to-purpose", sourceArtifactId: compliance.id, targetArtifactId: purpose.id,
      relationType: "lookup", label: "Purpose", resolved: true, warnings: [],
    };

    expect(getSemanticParentArtifact(purpose, [compliance, purpose], [dependency])).toBe(compliance);
  });

  it("resolves a Purpose parent when the dependency points from child to parent", () => {
    const dependency: Dependency = {
      id: "purpose-to-compliance", sourceArtifactId: purpose.id, targetArtifactId: compliance.id,
      relationType: "lookup", label: "Compliance Profile", resolved: true, warnings: [],
    };

    expect(getSemanticParentArtifact(purpose, [compliance, purpose], [dependency])).toBe(compliance);
  });

  it("resolves a Purpose parent from its raw lookup when relationship metadata omitted the edge", () => {
    const purposeWithLookup: Artifact = {
      ...purpose,
      sourceRecord: { _msdynmkt_compliancesettingsid_value: compliance.recordId },
    };

    expect(getSemanticParentArtifact(purposeWithLookup, [compliance, purposeWithLookup], [])).toBe(compliance);
  });

  it("uses the only possible Compliance Profile when both lookup and dependency are absent", () => {
    expect(getSemanticParentArtifact(purpose, [compliance, purpose], [])).toBe(compliance);
  });
});
