import type { Settings, SettingsUpdate } from "@maestro/wire";
import { getSetting, setSetting } from "./sqlite.js";

const DEFAULTS: Settings = {
  autoUpdateEnabled: false,
  autoUpdateIntervalHours: 24,
};

export function getSettings(): Settings {
  const enabled = getSetting("autoUpdateEnabled");
  const interval = getSetting("autoUpdateIntervalHours");

  return {
    autoUpdateEnabled: enabled !== null ? enabled === "true" : DEFAULTS.autoUpdateEnabled,
    autoUpdateIntervalHours: interval !== null ? Number(interval) : DEFAULTS.autoUpdateIntervalHours,
  };
}

export function updateSettings(patch: SettingsUpdate): Settings {
  if (patch.autoUpdateEnabled !== undefined) {
    setSetting("autoUpdateEnabled", String(patch.autoUpdateEnabled));
  }
  if (patch.autoUpdateIntervalHours !== undefined) {
    setSetting("autoUpdateIntervalHours", String(patch.autoUpdateIntervalHours));
  }
  return getSettings();
}
