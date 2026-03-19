import { z } from "zod";

export const KanbanColumn = z.enum(["backlog", "planned", "ongoing", "review", "done"]);
export type KanbanColumn = z.infer<typeof KanbanColumn>;

export const KanbanPriority = z.enum(["low", "medium", "high"]);
export type KanbanPriority = z.infer<typeof KanbanPriority>;

export const KanbanTask = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  column: KanbanColumn,
  projectId: z.string().nullable().optional(),
  projectPath: z.string(),
  blockedBy: z.array(z.string()),
  priority: KanbanPriority,
  progress: z.number().min(0).max(100),
  order: z.number(),
  labels: z.array(z.string()),
  completionSummary: z.string().nullable(),
  assignedTerminalId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KanbanTask = z.infer<typeof KanbanTask>;

export const KanbanTaskCreate = z.object({
  title: z.string(),
  description: z.string(),
  projectId: z.string().optional(),
  projectPath: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  priority: KanbanPriority.default("medium"),
  labels: z.array(z.string()).optional(),
}).refine((data) => Boolean(data.projectId || data.projectPath), {
  message: "projectId or projectPath is required",
  path: ["projectPath"],
});
export type KanbanTaskCreate = z.infer<typeof KanbanTaskCreate>;

export const KanbanTaskUpdate = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  column: KanbanColumn.optional(),
  priority: KanbanPriority.optional(),
  progress: z.number().min(0).max(100).optional(),
  labels: z.array(z.string()).optional(),
  blockedBy: z.array(z.string()).optional(),
  completionSummary: z.string().optional(),
});
export type KanbanTaskUpdate = z.infer<typeof KanbanTaskUpdate>;
