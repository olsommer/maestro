import { getAuthToken, getServerUrl, invalidateAuth } from "./auth";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const hasBody = options?.body != null;
  const res = await fetch(`${getServerUrl()}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      invalidateAuth();
    }
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface Agent {
  id: string;
  name: string | null;
  provider: string;
  model: string | null;
  projectId?: string | null;
  projectPath: string;
  customDisplayName?: string | null;
  customCommandTemplate?: string | null;
  customEnv?: Record<string, string> | null;
  worktreePath?: string | null;
  project?: {
    id: string;
    name: string;
  } | null;
  secondaryProjectPaths: string[];
  skills: string[];
  status: string;
  currentTask: string | null;
  error: string | null;
  lastActivity: string | null;
  skipPermissions: boolean;
  disableSandbox: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeStatus {
  github: {
    tokenConfigured: boolean;
    githubProjectCount: number;
    githubAutomationCount: number;
    featuresEnabled: boolean;
    needsAuthWarning: boolean;
    warningMessage: string | null;
  };
}

export interface GitHubConnectionStatus {
  connected: boolean;
  source: "stored" | "env" | null;
  canDisconnect: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: string | null;
  verifiedAt: string | null;
}

export interface ClaudeAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  email: string | null;
  orgName: string | null;
  authMethod: string | null;
}

export interface CodexAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  detail: string | null;
}

export interface Settings {
  autoUpdateEnabled: boolean;
  autoUpdateIntervalHours: number;
  piOllamaModel: string;
  telegramBotToken: string;
  deepgramApiKey: string;
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
}

export interface OllamaPullStatus {
  model: string | null;
  status: string;
  progress: number;
  error: string | null;
  done: boolean;
}

export interface OllamaStatus {
  running: boolean;
  host: string;
}

export interface UpdateStatus {
  lastCheckAt: string | null;
  lastUpdateAt: string | null;
  claudeCode: {
    currentVersion: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
  };
  codex: {
    currentVersion: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
  };
  gh: {
    currentVersion: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
  };
  updating: boolean;
  lastError: string | null;
}

export interface GitHubRepoSuggestion {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
}

export const api = {
  getProjects: () => request<{ projects: Project[] }>("/api/projects"),
  getRuntimeStatus: () => request<RuntimeStatus>("/api/system/status"),
  getGitHubIntegration: (fresh?: boolean) =>
    request<{ github: GitHubConnectionStatus }>(`/api/integrations/github${fresh ? "?fresh=1" : ""}`),
  searchGitHubRepos: (query: string) =>
    request<{ repos: GitHubRepoSuggestion[] }>(
      `/api/integrations/github/repos?${
        new URLSearchParams({ q: query }).toString()
      }`
    ),
  connectGitHub: (token: string) =>
    request<{ github: GitHubConnectionStatus }>("/api/integrations/github/connect", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  disconnectGitHub: () =>
    request<{ ok: boolean; github: GitHubConnectionStatus }>("/api/integrations/github/connect", {
      method: "DELETE",
    }),

  // Claude Code auth
  getClaudeAuthStatus: (fresh?: boolean) =>
    request<ClaudeAuthStatus>(`/api/integrations/claude/status${fresh ? "?fresh=1" : ""}`),

  // Codex auth
  getCodexAuthStatus: (fresh?: boolean) =>
    request<CodexAuthStatus>(`/api/integrations/codex/status${fresh ? "?fresh=1" : ""}`),
  startCodexDeviceAuth: () =>
    request<{ code: string; url: string }>("/api/integrations/codex/device-auth/start", {
      method: "POST",
    }),
  connectCodexWithApiKey: (apiKey: string) =>
    request<CodexAuthStatus>("/api/integrations/codex/connect-api-key", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),

  // Setup
  getSetupStatus: () =>
    request<{ needsSetup: boolean; running: boolean }>("/api/setup/status"),

  // Settings
  getSettings: () => request<Settings>("/api/settings"),
  updateSettings: (data: Partial<Settings>) =>
    request<Settings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  getDeepgramKey: () => request<{ apiKey: string }>("/api/settings/deepgram-key"),
  getUpdateStatus: () => request<UpdateStatus>("/api/settings/update-status"),
  checkForUpdates: () => request<UpdateStatus>("/api/settings/check-updates", { method: "POST" }),
  updateNow: () =>
    request<{ claude: string | null; codex: string | null; errors: string[]; status: UpdateStatus }>(
      "/api/settings/update-now",
      { method: "POST" }
    ),

  getProject: (id: string) => request<{ project: Project }>(`/api/projects/${id}`),

  createProject: (data: {
    name: string;
    repoUrl?: string;
    githubOwner?: string;
    githubRepo?: string;
    defaultBranch?: string;
    localPath?: string;
    syncIssues?: boolean;
    provider?: string;
    model?: string;
  }) =>
    request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  syncProjectIssues: (id: string) =>
    request<{ ok: boolean; syncedCount: number; project: Project | null }>(
      `/api/projects/${id}/sync/github-issues`,
      { method: "POST" }
    ),

  getAgents: () => request<{ agents: Agent[] }>("/api/agents"),

  getAgent: (id: string) => request<{ agent: Agent }>(`/api/agents/${id}`),

  getAgentOutput: (id: string) =>
    request<{ output: string[] }>(`/api/agents/${id}/output`),

  createAgent: (data: {
    name?: string;
    provider?: string;
    model?: string;
    projectId?: string;
    projectPath?: string;
    customDisplayName?: string;
    customCommandTemplate?: string;
    customEnv?: Record<string, string>;
    skills?: string[];
    skipPermissions?: boolean;
    disableSandbox?: boolean;
    useWorktree?: boolean;
    worktreePath?: string;
    prompt?: string;
  }) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  startAgent: (id: string, prompt = "", model?: string) =>
    request<{ ok: boolean }>(`/api/agents/${id}/start`, {
      method: "POST",
      body: JSON.stringify({ prompt, model }),
    }),

  stopAgent: (id: string) =>
    request<{ ok: boolean }>(`/api/agents/${id}/stop`, { method: "POST" }),

  sendInput: (id: string, text: string) =>
    request<{ ok: boolean }>(`/api/agents/${id}/input`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  deleteAgent: (id: string) =>
    request<{ ok: boolean }>(`/api/agents/${id}`, { method: "DELETE" }),

  // Kanban
  getKanbanTasks: (column?: string, projectId?: string) =>
    request<{ tasks: KanbanTask[] }>(
      `/api/kanban/tasks${
        column || projectId
          ? `?${new URLSearchParams(
              Object.fromEntries(
                Object.entries({ column, projectId }).filter(([, value]) => value)
              ) as Record<string, string>
            ).toString()}`
          : ""
      }`
    ),

  createKanbanTask: (data: {
    title: string;
    description: string;
    projectId?: string;
    projectPath?: string;
    blockedBy?: string[];
    priority?: string;
    labels?: string[];
  }) =>
    request<{ task: KanbanTask }>("/api/kanban/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateKanbanTask: (id: string, data: Record<string, unknown>) =>
    request<{ task: KanbanTask }>(`/api/kanban/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  moveKanbanTask: (id: string, column: string) =>
    request<{ task: KanbanTask }>(`/api/kanban/tasks/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ column }),
    }),

  deleteKanbanTask: (id: string) =>
    request<{ ok: boolean }>(`/api/kanban/tasks/${id}`, { method: "DELETE" }),

  // Ollama / Pi Agent
  getOllamaStatus: () => request<OllamaStatus>("/api/ollama/status"),
  getOllamaModels: () => request<{ models: OllamaModelInfo[] }>("/api/ollama/models"),
  getRecommendedModels: () => request<{ models: string[] }>("/api/ollama/recommended"),
  pullOllamaModel: (model: string) =>
    request<{ ok: boolean; model: string }>("/api/ollama/pull", {
      method: "POST",
      body: JSON.stringify({ model }),
    }),
  getOllamaPullStatus: () => request<OllamaPullStatus>("/api/ollama/pull/status"),

  // Telegram
  getTelegramStatus: () => request<{ status: string; botUsername: string | null }>("/api/integrations/telegram"),
  connectTelegram: () => request<{ status: string; botUsername: string | null }>("/api/integrations/telegram/connect", { method: "POST" }),
  disconnectTelegram: () => request<{ ok: boolean }>("/api/integrations/telegram/connect", { method: "DELETE" }),
};

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  column: string;
  projectId?: string | null;
  projectPath: string;
  project?: {
    id: string;
    name: string;
  } | null;
  blockedBy: string[];
  priority: string;
  progress: number;
  orderIndex: number;
  labels: string[];
  completionSummary: string | null;
  assignedAgentId: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  agents?: { id: string; name: string | null; status: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  repoUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  defaultBranch: string | null;
  localPath: string;
  status: string;

  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}
