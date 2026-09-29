import type {
  JSXElement,
  OptionOnSelectData,
  SelectionEvents,
} from "@fluentui/react-components";
import {
  makeStyles,
  useId,
  SearchBox,
  SearchBoxChangeEvent,
  Button,
  Dropdown,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  CopyRegular,
  DocumentTableRegular,
  PlayRegular,
} from "@fluentui/react-icons";
import { Solution } from "../types/solution";
import { useRef, useState } from "react";

export interface IFilterProps {
  solutions: Solution[];
  publishers: string[];
  selectedPublishers: string[];
  selectedSolutionIds: string[];
  textFilter: string;
  onPublisherFilterChanged: (publishers: string[]) => void;
  onSolutionFilterChanged: (solutionIds: string[]) => void;
  onTextFilterChanged: (searchText: string) => void;
  onCountRecords: () => void;
  onExportCsv: () => void;
  onCopyMarkdown: () => void;
  onCopyCsv: () => void;
  isCountingRecords: boolean;
  hasEntities: boolean;
}

export const Filter = (props: IFilterProps): JSXElement => {
  const solutionDropdownId = useId("solution-dropdown");
  const publisherDropdownId = useId("publisher-dropdown");
  const searchInputId = useId("search-input");
  const [isPublisherOpen, setIsPublisherOpen] = useState(false);
  const [isSolutionOpen, setIsSolutionOpen] = useState(false);
  const optionSelectedRef = useRef<"publisher" | "solution" | undefined>();

  const getSolutionDisplayLabel = (solution: Solution) => {
    return solution.version
      ? `${solution.friendlyname} (${solution.version})`
      : solution.friendlyname;
  };

  const onSolutionSelect = (
    _event: SelectionEvents,
    data: OptionOnSelectData,
  ) => {
    props.onSolutionFilterChanged(data.selectedOptions);
    optionSelectedRef.current = "solution";
  };

  const onTextFilterChange = (
    _event: SearchBoxChangeEvent,
    data: { value: string },
  ) => {
    props.onTextFilterChanged(data.value);
  };

  const useStyles = makeStyles({
    root: {
      display: "flex",
      gap: "12px",
      alignItems: "flex-end",
      flexWrap: "wrap",
      minWidth: 0,
      width: "100%",
    },
    growSection: {
      display: "flex",
      gap: "12px",
      alignItems: "flex-end",
      flexWrap: "wrap",
      flex: "1 1 auto",
      minWidth: 0,
      width: "auto",
    },
    field: {
      display: "grid",
      justifyItems: "start",
      gap: "2px",
    },
    solutionField: {
      flex: "0 0 300px",
      minWidth: 0,
    },
    publisherField: {
      flex: "0 0 240px",
      minWidth: 0,
    },
    dropdown: {
      width: "100%",
      minWidth: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    dropdownListbox: {
      width: "520px",
      minWidth: "520px",
      maxWidth: "calc(100vw - 24px)",
    },
    optionLabel: {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      display: "block",
    },
    searchInput: {
      width: "min(420px, 100%)",
      minWidth: 0,
    },
    searchSection: {
      display: "flex",
      gap: "12px",
      alignItems: "flex-end",
      flexWrap: "wrap",
      minWidth: 0,
    },
    actions: {
      display: "flex",
      gap: "8px",
      alignItems: "center",
      marginLeft: "auto",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      minWidth: 0,
      flex: "0 0 auto",
    },
    countButton: {
      flex: "0 1 auto",
    },
    "@media (max-width: 900px)": {
      root: {
        flexDirection: "column",
        alignItems: "stretch",
      },
      growSection: {
        flexBasis: "100%",
        width: "100%",
      },
      solutionField: {
        flexBasis: "300px",
      },
      publisherField: {
        flexBasis: "240px",
      },
      searchSection: {
        width: "100%",
      },
      actions: {
        marginLeft: 0,
        justifyContent: "flex-start",
        width: "100%",
      },
      dropdown: {
        width: "100%",
      },
      dropdownListbox: {
        width: "calc(100vw - 24px)",
        minWidth: 0,
      },
      searchInput: {
        width: "100%",
      },
    },
    "@media (max-width: 640px)": {
      growSection: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "12px",
      },
      searchSection: {
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        width: "100%",
      },
      field: {
        width: "100%",
      },
      solutionField: {
        flexBasis: "auto",
      },
      publisherField: {
        flexBasis: "auto",
      },
      actions: {
        display: "flex",
        alignItems: "stretch",
        gap: "8px",
        width: "100%",
      },
      countButton: {
        width: "100%",
      },
    },
  });

  const styles = useStyles();

  return (
    <div className={styles.root}>
      <div className={styles.growSection}>
        <div className={`${styles.field} ${styles.publisherField}`}>
          <label htmlFor={publisherDropdownId}>Publisher</label>
          <Dropdown
            id={publisherDropdownId}
            placeholder="Select a publisher"
            multiselect
            open={isPublisherOpen}
            onOpenChange={(event, data) => {
              if (!data.open && optionSelectedRef.current === "publisher") {
                optionSelectedRef.current = undefined;
                event.preventDefault();
                return;
              }
              setIsPublisherOpen(data.open);
            }}
            value={props.selectedPublishers.join(", ")}
            selectedOptions={props.selectedPublishers}
            onOptionSelect={(_event, data) => {
              props.onPublisherFilterChanged(data.selectedOptions);
              optionSelectedRef.current = "publisher";
            }}
            className={styles.dropdown}
          >
            {props.publishers.map((publisher) => (
              <Option key={publisher} value={publisher} text={publisher}>
                <span className={styles.optionLabel}>{publisher}</span>
              </Option>
            ))}
          </Dropdown>
        </div>
        <div className={`${styles.field} ${styles.solutionField}`}>
          <label htmlFor={solutionDropdownId}>Solution</label>
          <Dropdown
            id={solutionDropdownId}
            placeholder="Select a solution"
            multiselect
            open={isSolutionOpen}
            onOpenChange={(event, data) => {
              if (!data.open && optionSelectedRef.current === "solution") {
                optionSelectedRef.current = undefined;
                event.preventDefault();
                return;
              }
              setIsSolutionOpen(data.open);
            }}
            value={props.selectedSolutionIds
              .map((id) => props.solutions.find((solution) => solution.solutionid === id))
              .filter(Boolean)
              .map((solution) => getSolutionDisplayLabel(solution!))
              .join(", ")}
            selectedOptions={props.selectedSolutionIds}
            onOptionSelect={onSolutionSelect}
            className={styles.dropdown}
            listbox={{ className: styles.dropdownListbox }}
          >
            {props.solutions.map((solution) => {
              const label = getSolutionDisplayLabel(solution);
              return (
                <Option
                  key={solution.solutionid}
                  value={solution.solutionid}
                  text={label}
                >
                  <span className={styles.optionLabel}>{label}</span>
                </Option>
              );
            })}
          </Dropdown>
        </div>
        <div className={styles.searchSection}>
          <div className={styles.field}>
            <label htmlFor={searchInputId}>Filter Entities</label>
            <SearchBox
              id={searchInputId}
              placeholder="Search by display name or logical name..."
              value={props.textFilter}
              onChange={onTextFilterChange}
              className={styles.searchInput}
            />
          </div>
          <Button
            appearance="primary"
            icon={<PlayRegular />}
            onClick={props.onCountRecords}
            disabled={props.isCountingRecords || !props.hasEntities}
            aria-busy={props.isCountingRecords}
            className={styles.countButton}
          >
            {props.isCountingRecords ? "Counting..." : "Count Records"}
          </Button>
        </div>
      </div>
      <div className={styles.actions}>
        <Menu>
          <MenuTrigger>
            <Button
              disabled={!props.hasEntities || props.isCountingRecords}
              aria-label="Export and copy options"
            >
              ...
            </Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<CopyRegular />} onClick={props.onCopyCsv}>
                Copy CSV
              </MenuItem>
              <MenuItem
                icon={<DocumentTableRegular />}
                onClick={props.onCopyMarkdown}
              >
                Copy Markdown
              </MenuItem>
              <MenuItem
                icon={<ArrowDownloadRegular />}
                onClick={props.onExportCsv}
              >
                Export CSV
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
    </div>
  );
};
