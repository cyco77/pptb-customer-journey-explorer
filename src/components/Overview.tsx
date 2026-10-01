import React, { useState, useCallback, useEffect, useRef } from "react";
import type { DataGridProps } from "@fluentui/react-components";
import {
  loadEntities,
  loadSolutions,
  loadAllViews,
  countRecords,
  countRecordsBatch,
  resolveSolution,
} from "../services/dataverseService";
import { Entity } from "../types/entity";
import { Solution } from "../types/solution";
import { Filter } from "./Filter";
import { EntitiesDataGrid } from "./EntitiesDataGrid";
import { makeStyles, Spinner } from "@fluentui/react-components";
import { logger } from "../services/loggerService";
import { isEntityBlacklisted } from "../utils/entityBlacklist";
import { EntityGridErrorBoundary } from "./EntityGridErrorBoundary";

interface IOverviewProps {
  connection: ToolBoxAPI.DataverseConnection | null;
}

export const Overview: React.FC<IOverviewProps> = ({ connection }) => {
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedSolutionIds, setSelectedSolutionIds] = useState<string[]>([]);
  const [selectedPublishers, setSelectedPublishers] = useState<string[]>([]);
  const [textFilter, setTextFilter] = useState<string>("");
  const [isLoadingEntities, setIsLoadingEntities] = useState(false);
  const [isLoadingSolutions, setIsLoadingSolutions] = useState(false);
  const [isCountingRecords, setIsCountingRecords] = useState(false);
  const [sortState, setSortState] = useState<
    Parameters<NonNullable<DataGridProps["onSortChange"]>>[1]
  >({
    sortColumn: "displayname",
    sortDirection: "ascending",
  });
  const viewsByEntityRef = useRef<Map<string, any[]>>(new Map());
  const entityRequestRef = useRef(0);
  const connectionRequestRef = useRef(0);

  const publishers = React.useMemo(
    () =>
      [
        ...new Set(
          solutions
            .map((solution) => solution.publisherName)
            .filter(Boolean) as string[],
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [solutions],
  );
  const publisherSolutions = React.useMemo(
    () =>
      selectedPublishers.length
        ? solutions.filter(
            (solution) =>
              solution.publisherName &&
              selectedPublishers.includes(solution.publisherName),
          )
        : solutions,
    [selectedPublishers, solutions],
  );

  const useStyles = makeStyles({
    overviewRoot: {
      height: "100%",
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      minWidth: 0,
      position: "relative",
    },
    filterSection: {
      flexShrink: 0,
    },
    loadingContainer: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: "40px",
    },
    dataGridSection: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
      minWidth: 0,
      overflow: "auto",
      position: "relative",
    },
    loadingOverlay: {
      position: "absolute",
      inset: 0,
      zIndex: 2,
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      paddingTop: "12px",
      pointerEvents: "none",
      backgroundColor:
        "color-mix(in srgb, var(--colorNeutralBackground1) 35%, transparent)",
    },
    eventLogSection: {
      flexShrink: 0,
      height: "200px",
      overflow: "hidden",
    },
  });

  const styles = useStyles();

  useEffect(() => {
    const initialize = async () => {
      const requestId = ++connectionRequestRef.current;
      // Filters belong to the active Dataverse connection and must not leak
      // into a newly selected environment.
      setSelectedPublishers([]);
      setSelectedSolutionIds([]);
      setTextFilter("");
      setEntities([]);
      setSolutions([]);

      if (!connection) {
        return;
      }
      await querySolutions(requestId);
      if (requestId !== connectionRequestRef.current) {
        return;
      }
      // Load all views in background (non-blocking)
      loadAllViews()
        .then((views) => {
          viewsByEntityRef.current = views;
          setEntities((currentEntities) =>
            currentEntities.map((entity) => ({
              ...entity,
              views: views.get(entity.logicalname) || [],
            })),
          );
          logger.info(`Loaded views for ${views.size} entities in background`);
        })
        .catch((error) => {
          logger.error(
            `Error loading views in background: ${(error as Error).message}`,
          );
        });
    };

    initialize();
  }, [connection]);

  const showNotification = useCallback(
    async (
      title: string,
      body: string,
      type: "success" | "info" | "warning" | "error",
    ) => {
      try {
        await window.toolboxAPI.utils.showNotification({
          title,
          body,
          type,
          duration: 3000,
        });
      } catch (error) {
        console.error("Error showing notification:", error);
      }
    },
    [],
  );

  const querySolutions = useCallback(
    async (requestId?: number) => {
      try {
        setIsLoadingSolutions(true);
        const loadedSolutions = await loadSolutions();
        if (
          requestId !== undefined &&
          requestId !== connectionRequestRef.current
        ) {
          return;
        }
        setSolutions(loadedSolutions);
        logger.info(`Fetched ${loadedSolutions.length} solutions`);

        // MCP/windowed invocations can prefill a solution selector. If the
        // selector is ambiguous or unknown, leave it unset so the user can pick
        // the intended solution from the loaded list.
        const launchContext =
          await window.toolboxAPI.invocation.getLaunchContext();
        const hasSolutionSelector =
          launchContext &&
          [
            "solutionId",
            "solutionName",
            "solutionUniqueName",
            "publisher",
          ].some(
            (key) =>
              typeof launchContext[key] === "string" && launchContext[key],
          );
        if (hasSolutionSelector) {
          const resolution = resolveSolution(loadedSolutions, {
            solutionId:
              typeof launchContext.solutionId === "string"
                ? launchContext.solutionId
                : undefined,
            solutionName:
              typeof launchContext.solutionName === "string"
                ? launchContext.solutionName
                : undefined,
            solutionUniqueName:
              typeof launchContext.solutionUniqueName === "string"
                ? launchContext.solutionUniqueName
                : undefined,
            publisher:
              typeof launchContext.publisher === "string"
                ? launchContext.publisher
                : undefined,
          });
          if (resolution.status === "resolved") {
            setSelectedSolutionIds([resolution.solution.solutionid]);
          } else if (resolution.solutions.length === 0) {
            await showNotification(
              "Solution selection required",
              "The requested solution was not found. Please select a solution.",
              "warning",
            );
          } else if (resolution.solutions.length > 1) {
            await showNotification(
              "Solution selection required",
              "More than one solution matches the request. Please select one.",
              "warning",
            );
          }
        }
      } catch (error) {
        logger.error(`Error querying solutions: ${(error as Error).message}`);
        await showNotification(
          "Error",
          `Failed to load solutions: ${(error as Error).message}`,
          "error",
        );
      } finally {
        setIsLoadingSolutions(false);
      }
    },
    [showNotification],
  );

  const queryEntities = useCallback(async () => {
    const requestId = ++entityRequestRef.current;
    const solutionIdsAtRequest = selectedSolutionIds.length
      ? selectedSolutionIds
      : selectedPublishers.length
        ? publisherSolutions.map((solution) => solution.solutionid)
        : undefined;
    logger.info(
      `Starting entity request ${requestId} for solutions ${solutionIdsAtRequest?.join(", ") || "All"}`,
    );

    try {
      setIsLoadingEntities(true);
      const loadedEntities = await loadEntities(solutionIdsAtRequest);
      logger.info(
        `Entity request ${requestId} returned ${loadedEntities.length} rows for selected filters`,
      );

      // Ignore responses from an earlier selection if the user changed the
      // solution while its metadata was still loading.
      if (requestId !== entityRequestRef.current) {
        return;
      }

      const nonBlacklistedEntities = loadedEntities.filter(
        (entity) =>
          entity.logicalname.length > 0 &&
          entity.entitysetname.length > 0 &&
          !isEntityBlacklisted(entity.logicalname),
      );
      const blacklistedCount =
        loadedEntities.length - nonBlacklistedEntities.length;
      if (blacklistedCount > 0) {
        logger.info(
          `Ignored ${blacklistedCount} blacklisted entities while loading`,
        );
      }

      // Assign views to each entity from cached views
      const entitiesWithViews = nonBlacklistedEntities.map((entity) => {
        const views = viewsByEntityRef.current.get(entity.logicalname) || [];
        return { ...entity, views };
      });

      logger.info(
        `Entity request ${requestId} prepared ${entitiesWithViews.length} rows; first rows: ${entitiesWithViews
          .slice(0, 5)
          .map((entity) => `${entity.logicalname}/${entity.entitysetname}`)
          .join(", ")}`,
      );

      setEntities(entitiesWithViews);
      logger.info(`Fetched ${entitiesWithViews.length} entities with views`);
    } catch (error) {
      if (requestId !== entityRequestRef.current) {
        return;
      }
      logger.error(`Error querying entities: ${(error as Error).message}`);
      await showNotification(
        "Error",
        `Failed to load entities: ${(error as Error).message}`,
        "error",
      );
    } finally {
      if (requestId === entityRequestRef.current) {
        setIsLoadingEntities(false);
      }
    }
  }, [
    publisherSolutions,
    selectedPublishers,
    selectedSolutionIds,
    showNotification,
  ]);

  useEffect(() => {
    // Reload entities when the connection or solution filter changes.
    if (connection) {
      queryEntities();
    }
  }, [connection, queryEntities]);

  const filteredEntities = React.useMemo(() => {
    if (!textFilter) {
      return entities;
    }
    const searchTerm = textFilter.toLowerCase();
    return entities.filter((entity) => {
      return (
        entity.displayname?.toLowerCase().includes(searchTerm) ||
        entity.logicalname?.toLowerCase().includes(searchTerm)
      );
    });
  }, [entities, textFilter]);

  const sortedEntities = React.useMemo(() => {
    const sorted = [...filteredEntities].sort((a, b) => {
      let compareResult = 0;

      switch (sortState.sortColumn) {
        case "logicalname":
          compareResult = a.logicalname.localeCompare(b.logicalname);
          break;
        case "recordCount": {
          const aCount = a.recordCount ?? -1;
          const bCount = b.recordCount ?? -1;
          compareResult = aCount - bCount;
          break;
        }
        case "views":
          compareResult = 0;
          break;
        case "displayname":
        default:
          compareResult = a.displayname.localeCompare(b.displayname);
          break;
      }

      return sortState.sortDirection === "descending"
        ? -compareResult
        : compareResult;
    });

    return sorted;
  }, [filteredEntities, sortState]);

  const getSelectedViewName = useCallback((entity: Entity) => {
    const selectedView = entity.views?.find(
      (view) => view.savedqueryid === entity.selectedViewId,
    );
    return selectedView?.name || "All";
  }, []);

  const getRecordCountDisplay = useCallback((entity: Entity) => {
    if (entity.isLoading) {
      return "Progressing...";
    }
    return entity.recordCount !== undefined
      ? entity.recordCount.toString()
      : "-";
  }, []);

  const getExportRows = useCallback(() => {
    return sortedEntities.map((entity) => ({
      displayName: entity.displayname,
      logicalName: entity.logicalname,
      view: getSelectedViewName(entity),
      recordCount: getRecordCountDisplay(entity),
    }));
  }, [getRecordCountDisplay, getSelectedViewName, sortedEntities]);

  const escapeCsvValue = useCallback((value: string) => {
    if (/[",\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }, []);

  const buildCsvContent = useCallback(() => {
    const rows = getExportRows();
    const header = ["Display Name", "Logical Name", "View", "Record Count"];
    const csvRows = rows.map((row) =>
      [row.displayName, row.logicalName, row.view, row.recordCount]
        .map((value) => escapeCsvValue(value))
        .join(","),
    );
    return [header.join(","), ...csvRows].join("\n");
  }, [escapeCsvValue, getExportRows]);

  const escapeMarkdownValue = useCallback((value: string) => {
    return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  }, []);

  const buildMarkdownContent = useCallback(() => {
    const rows = getExportRows();
    const lines = [
      "| Display Name | Logical Name | View | Record Count |",
      "| --- | --- | --- | ---: |",
      ...rows.map(
        (row) =>
          `| ${escapeMarkdownValue(row.displayName)} | ${escapeMarkdownValue(row.logicalName)} | ${escapeMarkdownValue(row.view)} | ${escapeMarkdownValue(row.recordCount)} |`,
      ),
    ];
    return lines.join("\n");
  }, [escapeMarkdownValue, getExportRows]);

  const copyToClipboard = useCallback(
    async (content: string, format: "Markdown" | "CSV") => {
      try {
        await navigator.clipboard.writeText(content);
        logger.info(`${format} copied to clipboard`);
        await showNotification(
          `${format} Copied`,
          `Copied ${sortedEntities.length} rows to the clipboard.`,
          "success",
        );
      } catch (error) {
        logger.error(
          `Error copying ${format.toLowerCase()}: ${(error as Error).message}`,
        );
        await showNotification(
          "Error",
          `Failed to copy ${format.toLowerCase()}: ${(error as Error).message}`,
          "error",
        );
      }
    },
    [showNotification, sortedEntities.length],
  );

  const handleExportCsv = useCallback(async () => {
    try {
      const csvContent = buildCsvContent();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = await window.toolboxAPI.fileSystem.saveFile(
        `customer-journey-explorer-${timestamp}.csv`,
        csvContent,
        [{ name: "CSV", extensions: ["csv"] }],
      );

      if (!filePath) {
        logger.info("CSV export canceled by user");
        return;
      }

      logger.info(`Exported ${sortedEntities.length} rows to CSV: ${filePath}`);
      await showNotification(
        "CSV Exported",
        `Exported ${sortedEntities.length} rows to a CSV file.`,
        "success",
      );
    } catch (error) {
      logger.error(`Error exporting CSV: ${(error as Error).message}`);
      await showNotification(
        "Error",
        `Failed to export CSV: ${(error as Error).message}`,
        "error",
      );
    }
  }, [buildCsvContent, showNotification, sortedEntities.length]);

  const handleCopyMarkdown = useCallback(async () => {
    await copyToClipboard(buildMarkdownContent(), "Markdown");
  }, [buildMarkdownContent, copyToClipboard]);

  const handleCopyCsv = useCallback(async () => {
    await copyToClipboard(buildCsvContent(), "CSV");
  }, [buildCsvContent, copyToClipboard]);

  const handleCountRecords = useCallback(async () => {
    try {
      setIsCountingRecords(true);
      logger.info("Starting record count for all entities...");

      // Filter entities based on current text filter
      const entitiesToCount = filteredEntities.filter(
        (entity) => !isEntityBlacklisted(entity.logicalname),
      );
      const blacklistedCount = filteredEntities.length - entitiesToCount.length;
      if (blacklistedCount > 0) {
        logger.info(
          `Skipped ${blacklistedCount} blacklisted entities during counting`,
        );
      }

      if (entitiesToCount.length === 0) {
        await showNotification(
          "Nothing to Count",
          "No countable entities found after applying filters and blacklist.",
          "info",
        );
        return;
      }

      // Set all entities to loading state
      setEntities((prev) =>
        prev.map((entity) => {
          if (
            entitiesToCount.find((e) => e.logicalname === entity.logicalname)
          ) {
            return { ...entity, isLoading: true, recordCount: undefined };
          }
          return entity;
        }),
      );

      // Separate entities with views from those without
      const entitiesWithViews = entitiesToCount.filter((entity) => {
        const selectedView = entity.views?.find(
          (v) => v.savedqueryid === entity.selectedViewId,
        );
        return selectedView?.fetchxml;
      });

      const entitiesWithoutViews = entitiesToCount.filter((entity) => {
        const selectedView = entity.views?.find(
          (v) => v.savedqueryid === entity.selectedViewId,
        );
        return !selectedView?.fetchxml;
      });

      // Batch count entities without views using RetrieveTotalRecordCount
      if (entitiesWithoutViews.length > 0) {
        logger.info(
          `Batch counting ${entitiesWithoutViews.length} entities without views`,
        );
        try {
          const entityNames = entitiesWithoutViews.map((e) => e.logicalname);
          const counts = await countRecordsBatch(entityNames);
          setEntities((prev) =>
            prev.map((e) =>
              Object.prototype.hasOwnProperty.call(counts, e.logicalname)
                ? { ...e, recordCount: counts[e.logicalname], isLoading: false }
                : e,
            ),
          );
          logger.info(
            `Batch count completed for ${entitiesWithoutViews.length} entities`,
          );
        } catch (error) {
          logger.error(`Error in batch counting: ${(error as Error).message}`);
          setEntities((prev) =>
            prev.map((e) =>
              entitiesWithoutViews.some(
                (entity) => entity.logicalname === e.logicalname,
              )
                ? { ...e, recordCount: 0, isLoading: false }
                : e,
            ),
          );
          await showNotification(
            "Error",
            `Failed to count records: ${(error as Error).message}`,
            "error",
          );
          return;
        }
      }

      // Count entities with views individually using FetchXML
      for (const entity of entitiesWithViews) {
        try {
          // Get FetchXML if a view is selected
          const selectedView = entity.views?.find(
            (v) => v.savedqueryid === entity.selectedViewId,
          );
          const fetchXml = selectedView?.fetchxml;

          const count = await countRecords(
            entity.entitysetname,
            entity.logicalname,
            fetchXml,
          );
          setEntities((prev) =>
            prev.map((e) =>
              e.logicalname === entity.logicalname
                ? { ...e, recordCount: count, isLoading: false }
                : e,
            ),
          );
          const viewMsg = selectedView ? ` (view: ${selectedView.name})` : "";
          logger.info(
            `Counted ${count} records for ${entity.logicalname}${viewMsg}`,
          );
          await showNotification(
            "Record Count Complete",
            `Successfully counted records for ${entitiesToCount.length} entities`,
            "success",
          );
          logger.info("Record count completed");
        } catch (error) {
          logger.error(
            `Error counting records for ${entity.logicalname}: ${
              (error as Error).message
            }`,
          );
          setEntities((prev) =>
            prev.map((e) =>
              e.logicalname === entity.logicalname
                ? { ...e, recordCount: 0, isLoading: false }
                : e,
            ),
          );
          logger.error(`Error counting records: ${(error as Error).message}`);
          await showNotification(
            "Error",
            `Failed to count records: ${(error as Error).message}`,
            "error",
          );
        }
      }
    } finally {
      setIsCountingRecords(false);
    }
  }, [filteredEntities, showNotification]);

  const handleViewChange = useCallback(
    (entityLogicalName: string, viewId: string | undefined) => {
      logger.info(
        `View changed for ${entityLogicalName} to: ${viewId || "All"}`,
      );
      setEntities((prev) =>
        prev.map((entity) =>
          entity.logicalname === entityLogicalName
            ? { ...entity, selectedViewId: viewId, recordCount: undefined }
            : entity,
        ),
      );
    },
    [],
  );

  return (
    <div className={styles.overviewRoot}>
      {isLoadingSolutions ? (
        <div className={styles.loadingContainer}>
          <Spinner
            label={
              isLoadingSolutions
                ? "Loading solutions..."
                : "Loading entities..."
            }
          />
        </div>
      ) : (
        <>
          <div className={styles.filterSection}>
            <Filter
              solutions={publisherSolutions}
              publishers={publishers}
              selectedPublishers={selectedPublishers}
              selectedSolutionIds={selectedSolutionIds}
              textFilter={textFilter}
              onPublisherFilterChanged={(publishers) => {
                setSelectedPublishers(publishers);
                const availableSolutionIds = new Set(
                  solutions
                    .filter(
                      (solution) =>
                        !publishers.length ||
                        (solution.publisherName &&
                          publishers.includes(solution.publisherName)),
                    )
                    .map((solution) => solution.solutionid),
                );
                setSelectedSolutionIds((currentIds) =>
                  currentIds.filter((solutionId) =>
                    availableSolutionIds.has(solutionId),
                  ),
                );
              }}
              onSolutionFilterChanged={(solutionIds: string[]) => {
                logger.info(
                  `Solution filter changed to: ${solutionIds.join(", ") || "All"}`,
                );
                setSelectedSolutionIds(solutionIds);
              }}
              onTextFilterChanged={(searchText: string) => {
                setTextFilter(searchText);
              }}
              onCountRecords={handleCountRecords}
              onExportCsv={handleExportCsv}
              onCopyMarkdown={handleCopyMarkdown}
              onCopyCsv={handleCopyCsv}
              isCountingRecords={isCountingRecords}
              hasEntities={filteredEntities.length > 0}
            />
          </div>

          {entities.length > 0 && (
            <div className={styles.dataGridSection}>
              {isLoadingEntities && (
                <div className={styles.loadingOverlay}>
                  <Spinner size="tiny" label="Updating entities..." />
                </div>
              )}
              <EntityGridErrorBoundary rowCount={sortedEntities.length}>
                <EntitiesDataGrid
                  items={sortedEntities}
                  onViewChange={handleViewChange}
                  sortState={sortState}
                  onSortChange={(
                    _event: Parameters<
                      NonNullable<DataGridProps["onSortChange"]>
                    >[0],
                    nextSortState: Parameters<
                      NonNullable<DataGridProps["onSortChange"]>
                    >[1],
                  ) => setSortState(nextSortState)}
                />
              </EntityGridErrorBoundary>
            </div>
          )}

          {/* <div className={styles.eventLogSection}>
            <EventLog />
          </div> */}
        </>
      )}
    </div>
  );
};
