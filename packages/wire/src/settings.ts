import { z } from "zod";

export const SettingsSchema = z.object({
  autoUpdateEnabled: z.boolean().default(false),
  autoUpdateIntervalHours: z.number().min(1).max(168).default(24),
  piOllamaModel: z.string().default(""),
  telegramBotToken: z.string().default(""),
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
  updating: z.boolean(),
  lastError: z.string().nullable(),
});

export type UpdateStatus = z.infer<typeof UpdateStatus>;
