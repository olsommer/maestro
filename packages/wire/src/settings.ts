import { z } from "zod";

export const AutoSpawnAgentProviderSchema = z.enum(["claude", "codex"]);
export type AutoSpawnAgentProvider = z.infer<typeof AutoSpawnAgentProviderSchema>;

export const AutoSpawnAgentWorktreeModeSchema = z.enum(["none", "new"]);
export type AutoSpawnAgentWorktreeMode = z.infer<typeof AutoSpawnAgentWorktreeModeSchema>;

export const SettingsSchema = z.object({
  autoUpdateEnabled: z.boolean().default(false),
  autoUpdateIntervalHours: z.number().min(1).max(168).default(24),
  piOllamaModel: z.string().default(""),
  telegramBotToken: z.string().default(""),
  /** Enable nsjail sandboxing for agents (Linux only, graceful fallback on other platforms) */
  sandboxEnabled: z.boolean().default(false),
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

// Ollama types for Pi agent configuration
export const OllamaModelInfo = z.object({
  name: z.string(),
  size: z.number(),
  digest: z.string(),
  modifiedAt: z.string(),
});
export type OllamaModelInfo = z.infer<typeof OllamaModelInfo>;

export const OllamaPullProgress = z.object({
  status: z.string(),
  digest: z.string().optional(),
  total: z.number().optional(),
  completed: z.number().optional(),
});
export type OllamaPullProgress = z.infer<typeof OllamaPullProgress>;

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
