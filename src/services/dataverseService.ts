import { Entity } from "../types/entity";
import { Solution } from "../types/solution";
import { View } from "../types/view";
import { logger } from "./loggerService";
export { resolveSolution, type SolutionResolution, type SolutionSelector } from "./solutionResolution";

type DataverseRecord = Record<string, unknown>;
type PagedQueryResponse = {
  value: DataverseRecord[];
  "@odata.nextLink"?: string;
};

function isRecord(value: unknown): value is DataverseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relativeQueryPath(urlOrPath: string): string {
  if (!/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  const url = new URL(urlOrPath);
  return url.pathname.replace(/^\/api\/data\/v\d+\.\d+\//, "") + url.search;
}

export const loadSolutions = async (): Promise<Solution[]> => {
  const url =
    "solutions?$select=solutionid,friendlyname,uniquename,version,_publisherid_value&$filter=isvisible eq true&$orderby=friendlyname asc";

  const allRecords = await loadAllData(url);
  const publisherIds = [
    ...new Set(
      allRecords
        .map((record) => record._publisherid_value)
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
    publisherRecords.forEach((publisher) => {
      const publisherId = stringValue(publisher.publisherid);
      if (publisherId) {
        publishers.set(publisherId, {
          name: stringValue(publisher.friendlyname),
          uniqueName: stringValue(publisher.uniquename),
        });
      }
    });
  }

  return allRecords.map((record) => ({
    solutionid: stringValue(record.solutionid),
    friendlyname: stringValue(record.friendlyname),
    uniquename: stringValue(record.uniquename),
    version: stringValue(record.version),
    publisherName: publishers.get(stringValue(record._publisherid_value))?.name,
    publisherUniqueName: publishers.get(stringValue(record._publisherid_value))?.uniqueName,
  }));
};

export const loadEntities = async (
  solutionIds?: string | string[],
): Promise<Entity[]> => {
  let url =
    "EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,DataProviderId&$filter=IsCustomizable/Value eq true";

  const allRecords = await loadAllData(url);

  let entities = allRecords
    .filter((record) => !record.DataProviderId) // Exclude virtual entities
    .map((record) => ({
      logicalname: stringValue(record.LogicalName),
      displayname:
        stringValue(
          isRecord(record.DisplayName) && isRecord(record.DisplayName.UserLocalizedLabel)
            ? record.DisplayName.UserLocalizedLabel.Label
            : undefined,
          stringValue(record.LogicalName, "Unknown entity"),
        ),
      entitysetname: stringValue(record.EntitySetName),
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
    .map((component) => normalizeGuid(component.objectid))
    .filter(Boolean);

  if (entityMetadataIds.length === 0) {
    return new Set();
  }

  const normalizedMetadataIds = new Set(entityMetadataIds);

  // Query EntityDefinitions to get logical names for these metadata IDs
  const entityDefsUrl = `EntityDefinitions?$select=LogicalName,MetadataId&$filter=IsCustomizable/Value eq true`;
  const entityDefs = await loadAllData(entityDefsUrl);

  const logicalNames = entityDefs
    .filter((definition) => normalizedMetadataIds.has(normalizeGuid(definition.MetadataId)))
    .map((definition) => stringValue(definition.LogicalName).trim().toLowerCase())
    .filter(Boolean);

  return new Set(logicalNames);
};

export const loadAllViews = async (): Promise<Map<string, View[]>> => {
  try {
    const url = `savedqueries?$select=savedqueryid,name,returnedtypecode,fetchxml&$filter=querytype eq 0&$orderby=returnedtypecode,name asc`;
    const allRecords = await loadAllData(url);

    // Group views by entity logical name
    const viewsByEntity = new Map<string, View[]>();

    allRecords.forEach((record) => {
      const savedqueryid = stringValue(record.savedqueryid);
      const returnedtypecode = stringValue(record.returnedtypecode);
      if (!savedqueryid || !returnedtypecode) {
        return;
      }

      const view: View = {
        savedqueryid,
        name: stringValue(record.name, savedqueryid),
        returnedtypecode,
        fetchxml: stringValue(record.fetchxml) || undefined,
      };

      const entityName = returnedtypecode;
      const entityViews = viewsByEntity.get(entityName) ?? [];
      entityViews.push(view);
      viewsByEntity.set(entityName, entityViews);
    });

    logger.info(
      `Loaded ${allRecords.length} views for ${viewsByEntity.size} entities`,
    );
    return viewsByEntity;
  } catch (error) {
    logger.error(`Error loading all views: ${errorMessage(error)}`);
    return new Map();
  }
};

export const loadViewsForEntity = async (
  entityLogicalName: string,
): Promise<View[]> => {
  try {
    const url = `savedqueries?$select=savedqueryid,name,returnedtypecode,fetchxml&$filter=returnedtypecode eq '${entityLogicalName}' and querytype eq 0&$orderby=name asc`;
    const allRecords = await loadAllData(url);

    return allRecords.flatMap((record): View[] => {
      const savedqueryid = stringValue(record.savedqueryid);
      const returnedtypecode = stringValue(record.returnedtypecode);
      if (!savedqueryid || !returnedtypecode) return [];
      return [{
        savedqueryid,
        name: stringValue(record.name, savedqueryid),
        returnedtypecode,
        fetchxml: stringValue(record.fetchxml) || undefined,
      }];
    });
  } catch (error) {
    logger.error(
      `Error loading views for ${entityLogicalName}: ${
        errorMessage(error)
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
        errorMessage(error)
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
      const entityRecordCounts = isRecord(response) ? response.EntityRecordCountCollection : undefined;

      if (
        isRecord(entityRecordCounts) &&
        Array.isArray(entityRecordCounts.Keys) &&
        Array.isArray(entityRecordCounts.Values)
      ) {
        // Map Keys to Values
        for (let i = 0; i < entityRecordCounts.Keys.length; i++) {
          const entityName = entityRecordCounts.Keys[i];
          const rawCount = entityRecordCounts.Values[i];
          if (typeof entityName !== "string") continue;
          const count = typeof rawCount === "number" ? rawCount : 0;
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
      const message = errorMessage(error);
      const invalidEntityMatch = message.match(
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
      if (!removedEntity) throw error;
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
  const allRecords: DataverseRecord[] = [];

  while (fullUrl) {
    const relativePath = relativeQueryPath(fullUrl);
    logger.info(`Fetching data from URL: ${fullUrl}`);
    logger.info(`Cleaned URL: ${relativePath}`);

    const response = await globalThis.dataverseAPI.queryData(relativePath) as PagedQueryResponse;

    // Add the current page of results
    allRecords.push(...response.value);

    // Check for paging link
    fullUrl = response["@odata.nextLink"] ?? "";
  }

  return allRecords;
};
