import React from "react";
import { Button, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { logger } from "../services/loggerService";

type Props = {
  children: React.ReactNode;
  rowCount: number;
};

type State = {
  error: Error | null;
};

export class EntityGridErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error(
      `Entity grid render failed for ${this.props.rowCount} rows: ${error.message}. Component stack: ${info.componentStack}`,
    );
  }

  render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <MessageBar intent="error">
        <MessageBarBody>
          Entity list could not be rendered: {this.state.error.message}
          <Button
            appearance="secondary"
            size="small"
            onClick={() => this.setState({ error: null })}
          >
            Retry rendering
          </Button>
        </MessageBarBody>
      </MessageBar>
    );
  }
}
