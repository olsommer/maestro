import { randomUUID } from "crypto";
import { execFileSync } from "node:child_process";
import * as path from "path";
import { ensureDataDir, nowIso, readJsonFile, writeJsonFile } from "./files.js";
import {
  findProjectRecordByPath,
  getProjectRecordById,
  listProjectRecords,
  updateProjectRecord,
} from "./projects.js";
import { runGhCommand, runGitHubApi } from "../integrations/github.js";
import { findTerminalRecords, getTerminalRecord } from "./terminals.js";
import type {
  KanbanOverlayRecord,
  KanbanTaskRecord,
  LocalKanbanTaskRecord,
  ProjectRecord,
} from "./types.js";

const TASK_OVERLAYS_PATH = path.join(ensureDataDir(), "kanban-overlays.json");
const LOCAL_TASKS_PATH = path.join(ensureDataDir(), "local-kanban-tasks.json");

const STATUS_LABELS = {
  planned: "maestro:planned",
  ongoing: "maestro:ongoing",
  review: "maestro:review",
} as const;

const STATUS_LABEL_SET = new Set<string>(Object.values(STATUS_LABELS));

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
  html_url: string;
  pull_request?: unknown;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
}

interface GitHubPullRequestListItem {
  number: number;
  url: string;
}

function readOverlays(): Record<string, KanbanOverlayRecord> {
  return readJsonFile<Record<string, KanbanOverlayRecord>>(TASK_OVERLAYS_PATH, {});
}

function writeOverlays(overlays: Record<string, KanbanOverlayRecord>): void {
  writeJsonFile(TASK_OVERLAYS_PATH, overlays);
}

function readLocalTasks(): LocalKanbanTaskRecord[] {
  return readJsonFile<LocalKanbanTaskRecord[]>(LOCAL_TASKS_PATH, []);
}

function writeLocalTasks(tasks: LocalKanbanTaskRecord[]): void {
  writeJsonFile(LOCAL_TASKS_PATH, tasks);
}

function overlayKey(projectId: string, issueNumber: number): string {
  return `${projectId}#${issueNumber}`;
}

function buildGitHubTaskId(projectId: string, issueNumber: number): string {
  return `github:${projectId}:${issueNumber}`;
}

function parseGitHubTaskId(taskId: string): { projectId: string; issueNumber: number } | null {
  const [prefix, projectId, issue] = taskId.split(":");
  if (prefix !== "github" || !projectId || !issue) {
    return null;
  }

  const issueNumber = Number(issue);
  if (!Number.isFinite(issueNumber)) {
    return null;
  }

  return { projectId, issueNumber };
}

function getOverlay(
  projectId: string,
  issueNumber: number
): KanbanOverlayRecord | undefined {
  return readOverlays()[overlayKey(projectId, issueNumber)];
}

function slugifyBranchPart(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "task"
  );
}

function runGit(projectPath: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new Error(stderr || `git ${args.join(" ")} failed`);
  }
}

function getColumnForIssue(issue: GitHubIssue): KanbanTaskRecord["column"] {
  if (issue.state === "closed") {
    return "done";
  }

  const labels = new Set(issue.labels.map((label) => label.name));
  if (labels.has(STATUS_LABELS.review)) {
    return "review";
  }
  if (labels.has(STATUS_LABELS.ongoing)) {
    return "ongoing";
  }
  if (labels.has(STATUS_LABELS.planned)) {
    return "planned";
  }
  return "backlog";
}

function withTaskRelations(task: KanbanTaskRecord): KanbanTaskRecord {
  const project = task.projectId ? getProjectRecordById(task.projectId) : null;
  const agents = findTerminalRecords(
    (agent) => agent.kanbanTaskId === task.id || agent.id === task.assignedAgentId
  ).map((agent) => ({
    id: agent.id,
    name: agent.name,
    status: agent.status,
  }));

  return {
    ...task,
    project: project ? { id: project.id, name: project.name } : null,
    agents,
  };
}

async function githubRequest<T>(
  project: ProjectRecord,
  route: string,
  init?: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: Record<string, unknown>;
  }
): Promise<T> {
  if (!project.githubOwner || !project.githubRepo) {
    throw new Error("Project is not linked to a GitHub repository");
  }

  return runGitHubApi<T>(
    `repos/${project.githubOwner}/${project.githubRepo}${route}`,
    {
      method: init?.method,
      input: init?.body,
    }
  );
}

async function listGitHubIssues(project: ProjectRecord): Promise<GitHubIssue[]> {
  const issues = await githubRequest<GitHubIssue[]>(
    project,
    "/issues?state=all&per_page=100"
  );
  return issues.filter((issue) => !issue.pull_request);
}

