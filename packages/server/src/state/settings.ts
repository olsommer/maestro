import type { Settings, SettingsUpdate } from "@maestro/wire";
import { normalizeSandboxProvider } from "../agents/sandbox.js";
import { getSetting, setSetting } from "./sqlite.js";

const DEFAULT_CUSTOM_SANDBOX_DOCKERFILE = `FROM maestro-sandbox:latest

RUN apt-get update && apt-get install -y \\
    sudo \\
    python3 \\
    python3-pip \\
    curl \\
    unzip \\
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g agent-browser

RUN agent-browser install --with-deps

RUN pip3 install --break-system-packages uv ruff
`;

const DEFAULTS: Settings = {
  autoUpdateEnabled: false,
  autoUpdateIntervalHours: 24,
  telegramBotToken: "",
  sandboxEnabled: false,
  sandboxProvider: "none",
  sandboxImage: {
    mode: "builtin",
    builtinImage: process.env.MAESTRO_DOCKER_SANDBOX_IMAGE || "maestro-sandbox:latest",
    customDockerfile: DEFAULT_CUSTOM_SANDBOX_DOCKERFILE,
    customImageTag: "maestro-sandbox:user-custom",
    customBuildStatus: "idle",
    customBuildError: null,
    customBuiltAt: null,
  },
  sandboxResources: {
    memoryLimitMb: 2048,
    maxProcesses: 256,
  },
  deepgramApiKey: "",
  agentDefaultProvider: "claude",
  agentDefaultDisableSandbox: false,
  agentDefaultSkipPermissions: true,
  agentDefaultWorktreeMode: "none",
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getSandboxImageSettings(): Settings["sandboxImage"] {
  const parsed = parseJson<Partial<Settings["sandboxImage"]>>(
    getSetting("sandboxImageJson"),
    {}
  );

  return {
    ...DEFAULTS.sandboxImage,
    ...parsed,
  };
}

function getSandboxResourceSettings(): Settings["sandboxResources"] {
  const parsed = parseJson<Partial<Settings["sandboxResources"]>>(
    getSetting("sandboxResourcesJson"),
    {}
  );

  return {
    ...DEFAULTS.sandboxResources,
    ...parsed,
  };
}

export function normalizeAutoSpawnSandboxProvider(
  provider: Settings["agentDefaultProvider"],
  sandboxProvider: Settings["sandboxProvider"]
): Settings["sandboxProvider"] {
  if (provider === "codex" && sandboxProvider === "gvisor") {
    return "docker";
  }

  return sandboxProvider;
}

export function getSettings(): Settings {
  const enabled = getSetting("autoUpdateEnabled");
  const interval = getSetting("autoUpdateIntervalHours");
  const telegramToken = getSetting("telegramBotToken");
  const sandbox = getSetting("sandboxEnabled");
  const sandboxProvider = getSetting("sandboxProvider");
  const sandboxImage = getSandboxImageSettings();
  const sandboxResources = getSandboxResourceSettings();
  const deepgramKey = getSetting("deepgramApiKey");
  const agentDefaultProvider = getSetting("agentDefaultProvider");
  const agentDefaultDisableSandbox = getSetting("agentDefaultDisableSandbox");
  const agentDefaultSkipPermissions = getSetting("agentDefaultSkipPermissions");
  const agentDefaultWorktreeMode = getSetting("agentDefaultWorktreeMode");
  const resolvedAgentDefaultProvider =
    agentDefaultProvider === "codex" ? "codex" : DEFAULTS.agentDefaultProvider;
  const resolvedSandboxProvider = normalizeAutoSpawnSandboxProvider(
    resolvedAgentDefaultProvider,
    normalizeSandboxProvider(sandboxProvider, sandbox === "true")
  );

  return {
    autoUpdateEnabled: enabled !== null ? enabled === "true" : DEFAULTS.autoUpdateEnabled,
    autoUpdateIntervalHours: interval !== null ? Number(interval) : DEFAULTS.autoUpdateIntervalHours,
    telegramBotToken: telegramToken !== null ? telegramToken : DEFAULTS.telegramBotToken,
    sandboxEnabled: resolvedSandboxProvider !== "none",
    sandboxProvider: resolvedSandboxProvider,
    sandboxImage,
    sandboxResources,
    deepgramApiKey: deepgramKey !== null ? deepgramKey : DEFAULTS.deepgramApiKey,
    agentDefaultProvider: resolvedAgentDefaultProvider,
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
  const current = getSettings();
  const nextAgentDefaultProvider =
    patch.agentDefaultProvider ?? current.agentDefaultProvider;
  const nextSandboxProvider = normalizeAutoSpawnSandboxProvider(
    nextAgentDefaultProvider,
    patch.sandboxProvider ?? current.sandboxProvider
  );

  if (patch.autoUpdateEnabled !== undefined) {
    setSetting("autoUpdateEnabled", String(patch.autoUpdateEnabled));
  }
  if (patch.autoUpdateIntervalHours !== undefined) {
    setSetting("autoUpdateIntervalHours", String(patch.autoUpdateIntervalHours));
  }
  if (patch.telegramBotToken !== undefined) {
    setSetting("telegramBotToken", patch.telegramBotToken);
  }
  if (patch.sandboxEnabled !== undefined) {
    setSetting("sandboxEnabled", String(patch.sandboxEnabled));
    if (patch.sandboxProvider === undefined) {
      setSetting("sandboxProvider", patch.sandboxEnabled ? "docker" : "none");
    }
  }
  if (patch.sandboxProvider !== undefined || nextSandboxProvider !== current.sandboxProvider) {
    setSetting("sandboxProvider", nextSandboxProvider);
    setSetting("sandboxEnabled", String(nextSandboxProvider !== "none"));
  }
  if (patch.sandboxImage !== undefined) {
    const nextSandboxImage = {
      ...current.sandboxImage,
      ...patch.sandboxImage,
    };
    const dockerfileChanged =
      nextSandboxImage.customDockerfile !== current.sandboxImage.customDockerfile ||
      nextSandboxImage.customImageTag !== current.sandboxImage.customImageTag ||
      nextSandboxImage.builtinImage !== current.sandboxImage.builtinImage;

    setSetting("sandboxImageJson", JSON.stringify({
      ...DEFAULTS.sandboxImage,
      ...nextSandboxImage,
      ...(dockerfileChanged
        ? {
            customBuildStatus: "idle",
            customBuildError: null,
            customBuiltAt: null,
          }
        : {}),
    }));
  }
  if (patch.sandboxResources !== undefined) {
    setSetting("sandboxResourcesJson", JSON.stringify({
      ...DEFAULTS.sandboxResources,
      ...current.sandboxResources,
      ...patch.sandboxResources,
    }));
  }
  if (patch.deepgramApiKey !== undefined) {
    setSetting("deepgramApiKey", patch.deepgramApiKey);
  }
  if (patch.agentDefaultProvider !== undefined) {
    setSetting("agentDefaultProvider", nextAgentDefaultProvider);
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
