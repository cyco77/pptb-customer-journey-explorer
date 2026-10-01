import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artifact, MigrationComparison, MigrationPlanItem } from "../discovery/types";
import { buildArtifactPayload, executeCreateOnlyTransfer } from "./transferService";

const profileId = "11111111-1111-1111-1111-111111111111";
const purposeId = "22222222-2222-2222-2222-222222222222";
const topicId = "33333333-3333-3333-3333-333333333333";
const targetProfileId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const targetPurposeId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const targetTopicId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const topicPurposeNavigationProperty = "msdynmkt_topic_purpose";

function artifact(
  kind: Artifact["kind"],
  logicalName: string,
  entitySetName: string,
  recordId: string,
  displayName: string,
  sourceRecord: Record<string, unknown>,
  primaryNameAttribute = "name",
): Artifact {
  return {
    id: `${logicalName}:${recordId}`,
    kind,
    logicalName,
    entitySetName,
    primaryNameAttribute,
    recordId,
    displayName,
    sourceRecord,
    warnings: [],
  };
}

function planItem(sourceArtifactId: string): MigrationPlanItem {
  return {
    sourceArtifactId,
    status: "missing",
    action: "create",
    selected: true,
    dependencySourceIds: [],
    warnings: [],
  };
}

function complianceMigration(): { comparison: MigrationComparison; profile: Artifact; purpose: Artifact; topic: Artifact } {
  const profile = artifact("compliance", "msdynmkt_compliancesettings", "msdynmkt_compliancesettingses", profileId, "Marketing consent", {
    msdynmkt_compliancesettingsid: profileId,
    name: "Marketing consent",
  });
  profile.primaryIdAttribute = "msdynmkt_compliancesettingsid";
  const purpose = artifact("purpose", "msdynmkt_purpose", "msdynmkt_purposes", purposeId, "Commercial", {
    msdynmkt_purposeid: purposeId,
    name: "Commercial",
    _msdynmkt_compliancesettingsid_value: profileId,
  });
  const topic = artifact("topic", "msdynmkt_topic", "msdynmkt_topics", topicId, "Product updates", {
    msdynmkt_topicid: topicId,
    name: "Product updates",
    _msdynmkt_purposeid_value: purposeId,
  });
  const artifacts = [profile, purpose, topic];
  const comparison: MigrationComparison = {
    source: {
      root: profile,
      artifacts,
      dependencies: [
        { id: "purpose-profile", sourceArtifactId: purpose.id, targetArtifactId: profile.id, relationType: "lookup", label: "Compliance Profile", resolved: true, warnings: [] },
        { id: "topic-purpose", sourceArtifactId: topic.id, targetArtifactId: purpose.id, relationType: "lookup", label: "Purpose", resolved: true, warnings: [] },
      ],
      warnings: [],
      discoveredAt: "2026-01-01T00:00:00.000Z",
    },
    matches: [],
    plan: artifacts.map((item) => planItem(item.id)),
    warnings: [],
    blockingErrors: [],
  };
  return { comparison, profile, purpose, topic };
}

afterEach(() => vi.unstubAllGlobals());