async function getGitHubIssue(
  project: ProjectRecord,
  issueNumber: number
): Promise<GitHubIssue> {
  return githubRequest<GitHubIssue>(project, `/issues/${issueNumber}`);
}

async function patchGitHubIssue(
  project: ProjectRecord,
  issueNumber: number,
  body: Record<string, unknown>
): Promise<GitHubIssue> {
  return githubRequest<GitHubIssue>(project, `/issues/${issueNumber}`, {
    method: "PATCH",
    body,
  });
}

function mapGitHubIssueToTask(
  project: ProjectRecord,
  issue: GitHubIssue,
  overlay: KanbanOverlayRecord | undefined
): KanbanTaskRecord {
  const visibleLabels = issue.labels
    .map((label) => label.name)
    .filter((name) => !STATUS_LABEL_SET.has(name));
  const issueColumn = getColumnForIssue(issue);
  const column =
    issue.state === "open" && overlay?.pullRequestUrl
      ? "review"
      : overlay?.assignedAgentId && issue.state === "open"
        ? overlay.progress === 100
          ? "done"
          : issueColumn
        : issueColumn;

  return withTaskRelations({
    id: buildGitHubTaskId(project.id, issue.number),
    title: issue.title,
    description: issue.body ?? "",
    column,
    projectId: project.id,
    projectPath: project.localPath,
    blockedBy: overlay?.blockedBy ?? [],
    priority: overlay?.priority ?? "medium",
    progress:
      issue.state === "closed" ? 100 : Math.max(0, Math.min(100, overlay?.progress ?? 0)),
    orderIndex: overlay?.orderIndex ?? issue.number,
    labels: visibleLabels,
    completionSummary: overlay?.completionSummary ?? null,
    assignedAgentId: overlay?.assignedAgentId ?? null,
    pullRequestNumber: overlay?.pullRequestNumber ?? null,
    pullRequestUrl: overlay?.pullRequestUrl ?? null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    sourceType: "github_issue",
    sourceId: String(issue.number),
  });
}

function listLocalTasks(projectId?: string): KanbanTaskRecord[] {
  return readLocalTasks()
    .filter((task) => !projectId || task.projectId === projectId)
    .map((task) => withTaskRelations({ ...task, blockedBy: task.blockedBy ?? [], sourceType: "local", sourceId: task.id }));
}

async function listGitHubTasks(projectId?: string): Promise<KanbanTaskRecord[]> {
  const overlays = readOverlays();
  const projects = listProjectRecords().filter(
    (project) =>
      (!projectId || project.id === projectId) &&
      Boolean(project.githubOwner && project.githubRepo)
  );

  const taskGroups = await Promise.all(
    projects.map(async (project) => {
      try {
        const issues = await listGitHubIssues(project);
        return issues.map((issue) =>
          mapGitHubIssueToTask(project, issue, overlays[overlayKey(project.id, issue.number)])
        );
      } catch (error) {
        updateProjectRecord(project.id, {
          lastSyncError: error instanceof Error ? error.message : "GitHub sync failed",
        });
        return [];
      }
    })
  );

  return taskGroups.flat();
}

export async function listKanbanTasks(filters?: {
  projectId?: string;
  column?: string;
}): Promise<KanbanTaskRecord[]> {
  const [githubTasks, localTasks] = await Promise.all([
    listGitHubTasks(filters?.projectId),
    Promise.resolve(listLocalTasks(filters?.projectId)),
  ]);

  return [...githubTasks, ...localTasks]
    .filter((task) => !filters?.column || task.column === filters.column)
    .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
}

export async function getKanbanTask(taskId: string): Promise<KanbanTaskRecord | null> {
  if (taskId.startsWith("local:")) {
    const local = readLocalTasks().find((task) => `local:${task.id}` === taskId);
    return local ? withTaskRelations({ ...local, sourceType: "local", sourceId: local.id }) : null;
  }

  const parsed = parseGitHubTaskId(taskId);
  if (!parsed) {
    return null;
  }

  const project = getProjectRecordById(parsed.projectId);
  if (!project) {
    return null;
  }

  const issue = await getGitHubIssue(project, parsed.issueNumber);
  const overlays = readOverlays();
  return mapGitHubIssueToTask(project, issue, overlays[overlayKey(project.id, parsed.issueNumber)]);
}

