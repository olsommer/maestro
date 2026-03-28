"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { api, type RuntimeStatus } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function GitHubStatusBanner() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const next = await api.getRuntimeStatus();
        if (!cancelled) {
          setStatus(next);
        }
      } catch {
        if (!cancelled) {
          setStatus(null);
        }
      }
    };

    load();
    const handleStatusChanged = () => {
      void load();
    };
    const interval = window.setInterval(load, 30000);
    window.addEventListener("maestro:github-status-changed", handleStatusChanged);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("maestro:github-status-changed", handleStatusChanged);
    };
  }, []);

  if (!status?.github.needsAuthWarning) {
    return null;
  }

  return (
    <div className="border-b px-4 py-3">
      <div className="mx-auto max-w-6xl">
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>GitHub auth missing</AlertTitle>
          <AlertDescription>
            {status.github.warningMessage} Run <code>gh auth login</code> on the host or
            add <code>GITHUB_TOKEN</code> or <code>GH_TOKEN</code> to the server
            environment to enable private issue sync and GitHub automations.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
