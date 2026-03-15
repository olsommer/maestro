import { z } from "zod";
import { AgentModel, AgentProvider } from "./agent.js";

export const ProjectStatus = z.enum(["ready", "bootstrapping", "error"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const ProjectCreateInput = z.object({
  name: z.string().min(1),
  repoUrl: z.string().optional(),
  githubOwner: z.string().optional(),
  githubRepo: z.string().optional(),
  defaultBranch: z.string().optional(),
  localPath: z.string().optional(),
  bootstrap: z.boolean().default(true),
  syncIssues: z.boolean().default(false),
  provider: AgentProvider.default("claude"),
  model: AgentModel.optional(),
});
export type ProjectCreateInput = z.infer<typeof ProjectCreateInput>;

export const ProjectInfo = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  repoUrl: z.string().nullable(),
  githubOwner: z.string().nullable(),
  githubRepo: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  localPath: z.string(),
  status: ProjectStatus,
  bootstrapAgentId: z.string().nullable(),
  bootstrapError: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastSyncError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectInfo = z.infer<typeof ProjectInfo>;
