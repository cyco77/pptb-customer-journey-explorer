import { Entity } from "../types/entity";
import { Solution } from "../types/solution";
import { View } from "../types/view";
import { logger } from "./loggerService";

export const loadSolutions = async (): Promise<Solution[]> => {
  const url =
    "solutions?$select=solutionid,friendlyname,uniquename,version,_publisherid_value&$filter=isvisible eq true&$orderby=friendlyname asc";

  const allRecords = await loadAllData(url);
  const publisherIds = [
    ...new Set(
      allRecords
        .map((record: any) => record._publisherid_value)
        .filter((publisherId: unknown): publisherId is string =>
          typeof publisherId === "string",
        ),
    ),
  ];
  const publishers = new Map<string, { name: string; uniqueName: string }>();

  if (publisherIds.length > 0) {
    const publisherRecords = await loadAllData(
      "publishers?$select=publisherid,friendlyname,uniquename",
    );
    publisherRecords.forEach((publisher: any) => {
      if (publisher.publisherid) {
        publishers.set(publisher.publisherid, {
          name: publisher.friendlyname,
          uniqueName: publisher.uniquename,
        });
      }
    });
  }

  return allRecords.map((record: any) => ({
    solutionid: record.solutionid,
    friendlyname: record.friendlyname,
    uniquename: record.uniquename,
    version: record.version,
    publisherName: publishers.get(record._publisherid_value)?.name,
    publisherUniqueName: publishers.get(record._publisherid_value)?.uniqueName,
  }));
};

export type SolutionSelector = {
  solutionId?: string;
  solutionName?: string;
  solutionUniqueName?: string;
  publisher?: string;
};

export type SolutionResolution =
  | { status: "resolved"; solution: Solution }
  | {
      status: "selection-required";
      solutions: Solution[];
      suggestions: Array<{ solution: Solution; score: number }>;
    };

