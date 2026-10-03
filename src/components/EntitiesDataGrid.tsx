import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridRow,
  Dropdown,
  Option,
  Spinner,
  createTableColumn,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type {
  DataGridProps,
  JSXElement,
  OptionOnSelectData,
  SelectionEvents,
  TableColumnDefinition,
} from "@fluentui/react-components";
import { Entity } from "../types/entity";
import { logger } from "../services/loggerService";
import { useState } from "react";

const useStyles = makeStyles({
  scrollWrapper: {
    height: "auto",
    display: "flex",
    flexDirection: "column",
    overflow: "visible",
    minWidth: "max-content",
  },
  gridContainer: {
    height: "auto",
    width: "max-content",
    minWidth: "max-content",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  gridBody: {
    overflow: "visible",
    flex: "none",
  },
  stickyHeader: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cellStyles: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  },
  cellStylesRight: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
    textAlign: "right",
  },
  viewDropdown: {
    width: "100%",
    minHeight: "32px",
    padding: "0 8px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    fontSize: "inherit",
  },
});

export interface IEntitiesDataGridProps {
  items: Entity[];
  onViewChange: (entityLogicalName: string, viewId: string | undefined) => void;
  sortState: Parameters<NonNullable<DataGridProps["onSortChange"]>>[1];
  onSortChange: NonNullable<DataGridProps["onSortChange"]>;
}

export const EntitiesDataGrid = (props: IEntitiesDataGridProps): JSXElement => {
  const styles = useStyles();
  const [openViewEntity, setOpenViewEntity] = useState<string | undefined>();
  logger.info(
    `Rendering entity grid: ${props.items.length} rows (${props.items.filter((item) => !item.logicalname || !item.displayname).length} malformed)`,
  );

  const columns: TableColumnDefinition<Entity>[] = [
    createTableColumn<Entity>({
      columnId: "displayname",
      compare: (a, b) => a.displayname.localeCompare(b.displayname),
      renderHeaderCell: () => "Display Name",
      renderCell: (item) => (
        <span title={item.displayname} className={styles.cellStyles}>
          {item.displayname}
        </span>
      ),
    }),
    createTableColumn<Entity>({
      columnId: "logicalname",
      compare: (a, b) => a.logicalname.localeCompare(b.logicalname),
      renderHeaderCell: () => "Logical Name",
      renderCell: (item) => (
        <span title={item.logicalname} className={styles.cellStyles}>
          {item.logicalname}
        </span>
      ),
    }),
    createTableColumn<Entity>({
      columnId: "views",
      compare: () => 0,
      renderHeaderCell: () => "View",
      renderCell: (item) => {
        const allValue = "All";
        const selectedView = item.views?.find(
          (view) => view.savedqueryid === item.selectedViewId,
        );
        const handleViewChange = (
          _event: SelectionEvents,
          data: OptionOnSelectData,
        ) => {
          props.onViewChange(
            item.logicalname,
            data.optionValue === allValue ? undefined : data.optionValue,
          );
        };

        return (
          <Dropdown
            value={selectedView?.name || allValue}
            selectedOptions={[item.selectedViewId || allValue]}
            onOpenChange={(_event, data) => {
              setOpenViewEntity(data.open ? item.logicalname : undefined);
            }}
            onOptionSelect={handleViewChange}
            className={styles.viewDropdown}
            size="medium"
          >
            <Option value={allValue}>All</Option>
            {openViewEntity === item.logicalname &&
              item.views?.map((view) => (
                <Option key={view.savedqueryid} value={view.savedqueryid}>
                  {view.name || view.savedqueryid}
                </Option>
              ))}
          </Dropdown>
        );
      },
    }),
    createTableColumn<Entity>({
      columnId: "recordCount",
      compare: (a, b) => (a.recordCount ?? -1) - (b.recordCount ?? -1),
      renderHeaderCell: () => <div style={{ textAlign: "right" }}>Record Count</div>,
      renderCell: (item) =>
        item.isLoading ? (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <Spinner size="tiny" />
            <span>Progressing...</span>
          </div>
        ) : (
          <div style={{ textAlign: "right" }}>
            {item.recordCount !== undefined ? item.recordCount.toLocaleString() : "-"}
          </div>
        ),
    }),
  ];

  const columnSizingOptions = {
    displayname: { minWidth: 300, defaultWidth: 300 },
    logicalname: { minWidth: 300, defaultWidth: 300 },
    views: { minWidth: 450, defaultWidth: 450 },
  };

  return (
    <div className={styles.scrollWrapper}>
      <DataGrid
        items={props.items}
        columns={columns}
        sortable
        sortState={props.sortState}
        onSortChange={props.onSortChange}
        getRowId={(item) => item.logicalname}
        className={styles.gridContainer}
        resizableColumns
        columnSizingOptions={columnSizingOptions}
      >
        <DataGridHeader className={styles.stickyHeader}>
          <DataGridRow>
            {({ renderHeaderCell }) => (
              <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
            )}
          </DataGridRow>
        </DataGridHeader>
        <DataGridBody<Entity> className={styles.gridBody}>
          {({ item, rowId }) => (
            <DataGridRow<Entity> key={rowId}>
              {({ renderCell }) => (
                <DataGridCell>{renderCell(item)}</DataGridCell>
              )}
            </DataGridRow>
          )}
        </DataGridBody>
      </DataGrid>
    </div>
  );
};
