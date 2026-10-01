import { useCallback, useEffect, useState } from "react";
import { DiscoveryExplorer } from "./components/DiscoveryExplorer";
import toolLogo from "../icon/customer-journey-explorer_logo.png";
import { useConnection } from "./hooks/useConnection";
import { useToolboxEvents } from "./hooks/useToolboxEvents";
import { logger } from "./services/loggerService";
import {
  FluentProvider,
  Theme,
  teamsLightTheme,
  teamsDarkTheme,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  container: {
    backgroundColor: tokens.colorNeutralBackground1,
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    flexShrink: 0,
    minHeight: "76px",
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  logo: {
    width: "52px",
    height: "52px",
    objectFit: "contain",
    flexShrink: 0,
  },
  headerText: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalM,
    minWidth: 0,
    "@media (max-width: 640px)": {
      alignItems: "flex-start",
      flexDirection: "column",
      gap: "0",
    },
  },
  title: {
    margin: 0,
    fontSize: "24px",
    lineHeight: "32px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  subtitle: {
    color: tokens.colorNeutralForeground2,
    fontSize: "14px",
  },
  content: {
    padding: tokens.spacingVerticalL,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },
});

function App() {
  const { connection, isLoading, refreshConnection } = useConnection();
  const [connectionRevision, setConnectionRevision] = useState(0);

  const [theme, setTheme] = useState<Theme>(teamsDarkTheme);
  const styles = useStyles();
  // Handle platform events
  const handleEvent = useCallback(
    async (event: string, _data: any) => {
      console.log(`Received event: ${event}`);
      switch (event) {
        case "connection:updated":
        case "connection:created":
        case "connection:deleted":
          await refreshConnection();
          setConnectionRevision((revision) => revision + 1);
          break;

        case "terminal:output":
        case "terminal:command:completed":
        case "terminal:error":
          // Terminal events handled by dedicated components
          break;
        case "settings:updated":
          // Settings updated, could refresh settings if needed
          updateThemeBasedOnSettings();
          logger.info(`Settings updated`);
          break;
      }
    },
    [refreshConnection],
  );

  async function updateThemeBasedOnSettings() {
    const theme = await window.toolboxAPI.utils.getCurrentTheme();
    if (theme === "dark") {
      setTheme(teamsDarkTheme);
    } else {
      setTheme(teamsLightTheme);
    }
    logger.info(`Theme updated:${theme}`);
  }

  useToolboxEvents(handleEvent);

  // Add initial log (run only once on mount)
  useEffect(() => {
    const initialite = async () => {
      try {
        await updateThemeBasedOnSettings();
        logger.info(`Initialized`);
      } catch (error) {
        logger.error(`Failed to initialize theme: ${(error as Error).message}`);
      }
    };

    initialite();
  }, []);

  return (
    <FluentProvider theme={theme}>
      <div className={styles.container}>
        <header className={styles.header}>
          <img className={styles.logo} src={toolLogo} alt="" />
          <div className={styles.headerText}>
            <h1 className={styles.title}>Customer Journey Explorer</h1>
            <span className={styles.subtitle}>
              Explore Customer Insights - Journeys records and their Dataverse
              dependencies in a read-only tree
            </span>
          </div>
        </header>
        <div className={styles.content}>
          <DiscoveryExplorer
            connection={connection}
            isLoadingConnection={isLoading}
            connectionRevision={connectionRevision}
          />
          {/* <EventLog /> */}
        </div>
      </div>
    </FluentProvider>
  );
}

export default App;
