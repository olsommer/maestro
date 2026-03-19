import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ProjectCreateInput } from "@maestro/wire";
import {
  deleteTerminal,
} from "../agents/terminal-manager.js";
import { unregisterJob } from "../scheduler/scheduler.js";
import { listTerminalRecords } from "../state/terminals.js";
import { deleteKanbanStateForProject, probeGitHubMirror } from "../state/kanban.js";
import {
  createProjectRecord,
  findProjectRecordByPath,
  getProjectRecordById,
  getProjectRecordBySlug,
  listProjectRecords,
  removeProjectRecord,
  updateProjectRecord,
} from "../state/projects.js";
import {
  deleteAutomationRecord,
  deleteScheduledTaskRecord,
  listAutomationRecords,
  listScheduledTaskRecords,
} from "../state/sqlite.js";
import type { ProjectRecord } from "../state/types.js";

const MANAGED_PROJECTS_DIR = path.join(os.homedir(), "maestro-projects");

interface GitHubRepoParts {
  repoUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function parseGitHubRepo(
  repoUrl?: string,
  githubOwner?: string,
  githubRepo?: string
): GitHubRepoParts {
  if (githubOwner && githubRepo) {
    return {
      repoUrl: repoUrl ?? `https://github.com/${githubOwner}/${githubRepo}.git`,
      githubOwner,
      githubRepo: stripGitSuffix(githubRepo),
    };
  }

  const raw = repoUrl?.trim();
  if (!raw) {
    return {
      repoUrl: null,
      githubOwner: null,
      githubRepo: null,
    };
  }

  const normalized = stripGitSuffix(
    raw.replace(/^git@github\.com:/, "https://github.com/")
  );
  const match = normalized.match(
    /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)$|^(?<shortOwner>[^/\s]+)\/(?<shortRepo>[^/\s]+)$/
  );

  const owner = match?.groups?.owner ?? match?.groups?.shortOwner ?? null;
  const repo = match?.groups?.repo ?? match?.groups?.shortRepo ?? null;

  return {
    repoUrl: owner && repo ? `https://github.com/${owner}/${repo}.git` : raw,
    githubOwner: owner,
    githubRepo: repo,
  };
}

function getUniqueSlug(name: string): string {
  const base = slugify(name);
  let slug = base;
  let counter = 2;

  while (getProjectRecordBySlug(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }

  return slug;
}

function deriveLocalPath(
  localPath: string | undefined,
  name: string,
  githubRepo: string | null
): string {
  if (localPath?.trim()) {
    return path.resolve(localPath.trim());
  }

  return path.join(MANAGED_PROJECTS_DIR, slugify(githubRepo || name));
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return listProjectRecords();
}

export async function getProjectById(projectId: string): Promise<ProjectRecord | null> {
  return getProjectRecordById(projectId);
}

export async function resolveProjectContext(input: {
  projectId?: string | null;
  projectPath?: string | null;
}): Promise<{
  project: ProjectRecord | null;
  projectId: string | null;
  projectPath: string;
}> {
  let project: ProjectRecord | null = null;

  if (input.projectId) {
    project = getProjectRecordById(input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
  } else if (input.projectPath) {
    project = findProjectRecordByPath(input.projectPath);
  }

  const projectPath = project?.localPath || input.projectPath?.trim();
  if (!projectPath) {
    throw new Error("projectId or projectPath is required");
  }

  return {
    project,
    projectId: project?.id ?? input.projectId ?? null,
    projectPath,
  };
}

export async function syncGitHubIssues(
  projectId: string
): Promise<{ syncedCount: number }> {
  return probeGitHubMirror(projectId);
}

export async function deleteProject(projectId: string): Promise<void> {
  const project = getProjectRecordById(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const agents = listTerminalRecords().filter(
    (agent) => agent.projectId === projectId || agent.projectPath === project.localPath
  );
  for (const agent of agents) {
    await deleteTerminal(agent.id);
  }

  for (const task of listScheduledTaskRecords().filter(
    (task) => task.projectId === projectId || task.projectPath === project.localPath
  )) {
    unregisterJob(task.id);
    deleteScheduledTaskRecord(task.id);
  }

  for (const automation of listAutomationRecords().filter(
    (record) =>
      record.agentProjectId === projectId ||
      record.agentProjectPath === project.localPath
  )) {
    deleteAutomationRecord(automation.id);
  }

  deleteKanbanStateForProject(projectId, project.localPath);
  removeProjectRecord(projectId);
}

export async function createProject(
  input: ProjectCreateInput
): Promise<ProjectRecord> {
  const repo = parseGitHubRepo(input.repoUrl, input.githubOwner, input.githubRepo);
  const slug = getUniqueSlug(input.name);
  const localPath = deriveLocalPath(input.localPath, input.name, repo.githubRepo);

  fs.mkdirSync(localPath, { recursive: true });

  const project = createProjectRecord({
    name: input.name.trim(),
    slug,
    repoUrl: repo.repoUrl,
    githubOwner: repo.githubOwner,
    githubRepo: repo.githubRepo,
    defaultBranch: input.defaultBranch?.trim() || null,
    localPath,
    status: "ready",
    lastSyncedAt: null,
    lastSyncError: null,
  });

  if (input.syncIssues && project.githubOwner && project.githubRepo) {
    try {
      await syncGitHubIssues(project.id);
    } catch {
      // Preserve the project and surface sync errors through lastSyncError.
    }
  }

  return (await getProjectById(project.id)) ?? project;
}
