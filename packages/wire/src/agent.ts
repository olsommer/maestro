import { z } from "zod";

export const AgentProvider = z.enum(["claude", "codex", "gemini", "custom"]);
export type AgentProvider = z.infer<typeof AgentProvider>;

export const AgentModel = z.enum(["sonnet", "opus", "haiku"]);
export type AgentModel = z.infer<typeof AgentModel>;

export const AgentStatus = z.enum([
  "idle",
  "running",
  "waiting",
  "completed",
  "error",
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentSpawnOptions = z
  .object({
    name: z.string().optional(),
    provider: AgentProvider.default("claude"),
    model: AgentModel.optional(),
    projectId: z.string().optional(),
    projectPath: z.string().optional(),
    customDisplayName: z.string().optional(),
    customCommandTemplate: z.string().optional(),
    customEnv: z.record(z.string()).optional(),
    secondaryProjectPaths: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    skipPermissions: z.boolean().default(false),
    useWorktree: z.boolean().optional(),
    worktree: z.boolean().optional(),
    worktreePath: z.string().optional(),
    prompt: z.string().optional(),
  })
  .refine((data) => Boolean(data.projectId || data.projectPath), {
    message: "projectId or projectPath is required",
    path: ["projectPath"],
  })
  .refine(
    (data) =>
      data.provider !== "custom" ||
      Boolean(data.customCommandTemplate?.trim()),
    {
      message: "customCommandTemplate is required for custom providers",
      path: ["customCommandTemplate"],
    }
  );
export type AgentSpawnOptions = z.infer<typeof AgentSpawnOptions>;

export const AgentInfo = z.object({
  id: z.string(),
  name: z.string().nullable(),
  provider: AgentProvider,
  model: AgentModel.nullable(),
  projectId: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
  projectPath: z.string(),
  customDisplayName: z.string().nullable().optional(),
  customCommandTemplate: z.string().nullable().optional(),
  customEnv: z.record(z.string()).nullable().optional(),
  status: AgentStatus,
  currentTask: z.string().nullable(),
  error: z.string().nullable(),
  lastActivity: z.string().nullable(),
  skills: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentInfo = z.infer<typeof AgentInfo>;

export const AgentStartInput = z.object({
  prompt: z.string().optional().default(""),
  model: AgentModel.optional(),
});
export type AgentStartInput = z.infer<typeof AgentStartInput>;

export const AgentSendInput = z.object({
  text: z.string(),
});
export type AgentSendInput = z.infer<typeof AgentSendInput>;