export async function probeGitHubMirror(projectId: string): Promise<{ syncedCount: number }> {
  const project = getProjectRecordById(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  try {
    const issues = await listGitHubIssues(project);
    updateProjectRecord(project.id, {
      lastSyncedAt: nowIso(),
      lastSyncError: null,
    });
    return { syncedCount: issues.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub sync failed";
    updateProjectRecord(project.id, {
      lastSyncError: message,
    });
    throw new Error(message);
  }
}

export async function createKanbanTask(input: {
  title: string;
  description: string;
  projectId?: string;
  projectPath?: string;
  blockedBy?: string[];
  priority?: "low" | "medium" | "high";
  labels?: string[];
}): Promise<KanbanTaskRecord> {
  const project =
    (input.projectId ? getProjectRecordById(input.projectId) : null) ||
    (input.projectPath ? findProjectRecordByPath(input.projectPath) : null);

  if (!project && !input.projectPath) {
    throw new Error("projectId or projectPath is required");
  }

  if (project?.githubOwner && project.githubRepo) {
    const issue = await githubRequest<GitHubIssue>(project, "/issues", {
      method: "POST",
      body: {
        title: input.title,
        body: input.description,
        labels: input.labels ?? [],
      },
    });

    const overlays = readOverlays();
    overlays[overlayKey(project.id, issue.number)] = {
      blockedBy: input.blockedBy ?? [],
      priority: input.priority ?? "medium",
      progress: 0,
      assignedAgentId: null,
      completionSummary: null,
      orderIndex: issue.number,
    };
    writeOverlays(overlays);

    return mapGitHubIssueToTask(project, issue, overlays[overlayKey(project.id, issue.number)]);
  }

  const timestamp = nowIso();
  const localTask: LocalKanbanTaskRecord = {
    id: randomUUID(),
    title: input.title,
    description: input.description,
    column: "backlog",
    projectId: project?.id ?? null,
    projectPath: project?.localPath ?? input.projectPath ?? "",
    blockedBy: input.blockedBy ?? [],
    priority: input.priority ?? "medium",
    progress: 0,
    orderIndex: Date.now(),
    labels: input.labels ?? [],
    completionSummary: null,
    assignedAgentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const tasks = readLocalTasks();
  tasks.push(localTask);
  writeLocalTasks(tasks);
  return withTaskRelations({ ...localTask, id: `local:${localTask.id}`, sourceType: "local", sourceId: localTask.id });
}

function setOverlay(
  projectId: string,
  issueNumber: number,
  patch: Partial<KanbanOverlayRecord>
): KanbanOverlayRecord {
  const overlays = readOverlays();
  const key = overlayKey(projectId, issueNumber);
  const next = {
    ...overlays[key],
    ...patch,
  };
  overlays[key] = next;
  writeOverlays(overlays);
  return next;
}

function deleteOverlay(projectId: string, issueNumber: number): void {
  const overlays = readOverlays();
  const key = overlayKey(projectId, issueNumber);
  if (!(key in overlays)) {
    return;
  }

  delete overlays[key];
  writeOverlays(overlays);
}

export function handleGitHubIssueWebhookEvent(
  projectId: string,
  action: string,
  issueNumber: number
): { taskId: string } {
  updateProjectRecord(projectId, {
    lastSyncedAt: nowIso(),
    lastSyncError: null,
  });

  if (action === "deleted") {
    deleteOverlay(projectId, issueNumber);
  }

  return {
    taskId: buildGitHubTaskId(projectId, issueNumber),
  };
}

function extractLinkedIssueNumber(text: string | null | undefined): number | null {
  if (!text) {
    return null;
  }

  const match = text.match(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i);
  if (!match) {
    return null;
  }

  const issueNumber = Number(match[1]);
  return Number.isFinite(issueNumber) ? issueNumber : null;
}

export function handleGitHubPullRequestWebhookEvent(
  projectId: string,
  action: string,
  pullRequest: {
    number: number;
    htmlUrl: string;
    body?: string | null;
    merged?: boolean;
  }
): { taskId: string | null } {
  updateProjectRecord(projectId, {
    lastSyncedAt: nowIso(),
    lastSyncError: null,
  });

  const issueNumber = extractLinkedIssueNumber(pullRequest.body);
  if (!issueNumber) {
    return { taskId: null };
  }

  if (
    action === "opened" ||
    action === "reopened" ||
    action === "synchronize" ||
    action === "ready_for_review"
  ) {
    setOverlay(projectId, issueNumber, {
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.htmlUrl,
    });
  } else if (action === "closed" && !pullRequest.merged) {
    setOverlay(projectId, issueNumber, {
      pullRequestNumber: null,
      pullRequestUrl: null,
    });
  }

  return {
    taskId: buildGitHubTaskId(projectId, issueNumber),
  };
}

async function createOrUpdatePullRequestForTask(
  task: KanbanTaskRecord,
  project: ProjectRecord,
  issueNumber: number,
  gitPath: string
): Promise<GitHubPullRequest | null> {
  if (!project.githubOwner || !project.githubRepo) {
    return null;
  }

  const existingOverlay = getOverlay(project.id, issueNumber);
  if (existingOverlay?.pullRequestNumber && existingOverlay.pullRequestUrl) {
    return {
      number: existingOverlay.pullRequestNumber,
      html_url: existingOverlay.pullRequestUrl,
    };
  }

  runGit(gitPath, ["rev-parse", "--is-inside-work-tree"]);

  const currentBranch = runGit(gitPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const defaultBranch = project.defaultBranch || "main";
  const branchName =
    existingOverlay?.branchName ||
    (currentBranch !== "HEAD" && currentBranch !== defaultBranch
      ? currentBranch
      : `maestro/issue-${issueNumber}-${slugifyBranchPart(task.title)}`);
  if (currentBranch !== branchName) {
    const localBranch = runGit(gitPath, ["branch", "--list", branchName]);
    if (localBranch) {
      runGit(gitPath, ["checkout", branchName]);
    } else {
      runGit(gitPath, ["checkout", "-b", branchName]);
    }
  }

  setOverlay(project.id, issueNumber, {
    branchName,
  });

  if (!runGit(gitPath, ["status", "--porcelain"])) {
    return null;
  }

  runGit(gitPath, ["add", "-A"]);
  if (!runGit(gitPath, ["diff", "--cached", "--name-only"])) {
    return null;
  }

  runGit(gitPath, ["commit", "-m", `Resolve #${issueNumber}: ${task.title}`]);
  runGit(gitPath, ["push", "-u", "origin", branchName]);

  const findPullRequest = (): GitHubPullRequest | null => {
    const raw = runGhCommand(
      [
        "pr",
        "list",
        "--state",
        "open",
        "--head",
        branchName,
        "--json",
        "number,url",
        "--limit",
        "1",
      ],
      { cwd: gitPath }
    );
    const pulls = JSON.parse(raw) as GitHubPullRequestListItem[];
    const pull = pulls[0];
    return pull
      ? {
          number: pull.number,
          html_url: pull.url,
        }
      : null;
  };

  let pullRequest = findPullRequest();
  if (!pullRequest) {
    runGhCommand(
      [
        "pr",
        "create",
        "--base",
        project.defaultBranch || "main",
        "--head",
        branchName,
        "--title",
        `Resolve #${issueNumber}: ${task.title}`,
        "--body",
        `Fixes #${issueNumber}\n\nAutomated by Maestro.`,
      ],
      { cwd: gitPath }
    );
    pullRequest = findPullRequest();
  }

  if (!pullRequest) {
    throw new Error(`Failed to create or locate PR for branch ${branchName}`);
  }

  setOverlay(project.id, issueNumber, {
    branchName,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.html_url,
  });

  return pullRequest;
}

export async function finalizeKanbanTaskAfterAgentExit(
  agentId: string,
  taskId: string,
  successful: boolean
): Promise<{ taskId: string; column: KanbanTaskRecord["column"] }> {
  const task = await getKanbanTask(taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  if (!successful) {
    const resetTask = await updateKanbanTaskRecord(task.id, {
      column: "planned",
      assignedAgentId: null,
      completionSummary: "Agent run failed. Task moved back to planned.",
    });
    return { taskId: resetTask.id, column: resetTask.column };
  }

  if (task.sourceType === "local") {
    const completedTask = await updateKanbanTaskRecord(task.id, {
      column: "done",
      progress: 100,
      assignedAgentId: agentId,
    });
    return { taskId: completedTask.id, column: completedTask.column };
  }

  const parsed = parseGitHubTaskId(task.id);
  if (!parsed) {
    throw new Error("Task is not linked to a GitHub issue");
  }

  const project = getProjectRecordById(parsed.projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const agent = getTerminalRecord(agentId);
  const gitPath = agent?.worktreePath || agent?.projectPath || project.localPath;

  const pullRequest = await createOrUpdatePullRequestForTask(
    task,
    project,
    parsed.issueNumber,
    gitPath
  );
  const nextTask = await updateKanbanTaskRecord(task.id, {
    column: pullRequest ? "review" : "done",
    progress: 100,
    assignedAgentId: agentId,
    completionSummary: pullRequest
      ? `Opened PR #${pullRequest.number}`
      : "Completed without code changes.",
  });

  return { taskId: nextTask.id, column: nextTask.column };
}

function updateLocalTask(
  taskId: string,
  patch: Partial<LocalKanbanTaskRecord>
): LocalKanbanTaskRecord {
  const tasks = readLocalTasks();
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) {
    throw new Error("Task not found");
  }

  const next: LocalKanbanTaskRecord = {
    ...tasks[index],
    ...patch,
    updatedAt: nowIso(),
  };
  tasks[index] = next;
  writeLocalTasks(tasks);
  return next;
}

export async function updateKanbanTaskRecord(
  taskId: string,
  patch: {
    title?: string;
    description?: string;
    column?: "backlog" | "planned" | "ongoing" | "review" | "done";
    priority?: "low" | "medium" | "high";
    progress?: number;
    labels?: string[];
    blockedBy?: string[];
    completionSummary?: string;
    assignedAgentId?: string | null;
  }
): Promise<KanbanTaskRecord> {
  if (taskId.startsWith("local:")) {
    const task = updateLocalTask(taskId.replace(/^local:/, ""), {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.column !== undefined ? { column: patch.column } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
      ...(patch.labels !== undefined ? { labels: patch.labels } : {}),
      ...(patch.blockedBy !== undefined ? { blockedBy: patch.blockedBy } : {}),
      ...(patch.completionSummary !== undefined
        ? { completionSummary: patch.completionSummary }
        : {}),
      ...(patch.assignedAgentId !== undefined ? { assignedAgentId: patch.assignedAgentId } : {}),
    });
    return withTaskRelations({
      ...task,
      id: `local:${task.id}`,
      blockedBy: task.blockedBy ?? [],
      sourceType: "local",
      sourceId: task.id,
      pullRequestNumber: task.pullRequestNumber ?? null,
      pullRequestUrl: task.pullRequestUrl ?? null,
    });
  }

  const parsed = parseGitHubTaskId(taskId);
  if (!parsed) {
    throw new Error("Task not found");
  }

  const project = getProjectRecordById(parsed.projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const current = await getGitHubIssue(project, parsed.issueNumber);
  const existingLabels = current.labels
    .map((label) => label.name)
    .filter((name) => !STATUS_LABEL_SET.has(name));

  const nextColumn = patch.column ?? getColumnForIssue(current);
  const nextLabels = patch.labels ?? existingLabels;
  const statusLabels =
    nextColumn === "planned"
      ? [STATUS_LABELS.planned]
    : nextColumn === "ongoing"
        ? [STATUS_LABELS.ongoing]
      : nextColumn === "review"
        ? [STATUS_LABELS.review]
        : [];

  const issue = await patchGitHubIssue(project, parsed.issueNumber, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { body: patch.description } : {}),
    labels: [...nextLabels, ...statusLabels],
    state: nextColumn === "done" ? "closed" : "open",
  });

  const overlay = setOverlay(project.id, parsed.issueNumber, {
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    ...(patch.blockedBy !== undefined ? { blockedBy: patch.blockedBy } : {}),
    ...(patch.completionSummary !== undefined
      ? { completionSummary: patch.completionSummary }
      : {}),
    ...(patch.assignedAgentId !== undefined ? { assignedAgentId: patch.assignedAgentId } : {}),
  });

  return mapGitHubIssueToTask(project, issue, overlay);
}

export async function moveKanbanTaskRecord(
  taskId: string,
  column: "backlog" | "planned" | "ongoing" | "review" | "done"
): Promise<KanbanTaskRecord> {
  return updateKanbanTaskRecord(taskId, {
    column,
    ...(column === "done" ? { progress: 100 } : {}),
    ...(column === "backlog" ? { assignedAgentId: null } : {}),
  });
}

export async function deleteKanbanTaskRecord(taskId: string): Promise<void> {
  if (taskId.startsWith("local:")) {
    writeLocalTasks(
      readLocalTasks().filter((task) => `local:${task.id}` !== taskId)
    );
    return;
  }

  const parsed = parseGitHubTaskId(taskId);
  if (!parsed) {
    throw new Error("Task not found");
  }

  const project = getProjectRecordById(parsed.projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  await patchGitHubIssue(project, parsed.issueNumber, {
    state: "closed",
  });
}

export function deleteKanbanStateForProject(
  projectId: string,
  projectPath?: string
): void {
  const overlays = readOverlays();
  const nextOverlays = Object.fromEntries(
    Object.entries(overlays).filter(([key]) => !key.startsWith(`${projectId}#`))
  );
  writeOverlays(nextOverlays);
  writeLocalTasks(
    readLocalTasks().filter(
      (task) => task.projectId !== projectId && (!projectPath || task.projectPath !== projectPath)
    )
  );
}
