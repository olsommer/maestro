import type { AgentProvider } from "@maestro/wire";
import { getClaudeAuthStatus, getCodexAuthStatus } from "../integrations/cli-auth.js";
import { getCachedClaudeAuthStatus, getCachedCodexAuthStatus } from "../services/auth-status-checker.js";
import { getSettings } from "../state/settings.js";

function getProviderLabel(provider: AgentProvider): string {
  return provider === "codex" ? "Codex" : "Claude Code";
}

export function assertAutoSpawnProviderReady(): AgentProvider {
  const provider = getSettings().agentDefaultProvider;
  const status =
    provider === "codex"
      ? (getCachedCodexAuthStatus() ?? getCodexAuthStatus())
      : (getCachedClaudeAuthStatus() ?? getClaudeAuthStatus());

  if (!status.installed) {
    throw new Error(
      `${getProviderLabel(provider)} is selected in Settings, but it is not installed.`
    );
  }

  if (!status.loggedIn) {
    throw new Error(
      `${getProviderLabel(provider)} is selected in Settings, but it is not logged in.`
    );
  }

  return provider;
}
