import {
  getClaudeAuthStatus,
  getCodexAuthStatus,
  type ClaudeAuthStatus,
  type CodexAuthStatus,
} from "../integrations/cli-auth.js";
import {
  getGitHubConnectionStatus,
  type GitHubConnectionStatus,
} from "../integrations/github.js";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const INITIAL_DELAY_MS = 5_000; // 5 seconds after startup

let timer: ReturnType<typeof setInterval> | null = null;
let lastCheckAt: string | null = null;

let cachedClaude: ClaudeAuthStatus | null = null;
let cachedCodex: CodexAuthStatus | null = null;
let cachedGitHub: GitHubConnectionStatus | null = null;

export async function refreshAuthStatus(): Promise<void> {
  console.log("[auth-status] Checking CLI auth status...");
  try {
    cachedClaude = getClaudeAuthStatus();
  } catch {
    cachedClaude = null;
  }
  try {
    cachedCodex = getCodexAuthStatus();
  } catch {
    cachedCodex = null;
  }
  try {
    cachedGitHub = await getGitHubConnectionStatus();
  } catch {
    cachedGitHub = null;
  }
  lastCheckAt = new Date().toISOString();
  console.log("[auth-status] Check complete.");
}

export function getCachedClaudeAuthStatus(): ClaudeAuthStatus | null {
  return cachedClaude;
}

export function getCachedCodexAuthStatus(): CodexAuthStatus | null {
  return cachedCodex;
}

export function getCachedGitHubConnectionStatus(): GitHubConnectionStatus | null {
  return cachedGitHub;
}

export function getAuthStatusLastCheckAt(): string | null {
  return lastCheckAt;
}

export function startAuthStatusChecker(): void {
  setTimeout(() => void refreshAuthStatus(), INITIAL_DELAY_MS);
  timer = setInterval(() => void refreshAuthStatus(), INTERVAL_MS);
  console.log("[auth-status] Started (interval: 24h)");
}

export function stopAuthStatusChecker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