export const resolveSolution = (
  solutions: Solution[],
  selector: SolutionSelector,
): SolutionResolution => {
  const normalizeName = (value: string | undefined): string =>
    (value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const matchesName = (value: string | undefined, expected: string) =>
    normalizeName(value) === normalizeName(expected);
  const similarity = (left: string, right: string): number => {
    if (left === right) return 1;
    if (!left || !right) return 0;
    const distances = Array.from({ length: right.length + 1 }, (_, i) => i);
    for (let row = 1; row <= left.length; row++) {
      let diagonal = distances[0];
      distances[0] = row;
      for (let column = 1; column <= right.length; column++) {
        const above = distances[column];
        distances[column] = Math.min(
          distances[column] + 1,
          distances[column - 1] + 1,
          diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
        );
        diagonal = above;
      }
    }
    return 1 - distances[right.length] / Math.max(left.length, right.length);
  };
  const nameSimilarity = (solution: Solution, expected: string) =>
    Math.max(
      similarity(normalizeName(solution.friendlyname), normalizeName(expected)),
      similarity(normalizeName(solution.uniquename), normalizeName(expected)),
    );

  const solutionId = selector.solutionId?.trim().toLowerCase();
  const solutionName = selector.solutionName?.trim().toLowerCase();
  const solutionUniqueName = selector.solutionUniqueName?.trim().toLowerCase();
  const publisher = selector.publisher?.trim().toLowerCase();

  if (!solutionId && !solutionName && !solutionUniqueName && !publisher) {
    return { status: "selection-required", solutions: [], suggestions: [] };
  }

  const matches = solutions.filter((solution) => {
    if (solutionId && solution.solutionid.toLowerCase() !== solutionId) {
      return false;
    }
    if (
      solutionName &&
      !matchesName(solution.friendlyname, solutionName) &&
      !matchesName(solution.uniquename, solutionName)
    ) {
      return false;
    }
    if (
      solutionUniqueName &&
      !matchesName(solution.uniquename, solutionUniqueName)
    ) {
      return false;
    }
    if (
      publisher &&
      solution.publisherName?.toLowerCase() !== publisher &&
      solution.publisherUniqueName?.toLowerCase() !== publisher
    ) {
      return false;
    }
    return true;
  });

  if (matches.length === 0) {
    const scored = solutions
      .map((solution) => {
        const scores: number[] = [];
        if (solutionName) scores.push(nameSimilarity(solution, solutionName));
        if (solutionUniqueName) {
          scores.push(
            similarity(
              normalizeName(solution.uniquename),
              normalizeName(solutionUniqueName),
            ),
          );
        }
        if (publisher) {
          scores.push(
            Math.max(
              similarity(normalizeName(solution.publisherName), normalizeName(publisher)),
              similarity(
                normalizeName(solution.publisherUniqueName),
                normalizeName(publisher),
              ),
            ),
          );
        }
        return {
          solution,
          score: scores.length
            ? scores.reduce((total, score) => total + score, 0) / scores.length
            : 0,
        };
      })
      .filter((match) => match.score >= 0.65)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
    const top = scored[0];
    const next = scored[1];
    if (top && top.score >= 0.9 && (!next || top.score - next.score >= 0.08)) {
      return { status: "resolved", solution: top.solution };
    }
    return {
      status: "selection-required",
      solutions: scored.map((match) => match.solution),
      suggestions: scored,
    };
  }

  return matches.length === 1
    ? { status: "resolved", solution: matches[0] }
    : {
        status: "selection-required",
        solutions: matches,
        suggestions: matches.map((solution) => ({ solution, score: 1 })),
      };
};

export const loadEntities = async (
  solutionIds?: string | string[],
): Promise<Entity[]> => {
  let url =
    "EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,DataProviderId&$filter=IsCustomizable/Value eq true";

  const allRecords = await loadAllData(url);

  let entities = allRecords
    .filter((record: any) => !record.DataProviderId) // Exclude virtual entities
    .map((record: any) => ({
      logicalname: String(record.LogicalName || ""),
      displayname:
        String(
          record.DisplayName?.UserLocalizedLabel?.Label ||
            record.LogicalName ||
            "Unknown entity",
        ),
      entitysetname: String(record.EntitySetName || ""),
    }));

  // If a solution is selected, filter entities by solution components
  const selectedSolutionIds = solutionIds
    ? Array.isArray(solutionIds)
      ? solutionIds
      : [solutionIds]
    : [];
  if (selectedSolutionIds.length) {
    const solutionEntities = await getEntitiesInSolutions(selectedSolutionIds);
    entities = entities.filter((entity) =>
      solutionEntities.has(entity.logicalname.toLowerCase()),
    );
  }

  return entities;
};

const normalizeGuid = (value: unknown): string =>
  typeof value === "string"
    ? value.replace(/[{}]/g, "").trim().toLowerCase()
    : "";

const getEntitiesInSolutions = async (solutionIds: string[]): Promise<Set<string>> => {
  const componentResults = await Promise.all(
    solutionIds.map(async (solutionId) => {
      const url = `solutioncomponents?$select=objectid&$filter=_solutionid_value eq ${solutionId} and componenttype eq 1`;
      const components = await loadAllData(url);
      if (components.length === 0) {
        logger.warning(`Solution ${solutionId} does not contain any entities.`);
      }
      return components;
    }),
  );
  const components = componentResults.flat();

  // Get entity metadata IDs from solution components
  const entityMetadataIds = components
    .map((comp: any) => normalizeGuid(comp.objectid))
    .filter(Boolean);

  if (entityMetadataIds.length === 0) {
    return new Set();
  }

  const normalizedMetadataIds = new Set(entityMetadataIds);

  // Query EntityDefinitions to get logical names for these metadata IDs
  const entityDefsUrl = `EntityDefinitions?$select=LogicalName,MetadataId&$filter=IsCustomizable/Value eq true`;
  const entityDefs = await loadAllData(entityDefsUrl);

  const logicalNames = entityDefs
    .filter((def: any) => normalizedMetadataIds.has(normalizeGuid(def.MetadataId)))
    .map((def: any) => String(def.LogicalName || "").trim().toLowerCase())
    .filter(Boolean);

  return new Set(logicalNames);
};

export const loadAllViews = async (): Promise<Map<string, View[]>> => {
  try {
    const url = `savedqueries?$select=savedqueryid,name,returnedtypecode,fetchxml&$filter=querytype eq 0&$orderby=returnedtypecode,name asc`;
    const allRecords = await loadAllData(url);

    // Group views by entity logical name
    const viewsByEntity = new Map<string, View[]>();

    allRecords.forEach((record: any) => {
      const savedqueryid = String(record.savedqueryid || "");
      const returnedtypecode = String(record.returnedtypecode || "");
      if (!savedqueryid || !returnedtypecode) {
        return;
      }

      const view: View = {
        savedqueryid,
        name: String(record.name || savedqueryid),
        returnedtypecode,
        fetchxml: typeof record.fetchxml === "string" ? record.fetchxml : undefined,
      };

      const entityName = record.returnedtypecode;
      if (!viewsByEntity.has(entityName)) {
        viewsByEntity.set(entityName, []);
      }
      viewsByEntity.get(entityName)!.push(view);
    });

    logger.info(
      `Loaded ${allRecords.length} views for ${viewsByEntity.size} entities`,
    );
    return viewsByEntity;
  } catch (error) {
    logger.error(`Error loading all views: ${(error as Error).message}`);
    return new Map();
  }
};

export const loadViewsForEntity = async (
  entityLogicalName: string,
): Promise<View[]> => {
  try {
    const url = `savedqueries?$select=savedqueryid,name,returnedtypecode,fetchxml&$filter=returnedtypecode eq '${entityLogicalName}' and querytype eq 0&$orderby=name asc`;
    const allRecords = await loadAllData(url);

    return allRecords.map((record: any) => ({
      savedqueryid: record.savedqueryid,
      name: record.name,
      returnedtypecode: record.returnedtypecode,
      fetchxml: record.fetchxml,
    }));
  } catch (error) {
    logger.error(
      `Error loading views for ${entityLogicalName}: ${
        (error as Error).message
      }`,
    );
    return [];
  }
};

export const countRecords = async (
  entitySetName: string,
  entityLogicalName: string,
  fetchXml?: string,
): Promise<number> => {
  try {
    if (!entityLogicalName) {
      logger.info(`No entity logical name provided`);
      return 0;
    }

    if (fetchXml) {
      // Simple paging approach for view-based counting
      logger.info(
        `Counting records for ${entityLogicalName} using view FetchXML with simple pagination`,
      );

      let totalCount = 0;
      let hasMorePages = true;
      let pageNumber = 1;

      while (hasMorePages) {
        // Modify FetchXML to include page number and count
        let pagedFetchXml = fetchXml;

        // Remove any existing page, count, and paging-cookie attributes
        pagedFetchXml = pagedFetchXml.replace(/\spage=['"]?\d+['"]?/gi, "");
        pagedFetchXml = pagedFetchXml.replace(/\scount=['"]?\d+['"]?/gi, "");
        pagedFetchXml = pagedFetchXml.replace(
          /\spaging-cookie=['"][^'"]*['"]/gi,
          "",
        );

        // Add page and count attributes
        pagedFetchXml = pagedFetchXml.replace(
          /<fetch/i,
          `<fetch page="${pageNumber}" count="5000"`,
        );

        logger.info(`Fetching page ${pageNumber} for ${entityLogicalName}...`);

        const queryUrl = `${entitySetName}?fetchXml=${encodeURIComponent(
          pagedFetchXml,
        )}`;
        const response = await globalThis.dataverseAPI.queryData(queryUrl);
        const pageCount = response.value?.length || 0;
        totalCount += pageCount;

        logger.info(
          `Page ${pageNumber} returned ${pageCount} records (total: ${totalCount})`,
        );

        // Continue if we got a full page
        hasMorePages = pageCount === 5000;
        pageNumber++;

        // Safety limit to prevent infinite loops
        if (pageNumber > 1000) {
          logger.error(
            `Stopping pagination at 1000 pages for ${entityLogicalName}`,
          );
          break;
        }
      }

      logger.info(`Final count result for ${entityLogicalName}: ${totalCount}`);
      return totalCount;
    } else {
      // Single entity count using RetrieveTotalRecordCount
      const counts = await countRecordsBatch([entityLogicalName]);
      return counts[entityLogicalName] || 0;
    }
  } catch (error) {
    logger.error(
      `Error counting records for ${entityLogicalName}: ${
        (error as Error).message
      }`,
    );
    return 0;
  }
};

/**
 * Count records for multiple entities in a single batch request
 * @param entityLogicalNames Array of entity logical names to count
 * @returns Map of entity logical name to count
 */
export const countRecordsBatch = async (
  entityLogicalNames: string[],
): Promise<Record<string, number>> => {
  if (!entityLogicalNames || entityLogicalNames.length === 0) {
    return {};
  }

  logger.info(
    `Counting records for ${entityLogicalNames.length} entities using RetrieveTotalRecordCount batch`,
  );

  const pendingEntities = [...new Set(entityLogicalNames)];
  const results: Record<string, number> = {};

  while (pendingEntities.length > 0) {
    try {
      // Build the function call URL with parameters
      const entityNamesJson = JSON.stringify(pendingEntities);
      const functionUrl = `RetrieveTotalRecordCount(EntityNames=@p)?@p=${encodeURIComponent(
        entityNamesJson,
      )}`;
      const response = await globalThis.dataverseAPI.queryData(functionUrl);

      // Response contains EntityRecordCountCollection with separate Keys and Values arrays
      const entityRecordCounts = (response as any).EntityRecordCountCollection;

      if (
        entityRecordCounts &&
        entityRecordCounts.Keys &&
        entityRecordCounts.Values
      ) {
        // Map Keys to Values
        for (let i = 0; i < entityRecordCounts.Keys.length; i++) {
          const entityName = entityRecordCounts.Keys[i];
          const count = entityRecordCounts.Values[i] || 0;
          results[entityName] = count;
          logger.info(`Count result for ${entityName}: ${count}`);
        }
      }

      // Ensure all pending entities receive a value so UI loading state can finish.
      pendingEntities.forEach((entityName) => {
        if (!Object.prototype.hasOwnProperty.call(results, entityName)) {
          results[entityName] = 0;
        }
      });

      return results;
    } catch (error) {
      const errorMessage = (error as Error)?.message || String(error);
      const invalidEntityMatch = errorMessage.match(
        /Entity\s+'?([a-zA-Z0-9_]+)'?\s+is\s+not\s+valid\s+for\s+read/i,
      );

      if (!invalidEntityMatch) {
        throw error;
      }

      const invalidEntity = invalidEntityMatch[1];
      const indexToRemove = pendingEntities.findIndex(
        (entityName) =>
          entityName.toLowerCase() === invalidEntity.toLowerCase(),
      );

      if (indexToRemove === -1) {
        throw error;
      }

      const [removedEntity] = pendingEntities.splice(indexToRemove, 1);
      results[removedEntity] = 0;

      console.error(
        `Skipping invalid entity for record count: ${removedEntity}. Retrying without it.`,
      );
      logger.error(
        `Skipping invalid entity for record count: ${removedEntity}. Retrying without it.`,
      );
    }
  }

  return results;
};

const loadAllData = async (fullUrl: string) => {
  const allRecords = [];

  while (fullUrl) {
    logger.info(`Fetching data from URL: ${fullUrl}`);

    let relativePath = fullUrl;

    if (fullUrl.startsWith("http")) {
      const url = new URL(fullUrl);
      const apiRegex = /^\/api\/data\/v\d+\.\d+\//;
      relativePath = url.pathname.replace(apiRegex, "") + url.search;
    }

    logger.info(`Cleaned URL: ${relativePath}`);

    const response = await globalThis.dataverseAPI.queryData(relativePath);

    // Add the current page of results
    allRecords.push(...response.value);

    // Check for paging link
    fullUrl = (response as any)["@odata.nextLink"] || null;
  }

  return allRecords;
};
