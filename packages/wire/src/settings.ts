import { z } from "zod";

export const AutoSpawnAgentProviderSchema = z.enum(["claude", "codex"]);
export type AutoSpawnAgentProvider = z.infer<typeof AutoSpawnAgentProviderSchema>;

export const AutoSpawnAgentWorktreeModeSchema = z.enum(["none", "new"]);
export type AutoSpawnAgentWorktreeMode = z.infer<typeof AutoSpawnAgentWorktreeModeSchema>;

export const SandboxProviderSchema = z.enum(["none", "docker", "firecracker"]);
export type SandboxProvider = z.infer<typeof SandboxProviderSchema>;

export const SettingsSchema = z.object({
  autoUpdateEnabled: z.boolean().default(false),
  autoUpdateIntervalHours: z.number().min(1).max(168).default(24),
  telegramBotToken: z.string().default(""),
  /** Legacy boolean retained for backwards compatibility with older clients */
  sandboxEnabled: z.boolean().default(false),
  /** Sandbox runtime used when a terminal/agent enables sandboxing */
  sandboxProvider: SandboxProviderSchema.default("none"),
  /** Deepgram API key for voice-to-text on mobile */
  deepgramApiKey: z.string().default(""),
  /** Default coding agent provider used for automatic spawns */
  agentDefaultProvider: AutoSpawnAgentProviderSchema.default("claude"),
  /** Disable sandbox for automatically spawned agents */
  agentDefaultDisableSandbox: z.boolean().default(false),
  /** Run automatically spawned agents without approval prompts */
  agentDefaultSkipPermissions: z.boolean().default(true),
  /** Worktree mode for automatically spawned agents */
  agentDefaultWorktreeMode: AutoSpawnAgentWorktreeModeSchema.default("none"),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsUpdateSchema = SettingsSchema.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

export const UpdateStatus = z.object({
  lastCheckAt: z.string().nullable(),
  lastUpdateAt: z.string().nullable(),
  claudeCode: z.object({
    currentVersion: z.string().nullable(),
    latestVersion: z.string().nullable(),
    updateAvailable: z.boolean(),
  }),
  codex: z.object({
    currentVersion: z.string().nullable(),
    latestVersion: z.string().nullable(),
    updateAvailable: z.boolean(),
  }),
  gh: z.object({
    currentVersion: z.string().nullable(),
    latestVersion: z.string().nullable(),
    updateAvailable: z.boolean(),
  }),
  updating: z.boolean(),
  lastError: z.string().nullable(),
});

export type UpdateStatus = z.infer<typeof UpdateStatus>;

export const MaestroInstallMode = z.enum(["npm", "container", "unknown"]);
export type MaestroInstallMode = z.infer<typeof MaestroInstallMode>;

export const MaestroUpdateStatus = z.object({
  supported: z.boolean(),
  installMode: MaestroInstallMode,
  currentVersion: z.string().nullable(),
  latestVersion: z.string().nullable(),
  updateAvailable: z.boolean(),
  updating: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  lastUpdatedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type MaestroUpdateStatus = z.infer<typeof MaestroUpdateStatus>;

export const MaestroUpdateTriggerResponse = z.object({
  accepted: z.boolean(),
  message: z.string(),
  targetVersion: z.string().nullable(),
});
export type MaestroUpdateTriggerResponse = z.infer<typeof MaestroUpdateTriggerResponse>;
