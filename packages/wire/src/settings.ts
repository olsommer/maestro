import { z } from "zod";

export const SettingsSchema = z.object({
  autoUpdateEnabled: z.boolean().default(false),
  autoUpdateIntervalHours: z.number().min(1).max(168).default(24),
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
  updating: z.boolean(),
  lastError: z.string().nullable(),
});

export type UpdateStatus = z.infer<typeof UpdateStatus>;
