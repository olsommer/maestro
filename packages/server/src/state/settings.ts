import type { Settings, SettingsUpdate } from "@maestro/wire";
import { getSetting, setSetting } from "./sqlite.js";

const DEFAULTS: Settings = {
  autoUpdateEnabled: false,
  autoUpdateIntervalHours: 24,
  piOllamaModel: "",
  telegramBotToken: "",
  sandboxEnabled: false,
  deepgramApiKey: "",
  agentDefaultProvider: "claude",
  agentDefaultDisableSandbox: false,
  agentDefaultSkipPermissions: true,
  agentDefaultWorktreeMode: "none",
};

export function getSettings(): Settings {
  const enabled = getSetting("autoUpdateEnabled");
  const interval = getSetting("autoUpdateIntervalHours");
  const piModel = getSetting("piOllamaModel");

  const telegramToken = getSetting("telegramBotToken");
  const sandbox = getSetting("sandboxEnabled");
  const deepgramKey = getSetting("deepgramApiKey");
  const agentDefaultProvider = getSetting("agentDefaultProvider");
  const agentDefaultDisableSandbox = getSetting("agentDefaultDisableSandbox");
  const agentDefaultSkipPermissions = getSetting("agentDefaultSkipPermissions");
  const agentDefaultWorktreeMode = getSetting("agentDefaultWorktreeMode");

  return {
    autoUpdateEnabled: enabled !== null ? enabled === "true" : DEFAULTS.autoUpdateEnabled,
    autoUpdateIntervalHours: interval !== null ? Number(interval) : DEFAULTS.autoUpdateIntervalHours,
    piOllamaModel: piModel !== null ? piModel : DEFAULTS.piOllamaModel,
    telegramBotToken: telegramToken !== null ? telegramToken : DEFAULTS.telegramBotToken,
    sandboxEnabled: sandbox !== null ? sandbox === "true" : DEFAULTS.sandboxEnabled,
    deepgramApiKey: deepgramKey !== null ? deepgramKey : DEFAULTS.deepgramApiKey,
    agentDefaultProvider:
      agentDefaultProvider === "codex" ? "codex" : DEFAULTS.agentDefaultProvider,
    agentDefaultDisableSandbox:
      agentDefaultDisableSandbox !== null
        ? agentDefaultDisableSandbox === "true"
        : DEFAULTS.agentDefaultDisableSandbox,
    agentDefaultSkipPermissions:
      agentDefaultSkipPermissions !== null
        ? agentDefaultSkipPermissions === "true"
        : DEFAULTS.agentDefaultSkipPermissions,
    agentDefaultWorktreeMode:
      agentDefaultWorktreeMode === "new" ? "new" : DEFAULTS.agentDefaultWorktreeMode,
  };
}

export function updateSettings(patch: SettingsUpdate): Settings {
  if (patch.autoUpdateEnabled !== undefined) {
    setSetting("autoUpdateEnabled", String(patch.autoUpdateEnabled));
  }
  if (patch.autoUpdateIntervalHours !== undefined) {
    setSetting("autoUpdateIntervalHours", String(patch.autoUpdateIntervalHours));
  }
  if (patch.piOllamaModel !== undefined) {
    setSetting("piOllamaModel", patch.piOllamaModel);
  }
  if (patch.telegramBotToken !== undefined) {
    setSetting("telegramBotToken", patch.telegramBotToken);
  }
  if (patch.sandboxEnabled !== undefined) {
    setSetting("sandboxEnabled", String(patch.sandboxEnabled));
  }
  if (patch.deepgramApiKey !== undefined) {
    setSetting("deepgramApiKey", patch.deepgramApiKey);
  }
  if (patch.agentDefaultProvider !== undefined) {
    setSetting("agentDefaultProvider", patch.agentDefaultProvider);
  }
  if (patch.agentDefaultDisableSandbox !== undefined) {
    setSetting("agentDefaultDisableSandbox", String(patch.agentDefaultDisableSandbox));
  }
  if (patch.agentDefaultSkipPermissions !== undefined) {
    setSetting("agentDefaultSkipPermissions", String(patch.agentDefaultSkipPermissions));
  }
  if (patch.agentDefaultWorktreeMode !== undefined) {
    setSetting("agentDefaultWorktreeMode", patch.agentDefaultWorktreeMode);
  }
  return getSettings();
}
