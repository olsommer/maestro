"use client";

import { useCallback, useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { AuthGuard } from "./AuthGuard";

function SocketCore({ children }: { children: React.ReactNode }) {
  const setAgents = useStore((s) => s.setAgents);
  const setProjects = useStore((s) => s.setProjects);
  const updateAgent = useStore((s) => s.updateAgent);

  function reportLoadError(err: unknown) {
    if (err instanceof Error && err.message === "Invalid token") {
      return;
    }
    console.error(err);
  }

  const refreshBaseState = useCallback(() => {
    api.getTerminals().then(({ terminals }) => setAgents(terminals)).catch(reportLoadError);
    api.getProjects()
      .then(({ projects }) => setProjects(projects))
      .catch(reportLoadError);
  }, [setAgents, setProjects]);

  // Load base state on mount
  useEffect(() => {
    refreshBaseState();
  }, [refreshBaseState]);

  // Listen for real-time status updates
  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: {
      terminalId: string;
      status: string;
      error?: string | null;
      startupStatus?: import("@maestro/wire").TerminalStartupStatus | null;
      recentInputs?: string[];
    }) => {
      updateAgent(data.terminalId, {
        status: data.status,
        error: data.error ?? null,
        startupStatus: data.startupStatus ?? null,
        ...(data.recentInputs !== undefined ? { recentInputs: data.recentInputs } : {}),
      });
    };

    socket.on("terminal:status", handleStatus);
    return () => {
      socket.off("terminal:status", handleStatus);
    };
  }, [updateAgent]);

  // Restore live updates when the tab returns to the foreground.
  useEffect(() => {
    const socket = getSocket();

    const refreshOnResume = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      if (!socket.connected) {
        socket.connect();
      }
      refreshBaseState();
    };

    socket.on("connect", refreshOnResume);
    document.addEventListener("visibilitychange", refreshOnResume);
    window.addEventListener("focus", refreshOnResume);

    return () => {
      socket.off("connect", refreshOnResume);
      document.removeEventListener("visibilitychange", refreshOnResume);
      window.removeEventListener("focus", refreshOnResume);
    };
  }, [refreshBaseState]);

  return <>{children}</>;
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SocketCore>{children}</SocketCore>
    </AuthGuard>
  );
}
