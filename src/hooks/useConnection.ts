import { useCallback, useEffect, useState } from "react";

export function useConnection() {
  const [connection, setConnection] =
    useState<ToolBoxAPI.Connection | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshConnection = useCallback(async () => {
    setIsLoading(true);
    try {
      const conn = await window.toolboxAPI.connections.getActiveConnection();
      setConnection(conn);
    } catch (error) {
      console.error("Error refreshing connection:", error);
      setConnection(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshConnection();
  }, [refreshConnection]);

  return { connection, isLoading, refreshConnection };
}
