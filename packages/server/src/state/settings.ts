import type { Settings, SettingsUpdate } from "@maestro/wire";
import { getSetting, setSetting } from "./sqlite.js";

const DEFAULTS: Settings = {
  autoUpdateEnabled: false,
  autoUpdateIntervalHours: 24,
  piOllamaModel: "",
  telegramBotToken: "",
};

export function getSettings(): Settings {
  const enabled = getSetting("autoUpdateEnabled");
  const interval = getSetting("autoUpdateIntervalHours");
  const piModel = getSetting("piOllamaModel");

  const telegramToken = getSetting("telegramBotToken");

  return {
    autoUpdateEnabled: enabled !== null ? enabled === "true" : DEFAULTS.autoUpdateEnabled,
    autoUpdateIntervalHours: interval !== null ? Number(interval) : DEFAULTS.autoUpdateIntervalHours,
    piOllamaModel: piModel !== null ? piModel : DEFAULTS.piOllamaModel,
    telegramBotToken: telegramToken !== null ? telegramToken : DEFAULTS.telegramBotToken,
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
  return getSettings();
}
