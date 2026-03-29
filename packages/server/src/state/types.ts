import type { SandboxProvider, TerminalStartupStatus } from "@maestro/wire";

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  repoUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  defaultBranch: string | null;
  localPath: string;
  status: "ready" | "error";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TerminalRecord {
  id: string;
  name: string | null;
  kind?: "terminal" | "kanban" | "automation" | "scheduler";
  provider: string;
  projectId: string | null;
  projectPath: string;
  customDisplayName: string | null;
  customCommandTemplate: string | null;
  customEnv: Record<string, string> | null;
  sandboxProvider: SandboxProvider | null;
  secondaryProjectPaths: string[];
  worktreePath: string | null;
  autoWorktree: boolean;
  skills: string[];
  status: "idle" | "running" | "waiting" | "completed" | "error";
  startupStatus: TerminalStartupStatus | null;
  currentTask: string | null;
  error: string | null;
  recentInputs: string[];
  lastActivity: string | null;
  skipPermissions: boolean;
  disableSandbox: boolean;
  kanbanTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AgentRecord = TerminalRecord;

export interface KanbanOverlayRecord {
  blockedBy?: string[];
  priority?: "low" | "medium" | "high";
  progress?: number;
  completionSummary?: string | null;
  assignedTerminalId?: string | null;
  orderIndex?: number;
  branchName?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
}

export interface LocalKanbanTaskRecord {
  id: string;
  title: string;
  description: string;
  column: "backlog" | "planned" | "ongoing" | "review" | "done";
  projectId: string | null;
  projectPath: string;
  blockedBy: string[];
  priority: "low" | "medium" | "high";
  progress: number;
  orderIndex: number;
  labels: string[];
  completionSummary: string | null;
  assignedTerminalId: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanTaskRecord {
  id: string;
  title: string;
  description: string;
  column: "backlog" | "planned" | "ongoing" | "review" | "done";
  projectId: string | null;
  projectPath: string;
  blockedBy: string[];
  priority: "low" | "medium" | "high";
  progress: number;
  orderIndex: number;
  labels: string[];
  completionSummary: string | null;
  assignedTerminalId: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  sourceType: "github_issue" | "local";
  sourceId: string;
  project?: {
    id: string;
    name: string;
  } | null;
  terminals?: Array<{ id: string; name: string | null; status: string }>;
}

export interface ScheduledTaskRecord {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  projectId: string | null;
  projectPath: string;
  provider: string;
  customDisplayName: string | null;
  customCommandTemplate: string | null;
  customEnv: Record<string, string> | null;
  skipPermissions: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRecord {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  sourceType: string;
  sourceConfig: Record<string, string>;
  triggerType: string;
  agentProjectId: string | null;
  agentProjectPath: string;
  agentPromptTemplate: string;
  agentProvider: string;
  agentCustomDisplayName: string | null;
  agentCustomCommandTemplate: string | null;
  agentCustomEnv: Record<string, string> | null;
  agentSkipPermissions: boolean;
  pollIntervalMinutes: number;
  lastPollAt: string | null;
  processedHashes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  status: string;
  itemsFound: number;
  itemsProcessed: number;
  error: string | null;
  agentId: string | null;
  itemContext: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
}
