import { useEffect } from "react";

type ToolboxEventHandler = (event: string, data: unknown) => void;

export function useToolboxEvents(onEvent: ToolboxEventHandler): void {
  useEffect(() => {
    const handler = (_event: unknown, payload: ToolBoxAPI.ToolBoxEventPayload) => {
      onEvent(payload.event, payload.data);
    };

    window.toolboxAPI.events.on(handler);
    return () => window.toolboxAPI.events.off(handler);
  }, [onEvent]);
}
