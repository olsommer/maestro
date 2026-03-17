import { execSync } from "child_process";
import { getSettings } from "../state/settings.js";
import type { UpdateStatus } from "@maestro/wire";

let checkTimer: ReturnType<typeof setInterval> | null = null;
let updating = false;
let lastCheckAt: string | null = null;
let lastUpdateAt: string | null = null;
let lastError: string | null = null;

let cachedStatus: {
  claude: { current: string | null; latest: string | null };
  codex: { current: string | null; latest: string | null };
  gh: { current: string | null; latest: string | null };
} = {
  claude: { current: null, latest: null },
  codex: { current: null, latest: null },
  gh: { current: null, latest: null },
};

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 60_000 }).trim();
  } catch {
    return "";
  }
}

function getInstalledVersionViaCli(binary: string): string | null {
  const output = run(`${binary} --version 2>/dev/null`);
  if (!output) return null;
  // Extract version number from output like "2.1.72 (Claude Code)" or "codex-cli 0.114.0"
  const match = output.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  return match?.[1] ?? null;
}

function getInstalledVersion(pkg: string, binary: string): string | null {
  // First try the CLI binary directly — works regardless of install method
  const cliVersion = getInstalledVersionViaCli(binary);
  if (cliVersion) return cliVersion;

  // Fallback to npm list for npm-global installs
  const output = run(`npm list -g ${pkg} --depth=0 --json 2>/dev/null`);
  if (!output) return null;
  try {
    const data = JSON.parse(output);
    return data.dependencies?.[pkg]?.version ?? null;
  } catch {
    return null;
  }
}

function getLatestVersion(pkg: string): string | null {
  const output = run(`npm view ${pkg} version 2>/dev/null`);
  return output || null;
}

function getGhLatestVersion(): string | null {
  const output = run(`gh api repos/cli/cli/releases/latest --jq '.tag_name' 2>/dev/null`);
  if (!output) return null;
  const match = output.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  return match?.[1] ?? null;
}

function updatePackage(pkg: string, binary: string): { success: boolean; version: string | null; error: string | null } {
  try {
    execSync(`npm install -g ${pkg}@latest`, {
      encoding: "utf8",
      timeout: 120_000,
      stdio: "pipe",
    });
    const newVersion = getInstalledVersion(pkg, binary);
    return { success: true, version: newVersion, error: null };
  } catch (err) {
    return {
      success: false,
      version: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkForUpdates(): Promise<void> {
  if (updating) return;

  try {
    const claudeCurrent = getInstalledVersion("@anthropic-ai/claude-code", "claude");
    const claudeLatest = getLatestVersion("@anthropic-ai/claude-code");
    const codexCurrent = getInstalledVersion("@openai/codex", "codex");
    const codexLatest = getLatestVersion("@openai/codex");
    const ghCurrent = getInstalledVersionViaCli("gh");
    const ghLatest = getGhLatestVersion();

    cachedStatus = {
      claude: { current: claudeCurrent, latest: claudeLatest },
      codex: { current: codexCurrent, latest: codexLatest },
      gh: { current: ghCurrent, latest: ghLatest },
    };

    lastCheckAt = new Date().toISOString();
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
}

export async function performUpdate(): Promise<{ claude: string | null; codex: string | null; errors: string[] }> {
  if (updating) {
    return { claude: null, codex: null, errors: ["Update already in progress"] };
  }

  updating = true;
  const errors: string[] = [];
  let claudeVersion: string | null = null;
  let codexVersion: string | null = null;

  try {
    // Update Claude Code
    const claudeResult = updatePackage("@anthropic-ai/claude-code", "claude");
    if (claudeResult.success) {
      claudeVersion = claudeResult.version;
      console.log(`[auto-updater] Claude Code updated to ${claudeVersion}`);
    } else if (claudeResult.error) {
      errors.push(`Claude Code: ${claudeResult.error}`);
      console.error(`[auto-updater] Failed to update Claude Code: ${claudeResult.error}`);
    }

    // Update Codex
    const codexResult = updatePackage("@openai/codex", "codex");
    if (codexResult.success) {
      codexVersion = codexResult.version;
      console.log(`[auto-updater] Codex updated to ${codexVersion}`);
    } else if (codexResult.error) {
      errors.push(`Codex: ${codexResult.error}`);
      console.error(`[auto-updater] Failed to update Codex: ${codexResult.error}`);
    }

    lastUpdateAt = new Date().toISOString();
    lastError = errors.length > 0 ? errors.join("; ") : null;

    // Refresh cached versions
    await checkForUpdates();
  } finally {
    updating = false;
  }

  return { claude: claudeVersion, codex: codexVersion, errors };
}

async function tick(): Promise<void> {
  const settings = getSettings();
  if (!settings.autoUpdateEnabled) return;

  console.log("[auto-updater] Checking for updates...");
  await checkForUpdates();

  const claudeNeedsUpdate =
    cachedStatus.claude.current &&
    cachedStatus.claude.latest &&
    cachedStatus.claude.current !== cachedStatus.claude.latest;

  const codexNeedsUpdate =
    cachedStatus.codex.current &&
    cachedStatus.codex.latest &&
    cachedStatus.codex.current !== cachedStatus.codex.latest;

  if (claudeNeedsUpdate || codexNeedsUpdate) {
    console.log("[auto-updater] Updates available, installing...");
    await performUpdate();
  } else {
    console.log("[auto-updater] All packages are up to date.");
  }
}

export function getUpdateStatus(): UpdateStatus {
  const claudeUpdateAvailable =
    cachedStatus.claude.current !== null &&
    cachedStatus.claude.latest !== null &&
    cachedStatus.claude.current !== cachedStatus.claude.latest;

  const codexUpdateAvailable =
    cachedStatus.codex.current !== null &&
    cachedStatus.codex.latest !== null &&
    cachedStatus.codex.current !== cachedStatus.codex.latest;

  const ghUpdateAvailable =
    cachedStatus.gh.current !== null &&
    cachedStatus.gh.latest !== null &&
    cachedStatus.gh.current !== cachedStatus.gh.latest;

  return {
    lastCheckAt,
    lastUpdateAt,
    claudeCode: {
      currentVersion: cachedStatus.claude.current,
      latestVersion: cachedStatus.claude.latest,
      updateAvailable: claudeUpdateAvailable,
    },
    codex: {
      currentVersion: cachedStatus.codex.current,
      latestVersion: cachedStatus.codex.latest,
      updateAvailable: codexUpdateAvailable,
    },
    gh: {
      currentVersion: cachedStatus.gh.current,
      latestVersion: cachedStatus.gh.latest,
      updateAvailable: ghUpdateAvailable,
    },
    updating,
    lastError,
  };
}

export function startAutoUpdater(): void {
  const settings = getSettings();
  const intervalMs = settings.autoUpdateIntervalHours * 60 * 60 * 1000;

  // Do an initial check shortly after startup
  setTimeout(() => tick(), 10_000);

  // Schedule recurring checks
  checkTimer = setInterval(() => tick(), intervalMs);

  console.log(
    `[auto-updater] Started (enabled: ${settings.autoUpdateEnabled}, interval: ${settings.autoUpdateIntervalHours}h)`
  );
}

export function restartAutoUpdater(): void {
  stopAutoUpdater();
  startAutoUpdater();
}

export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}
