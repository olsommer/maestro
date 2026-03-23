import type {
  DeploymentRedeployResponse,
  DeploymentUpdateStatus,
} from "@maestro/wire";

function getUpdaterConfig():
  | {
      url: string;
      token: string | null;
    }
  | null {
  const url = process.env.UPDATER_URL?.trim();
  if (!url) {
    return null;
  }

  return {
    url: url.replace(/\/+$/g, ""),
    token: process.env.UPDATER_TOKEN?.trim() || null,
  };
}

function getDisabledStatus(message?: string): DeploymentUpdateStatus {
  return {
    configured: false,
    currentVersion: null,
    latestVersion: null,
    updateAvailable: false,
    updating: false,
    lastCheckedAt: null,
    lastUpdatedAt: null,
    lastError: message ?? null,
    latestRelease: null,
  };
}

async function requestUpdater<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const config = getUpdaterConfig();
  if (!config) {
    throw new Error("Deployment updater is not configured");
  }

  const res = await fetch(`${config.url}${path}`, {
    ...init,
    headers: {
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(init?.timeoutMs ?? 15_000),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : `Updater request failed (${res.status})`
    );
  }

  return body as T;
}

export async function getDeploymentUpdateStatus(): Promise<DeploymentUpdateStatus> {
  const config = getUpdaterConfig();
  if (!config) {
    return getDisabledStatus(
      "Set UPDATER_URL on the Maestro server to enable release redeploys."
    );
  }

  try {
    return await requestUpdater<DeploymentUpdateStatus>("/status");
  } catch (error) {
    return {
      configured: true,
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      updating: false,
      lastCheckedAt: null,
      lastUpdatedAt: null,
      lastError:
        error instanceof Error ? error.message : "Failed to reach the deployment updater",
      latestRelease: null,
    };
  }
}

export async function checkDeploymentUpdateStatus(): Promise<DeploymentUpdateStatus> {
  const config = getUpdaterConfig();
  if (!config) {
    return getDisabledStatus(
      "Set UPDATER_URL on the Maestro server to enable release redeploys."
    );
  }

  return requestUpdater<DeploymentUpdateStatus>("/check", {
    method: "POST",
  });
}

export async function triggerDeploymentRedeploy(
  tag?: string
): Promise<DeploymentRedeployResponse> {
  return requestUpdater<DeploymentRedeployResponse>("/redeploy", {
    method: "POST",
    body: JSON.stringify(tag ? { tag } : {}),
    timeoutMs: 30_000,
  });
}
