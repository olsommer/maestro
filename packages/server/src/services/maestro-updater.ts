import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type {
  MaestroUpdateStatus,
  MaestroUpdateTriggerResponse,
  MaestroInstallMode,
} from "@maestro/wire";
import { readJsonFile, writeJsonFile } from "../state/files.js";

interface MaestroPackageMeta {
  name: string;
  version: string;
}

interface MaestroUpdateState {
  updating: boolean;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  latestVersion: string | null;
  lastError: string | null;
}

const UPDATE_STATE_PATH = path.join(os.homedir(), ".maestro", "maestro-update-state.json");
const LOG_PATH = path.join(os.homedir(), ".maestro", "server.log");
const DEFAULT_STATE: MaestroUpdateState = {
  updating: false,
  lastCheckedAt: null,
  lastUpdatedAt: null,
  latestVersion: null,
  lastError: null,
};

function readState(): MaestroUpdateState {
  return readJsonFile<MaestroUpdateState>(UPDATE_STATE_PATH, DEFAULT_STATE);
}

function writeState(patch: Partial<MaestroUpdateState>): MaestroUpdateState {
  const next = { ...readState(), ...patch };
  writeJsonFile(UPDATE_STATE_PATH, next, { mode: 0o600 });
  return next;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getInstallRoot(): string | null {
  const raw = process.env.MAESTRO_INSTALL_ROOT;
  if (!raw) return null;
  const resolved = path.resolve(raw);
  return fs.existsSync(path.join(resolved, "package.json")) ? resolved : null;
}

function isContainerManagedInstall(): boolean {
  return fs.existsSync("/.dockerenv") || Boolean(process.env.KUBERNETES_SERVICE_HOST);
}

function getNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function readPackageMeta(installRoot: string): MaestroPackageMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8")) as MaestroPackageMeta;
  } catch {
    return null;
  }
}

function getGlobalNpmRoot(npmCommand: string): string | null {
  try {
    return execFileSync(npmCommand, ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function detectInstallMode(): { installMode: MaestroInstallMode; installRoot: string | null; meta: MaestroPackageMeta | null } {
  if (isContainerManagedInstall()) {
    return { installMode: "container", installRoot: null, meta: null };
  }

  const installRoot = getInstallRoot();
  const meta = installRoot ? readPackageMeta(installRoot) : null;
  if (!installRoot || !meta) {
    return { installMode: "unknown", installRoot: null, meta: null };
  }

  const globalRoot = getGlobalNpmRoot(getNpmCommand());
  if (!globalRoot) {
    return { installMode: "unknown", installRoot, meta };
  }

  const expectedRoot = path.resolve(globalRoot, meta.name);
  if (path.resolve(installRoot) !== expectedRoot) {
    return { installMode: "unknown", installRoot, meta };
  }

  return { installMode: "npm", installRoot, meta };
}

function getLatestVersion(packageName: string): string | null {
  try {
    return execFileSync(getNpmCommand(), ["view", `${packageName}@latest`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
    }).trim() || null;
  } catch {
    return null;
  }
}

export async function checkForMaestroUpdates(): Promise<MaestroUpdateStatus> {
  const install = detectInstallMode();
  if (install.installMode !== "npm" || !install.meta) {
    const state = writeState({
      updating: false,
      lastCheckedAt: nowIso(),
      lastError:
        install.installMode === "container"
          ? "Maestro is container-managed. Redeploy the image instead of using self-update."
          : "Maestro self-update is only available for the published global npm install.",
    });
    return {
      supported: false,
      installMode: install.installMode,
      currentVersion: install.meta?.version ?? null,
      latestVersion: state.latestVersion,
      updateAvailable: false,
      updating: false,
      lastCheckedAt: state.lastCheckedAt,
      lastUpdatedAt: state.lastUpdatedAt,
      lastError: state.lastError,
    };
  }

  const latestVersion = getLatestVersion(install.meta.name);
  const state = writeState({
    lastCheckedAt: nowIso(),
    latestVersion,
    lastError: latestVersion ? null : `Failed to query the latest published version for ${install.meta.name}.`,
  });

  return {
    supported: true,
    installMode: "npm",
    currentVersion: install.meta.version,
    latestVersion: state.latestVersion,
    updateAvailable:
      state.latestVersion !== null && state.latestVersion !== install.meta.version,
    updating: state.updating,
    lastCheckedAt: state.lastCheckedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    lastError: state.lastError,
  };
}

export function getMaestroUpdateStatus(): MaestroUpdateStatus {
  const install = detectInstallMode();
  let state = readState();
  const currentVersion = install.meta?.version ?? null;

  if (
    state.updating &&
    install.installMode === "npm" &&
    currentVersion !== null &&
    state.latestVersion !== null &&
    currentVersion === state.latestVersion
  ) {
    state = writeState({
      updating: false,
      lastUpdatedAt: state.lastUpdatedAt ?? nowIso(),
      lastError: null,
    });
  }

  return {
    supported: install.installMode === "npm",
    installMode: install.installMode,
    currentVersion,
    latestVersion: state.latestVersion,
    updateAvailable:
      install.installMode === "npm" &&
      currentVersion !== null &&
      state.latestVersion !== null &&
      currentVersion !== state.latestVersion,
    updating: state.updating,
    lastCheckedAt: state.lastCheckedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    lastError: state.lastError,
  };
}

export async function triggerMaestroUpdate(): Promise<MaestroUpdateTriggerResponse> {
  const status = await checkForMaestroUpdates();
  if (!status.supported) {
    return {
      accepted: false,
      message:
        status.lastError ??
        "Maestro self-update is only available for the published global npm install.",
      targetVersion: null,
    };
  }

  if (status.updating) {
    return {
      accepted: false,
      message: "Maestro update already in progress.",
      targetVersion: status.latestVersion,
    };
  }

  if (!status.updateAvailable || !status.latestVersion) {
    return {
      accepted: false,
      message: "Maestro is already up to date.",
      targetVersion: status.currentVersion,
    };
  }

  const installRoot = getInstallRoot();
  if (!installRoot) {
    return {
      accepted: false,
      message: "Failed to locate the installed Maestro CLI root.",
      targetVersion: null,
    };
  }

  const cliEntry = path.join(installRoot, "dist", "index.js");
  if (!fs.existsSync(cliEntry)) {
    return {
      accepted: false,
      message: `Maestro CLI entrypoint not found at ${cliEntry}.`,
      targetVersion: null,
    };
  }

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const out = fs.openSync(LOG_PATH, "a");
  writeState({
    updating: true,
    lastUpdatedAt: nowIso(),
    lastError: null,
  });

  const child = spawn(process.execPath, [cliEntry, "update"], {
    detached: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      MAESTRO_SELF_UPDATE_DELAY_MS: "1000",
    },
  });
  child.unref();

  return {
    accepted: true,
    message: `Started Maestro update to ${status.latestVersion}. The server connection will drop briefly while it restarts.`,
    targetVersion: status.latestVersion,
  };
}
