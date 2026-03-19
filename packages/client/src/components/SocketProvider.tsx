"use client";

import { useEffect } from "react";
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

  // Load base state on mount
  useEffect(() => {
    api.getTerminals().then(({ terminals }) => setAgents(terminals)).catch(reportLoadError);
    api.getProjects()
      .then(({ projects }) => setProjects(projects))
      .catch(reportLoadError);
  }, [setAgents, setProjects]);

  // Listen for real-time status updates
  useEffect(() => {
    const socket = getSocket();

    const handleStatus = (data: {
      terminalId: string;
      status: string;
      error?: string | null;
    }) => {
      updateAgent(data.terminalId, {
        status: data.status,
        error: data.error ?? null,
      });
    };

    socket.on("terminal:status", handleStatus);
    return () => {
      socket.off("terminal:status", handleStatus);
    };
  }, [updateAgent]);

  return <>{children}</>;
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SocketCore>{children}</SocketCore>
    </AuthGuard>
  );
}