describe("buildArtifactPayload", () => {
  it("uses an edited target name on the entity primary name attribute", () => {
    const artifact: Artifact = {
      id: "msdynmkt_email:source-id",
      kind: "email",
      logicalName: "msdynmkt_email",
      entitySetName: "msdynmkt_emails",
      primaryNameAttribute: "msdynmkt_name",
      recordId: "source-id",
      displayName: "Original email name",
      sourceRecord: {
        msdynmkt_emailid: "source-id",
        msdynmkt_name: "Original email name",
        subject: "Welcome",
      },
      warnings: [],
    };
    const item: MigrationPlanItem = {
      sourceArtifactId: artifact.id,
      status: "ambiguous",
      action: "create",
      selected: true,
      createName: "Edited target email name",
      dependencySourceIds: [],
      warnings: [],
    };
    const comparison: MigrationComparison = {
      source: { root: artifact, artifacts: [artifact], dependencies: [], warnings: [], discoveredAt: "2026-01-01T00:00:00.000Z" },
      matches: [],
      plan: [item],
      warnings: [],
      blockingErrors: [],
    };

    const payload = buildArtifactPayload(item, artifact, comparison, new Map());

    expect(payload.msdynmkt_emailid).toBeUndefined();
    expect(payload.msdynmkt_name).toBe("Edited target email name");
    expect(payload.subject).toBe("Welcome");
  });

  it("uses the created Compliance Profile and existing generated Purpose IDs for Topics", async () => {
    const { comparison, profile, purpose, topic } = complianceMigration();
    const create = vi.fn(async (logicalName: string, _payload: Record<string, unknown>) => ({ id: logicalName === profile.logicalName ? targetProfileId : targetTopicId }));
    const retrieve = vi.fn(async () => ({}));
    const purposeQueries: string[] = [];
    const fetchXmlQuery = vi.fn(async (fetchXml: string) => {
      purposeQueries.push(fetchXml);
      return { value: [{
        msdynmkt_purposeid: targetPurposeId,
        name: "Commercial",
      }] };
    });
    const associate = vi.fn(async () => {});
    const getEntityRelatedMetadata = vi.fn(async (entityName: string, relatedPath: string) => ({ value: entityName === topic.logicalName && relatedPath === "ManyToOneRelationships" ? [{
      ReferencingEntity: topic.logicalName,
      ReferencedEntity: purpose.logicalName,
      ReferencingAttribute: "msdynmkt_purposeid",
      ReferencingEntityNavigationPropertyName: topicPurposeNavigationProperty,
    }] : [] }));
    const update = vi.fn(async () => {});
    vi.stubGlobal("window", { dataverseAPI: { create, retrieve, queryData: vi.fn(), fetchXmlQuery, associate, getEntityRelatedMetadata, update } });
    const progress: Array<{ status: string; message?: string }> = [];

    const result = await executeCreateOnlyTransfer(comparison, (entry) => progress.push(entry));

    expect(create.mock.calls.map(([logicalName]) => logicalName)).toEqual([profile.logicalName, topic.logicalName]);
    expect(fetchXmlQuery).toHaveBeenCalledWith(expect.stringContaining(`name="msdynmkt_compliancesettings4"`), "secondary");
    expect(purposeQueries[0]).toContain(`value="${targetProfileId}"`);
    expect(result.failed).toEqual([]);
    expect(result.created).toContainEqual({ sourceArtifactId: topic.id, targetId: targetTopicId });
    expect(create.mock.calls[1]?.[1]).toHaveProperty(`${topicPurposeNavigationProperty}@odata.bind`, `/msdynmkt_purposes(${targetPurposeId})`);
    expect(create.mock.calls[1]?.[1]).not.toHaveProperty("msdynmkt_purposeid@odata.bind");
    expect(associate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.skipped).toContain(purpose.id);
    expect(progress.some((entry) => entry.message?.includes("already exists"))).toBe(true);
  });

  it("creates a missing Purpose under the new Compliance Profile and uses its ID for Topics", async () => {
    const { comparison, profile, purpose, topic } = complianceMigration();
    const ids = new Map([[profile.logicalName, targetProfileId], [purpose.logicalName, targetPurposeId], [topic.logicalName, targetTopicId]]);
    const create = vi.fn(async (logicalName: string, _payload: Record<string, unknown>) => ({ id: ids.get(logicalName)! }));
    const retrieve = vi.fn(async () => ({}));
    const queryData = vi.fn(async () => ({ value: [] }));
    const fetchXmlQuery = vi.fn(async () => ({ value: [] }));
    const calls: string[] = [];
    create.mockImplementation(async (logicalName: string, _payload: Record<string, unknown>) => {
      calls.push(`create:${logicalName}`);
      return { id: ids.get(logicalName)! };
    });
    const associate = vi.fn(async () => {});
    associate.mockImplementation(async () => { calls.push("associate:purpose-compliance"); });
    const getEntityRelatedMetadata = vi.fn(async (entityName: string, relatedPath: string) => ({ value: entityName === topic.logicalName && relatedPath === "ManyToOneRelationships" ? [{
      ReferencingEntity: topic.logicalName,
      ReferencedEntity: purpose.logicalName,
      ReferencingAttribute: "msdynmkt_purposeid",
      ReferencingEntityNavigationPropertyName: topicPurposeNavigationProperty,
    }] : [] }));
    const update = vi.fn(async () => { calls.push("update:topic-purpose"); });
    vi.stubGlobal("window", { dataverseAPI: { create, retrieve, queryData, fetchXmlQuery, associate, getEntityRelatedMetadata, update } });

    const result = await executeCreateOnlyTransfer(comparison);

    expect(create.mock.calls.map(([logicalName]) => logicalName)).toEqual([profile.logicalName, purpose.logicalName, topic.logicalName]);
    expect(create.mock.calls[2]?.[1]).toHaveProperty(`${topicPurposeNavigationProperty}@odata.bind`, `/msdynmkt_purposes(${targetPurposeId})`);
    expect(create.mock.calls[2]?.[1]).not.toHaveProperty("msdynmkt_purposeid@odata.bind");
    expect(create.mock.calls[1]?.[1]).not.toHaveProperty("msdynmkt_compliancesettings4@odata.bind");
    expect(associate).toHaveBeenCalledWith(
      purpose.logicalName,
      targetPurposeId,
      "msdynmkt_msdynmkt_purpose_msdynmkt_compliancev4",
      profile.logicalName,
      targetProfileId,
      "secondary",
    );
    expect(calls).toEqual([
      `create:${profile.logicalName}`,
      `create:${purpose.logicalName}`,
      "associate:purpose-compliance",
      `create:${topic.logicalName}`,
    ]);
    expect(create.mock.calls[2]?.[1]).toHaveProperty(`${topicPurposeNavigationProperty}@odata.bind`, `/msdynmkt_purposes(${targetPurposeId})`);
    expect(update).not.toHaveBeenCalled();
    expect(result.created).toHaveLength(3);
    expect(result.created.every((entry) => Boolean(entry.targetId))).toBe(true);
    expect(result.failed).toEqual([]);
  });

  it("creates Topics under the manually mapped existing Purpose", async () => {
    const { comparison, profile, purpose, topic } = complianceMigration();
    const profilePlan = comparison.plan.find((item) => item.sourceArtifactId === profile.id)!;
    profilePlan.action = "automatically-mapped";
    profilePlan.selected = false;
    profilePlan.status = "exact-match";
    profilePlan.targetRecordId = targetProfileId;

    const purposePlan = comparison.plan.find((item) => item.sourceArtifactId === purpose.id)!;
    purposePlan.action = "manual";
    purposePlan.selected = true;
    purposePlan.status = "exact-match";
    purposePlan.targetRecordId = targetPurposeId;

    const topicIds = [
      "44444444-4444-4444-4444-444444444444",
      "55555555-5555-5555-5555-555555555555",
      "66666666-6666-6666-6666-666666666666",
    ];
    const topicArtifacts = topicIds.map((recordId, index) => artifact(
      "topic",
      topic.logicalName,
      topic.entitySetName,
      recordId,
      ["Energie", "Wasser", "Transport"][index],
      { [`${topic.logicalName}id`]: recordId, name: ["Energie", "Wasser", "Transport"][index], _msdynmkt_purposeid_value: purposeId },
    ));
    comparison.source.artifacts = [profile, purpose, ...topicArtifacts];
    comparison.source.dependencies = [
      { id: "purpose-profile", sourceArtifactId: purpose.id, targetArtifactId: profile.id, relationType: "lookup", label: "Compliance Profile", resolved: true, warnings: [] },
      ...topicArtifacts.map((item) => ({ id: `${item.id}->${purpose.id}`, sourceArtifactId: item.id, targetArtifactId: purpose.id, relationType: "lookup" as const, label: "Purpose", resolved: true, warnings: [] })),
    ];
    comparison.plan = [profilePlan, purposePlan, ...topicArtifacts.map((item) => ({ ...planItem(item.id), action: "create" as const, selected: true }))];

    const creates: Array<{ logicalName: string; payload: Record<string, unknown> }> = [];
    const create = vi.fn(async (logicalName: string, payload: Record<string, unknown>) => {
      creates.push({ logicalName, payload });
      return { id: topicIds[creates.length - 1] };
    });
    const retrieve = vi.fn(async () => ({}));
    const associate = vi.fn(async () => {});
    const fetchXmlQuery = vi.fn(async () => ({ value: [] }));
    const getEntityRelatedMetadata = vi.fn(async () => ({ value: [{
      ReferencingEntity: topic.logicalName,
      ReferencedEntity: purpose.logicalName,
      ReferencingAttribute: "msdynmkt_purposeid",
      ReferencingEntityNavigationPropertyName: topicPurposeNavigationProperty,
    }] }));
    const update = vi.fn(async () => {});
    vi.stubGlobal("window", { dataverseAPI: { create, retrieve, associate, fetchXmlQuery, getEntityRelatedMetadata, update } });

    const result = await executeCreateOnlyTransfer(comparison);

    expect(result.failed).toEqual([]);
    expect(result.created).toHaveLength(3);
    expect(result.created.every((entry) => Boolean(entry.targetId))).toBe(true);
    expect(creates).toHaveLength(3);
    expect(creates.every(({ logicalName }) => logicalName === topic.logicalName)).toBe(true);
    expect(creates.every(({ payload }) => !("msdynmkt_purposeid" in payload))).toBe(true);
    expect(creates.every(({ payload }) => !("msdynmkt_purposeid@odata.bind" in payload))).toBe(true);
    expect(creates.every(({ payload }) => `${topicPurposeNavigationProperty}@odata.bind` in payload)).toBe(true);
    expect(creates.map(({ payload }) => payload[`${topicPurposeNavigationProperty}@odata.bind`])).toEqual(
      topicArtifacts.map(() => `/msdynmkt_purposes(${targetPurposeId})`),
    );
    expect(associate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("creates referenced records before the Journey and rewrites their IDs in Journey JSON", async () => {
    const journeyId = "77777777-7777-7777-7777-777777777777";
    const emailId = "88888888-8888-8888-8888-888888888888";
    const targetJourneyId = "99999999-9999-9999-9999-999999999999";
    const targetEmailId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const email = artifact("email", "msdynmkt_email", "msdynmkt_emails", emailId, "Welcome email", {
      msdynmkt_emailid: emailId,
      msdynmkt_name: "Welcome email",
    }, "msdynmkt_name");
    const journey = artifact("journey", "msdynmkt_journey", "msdynmkt_journeys", journeyId, "Spring campaign", {
      msdynmkt_journeyid: journeyId,
      msdynmkt_name: "Spring campaign",
      msdynmkt_journeyjson: JSON.stringify({ actions: { send: { type: "SendEmail", parameters: { contentId: emailId } } } }),
    }, "msdynmkt_name");
    const emailItem = planItem(email.id);
    const journeyItem = planItem(journey.id);
    const comparison: MigrationComparison = {
      source: {
        root: journey,
        artifacts: [journey, email],
        dependencies: [{ id: "journey-email-json", sourceArtifactId: journey.id, targetArtifactId: email.id, relationType: "embedded-in-json", label: "Journey email", path: "actions.send.parameters.contentId", resolved: true, warnings: [] }],
        warnings: [],
        discoveredAt: "2026-01-01T00:00:00.000Z",
      },
      matches: [],
      plan: [journeyItem, emailItem],
      warnings: [],
      blockingErrors: [],
    };
    const calls: string[] = [];
    const create = vi.fn(async (logicalName: string, payload: Record<string, unknown>) => {
      calls.push(logicalName);
      if (logicalName === email.logicalName) return { id: targetEmailId };
      expect(JSON.parse(String(payload.msdynmkt_journeyjson))).toEqual({
        actions: { send: { type: "SendEmail", parameters: { contentId: targetEmailId } } },
      });
      return { id: targetJourneyId };
    });
    const retrieve = vi.fn(async () => ({}));
    vi.stubGlobal("window", { dataverseAPI: { create, retrieve } });

    const result = await executeCreateOnlyTransfer(comparison);

    expect(calls).toEqual([email.logicalName, journey.logicalName]);
    expect(result.failed).toEqual([]);
    expect(result.created).toEqual([
      { sourceArtifactId: email.id, targetId: targetEmailId },
      { sourceArtifactId: journey.id, targetId: targetJourneyId },
    ]);
  });

  it("blocks Journey creation if a referenced dependent has no mapping or selected create action", async () => {
    const journeyId = "77777777-7777-7777-7777-777777777777";
    const emailId = "88888888-8888-8888-8888-888888888888";
    const email = artifact("email", "msdynmkt_email", "msdynmkt_emails", emailId, "Welcome email", {
      msdynmkt_emailid: emailId,
      msdynmkt_name: "Welcome email",
    }, "msdynmkt_name");
    const journey = artifact("journey", "msdynmkt_journey", "msdynmkt_journeys", journeyId, "Spring campaign", {
      msdynmkt_journeyid: journeyId,
      msdynmkt_name: "Spring campaign",
      msdynmkt_journeyjson: JSON.stringify({ contentId: emailId }),
    }, "msdynmkt_name");
    const emailItem = { ...planItem(email.id), action: "skip" as const, selected: false };
    const journeyItem = planItem(journey.id);
    const comparison: MigrationComparison = {
      source: {
        root: journey,
        artifacts: [journey, email],
        dependencies: [],
        warnings: [],
        discoveredAt: "2026-01-01T00:00:00.000Z",
      },
      matches: [],
      plan: [journeyItem, emailItem],
      warnings: [],
      blockingErrors: [],
    };
    const create = vi.fn(async () => ({ id: "journey-target-id" }));
    vi.stubGlobal("window", { dataverseAPI: { create, retrieve: vi.fn(async () => ({})) } });

    await expect(executeCreateOnlyTransfer(comparison)).rejects.toThrow("referenced email 'Welcome email' has no target mapping");
    expect(create).not.toHaveBeenCalled();
  });

  it("falls back to a scoped purpose lookup when the filtered query returns no rows", async () => {
    const { comparison, profile, purpose } = complianceMigration();
    comparison.source.artifacts = [profile, purpose];
    comparison.source.dependencies = comparison.source.dependencies.filter((edge) => edge.sourceArtifactId === purpose.id);
    comparison.plan = comparison.plan.filter((item) => item.sourceArtifactId === profile.id || item.sourceArtifactId === purpose.id);
    const create = vi.fn(async (_logicalName: string, _payload: Record<string, unknown>) => ({ id: targetProfileId }));
    const retrieve = vi.fn(async () => ({}));
    const fetchXmlQuery = vi.fn(async (_fetchXml: string, _target?: "primary" | "secondary"): Promise<{ value: Record<string, unknown>[] }> => ({ value: [] }));
    const associate = vi.fn(async () => {});
    vi.stubGlobal("window", { dataverseAPI: { create, retrieve, queryData: vi.fn(), fetchXmlQuery, associate } });
    const progress: Array<{ status: string; message?: string }> = [];

    const result = await executeCreateOnlyTransfer(comparison, (entry) => progress.push(entry));

    expect(fetchXmlQuery).toHaveBeenCalledTimes(1);
    expect(result.skipped).not.toContain(purpose.id);
    expect(result.created).toHaveLength(2);
    expect(associate).toHaveBeenCalledTimes(1);
  });
});
