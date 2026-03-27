import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "node:child_process";
import type { ProjectCreateInput } from "@maestro/wire";
import {
  deleteTerminal,
} from "../agents/terminal-manager.js";
import { resolveGitHubToken, runGhCommand } from "../integrations/github.js";
import { unregisterJob } from "../scheduler/scheduler.js";
import { listTerminalRecords } from "../state/terminals.js";
import { deleteKanbanStateForProject, probeGitHubMirror } from "../state/kanban.js";
import {
  createProjectRecord,
  findProjectRecordByGitHubRepo,
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
import { MAESTRO_PROJECTS_DIR } from "../state/files.js";
import type { ProjectRecord } from "../state/types.js";

const LEGACY_MANAGED_PROJECTS_DIR = path.join(os.homedir(), "maestro-projects");
const MANAGED_PROJECTS_DIR = MAESTRO_PROJECTS_DIR;

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

function ensureManagedProjectsDir(): string {
  if (fs.existsSync(MANAGED_PROJECTS_DIR)) {
    return MANAGED_PROJECTS_DIR;
  }

  if (fs.existsSync(LEGACY_MANAGED_PROJECTS_DIR)) {
    fs.mkdirSync(path.dirname(MANAGED_PROJECTS_DIR), { recursive: true });
    fs.renameSync(LEGACY_MANAGED_PROJECTS_DIR, MANAGED_PROJECTS_DIR);
    console.log(
      `Migrated managed projects directory from ${LEGACY_MANAGED_PROJECTS_DIR} to ${MANAGED_PROJECTS_DIR}`
    );
    return MANAGED_PROJECTS_DIR;
  }

  fs.mkdirSync(MANAGED_PROJECTS_DIR, { recursive: true });
  return MANAGED_PROJECTS_DIR;
}

function deriveLocalPath(
  localPath: string | undefined,
  name: string
): string {
  if (localPath?.trim()) {
    return path.resolve(localPath.trim());
  }

  return path.join(ensureManagedProjectsDir(), slugify(name));
}

function runGitCommand(args: string[]): void {
  try {
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new Error(stderr || `git ${args.join(" ")} failed`);
  }
}

function ensureProjectPathAvailable(localPath: string): void {
  const existingProject = findProjectRecordByPath(localPath);
  if (existingProject) {
    throw new Error(`A project already uses ${localPath}`);
  }

  if (!fs.existsSync(localPath)) {
    return;
  }

  const stat = fs.statSync(localPath);
  if (!stat.isDirectory()) {
    throw new Error(`Local path already exists and is not a directory: ${localPath}`);
  }

  if (fs.readdirSync(localPath).length > 0) {
    throw new Error(`Local path already exists and is not empty: ${localPath}`);
  }
}

function cloneRepository(
  repo: GitHubRepoParts,
  localPath: string,
  defaultBranch?: string
): void {
  if (!repo.repoUrl) {
    return;
  }

  const parentDir = path.dirname(localPath);
  fs.mkdirSync(parentDir, { recursive: true });
  ensureProjectPathAvailable(localPath);

  const branch = defaultBranch?.trim();
  const hasGitHubToken = Boolean(resolveGitHubToken().token);
  let ghCloneError: string | null = null;

  if (repo.githubOwner && repo.githubRepo && hasGitHubToken) {
    const ghArgs = ["repo", "clone", `${repo.githubOwner}/${repo.githubRepo}`, localPath];
    if (branch) {
      ghArgs.push("--", "--branch", branch);
    }

    try {
      runGhCommand(ghArgs);
      return;
    } catch (error) {
      if (fs.existsSync(localPath) && fs.readdirSync(localPath).length === 0) {
        fs.rmdirSync(localPath);
      }

      ghCloneError =
        error instanceof Error ? error.message : "gh repo clone failed";
    }
  }

  const gitArgs = ["clone"];
  if (branch) {
    gitArgs.push("--branch", branch);
  }
  gitArgs.push(repo.repoUrl, localPath);

  try {
    runGitCommand(gitArgs);
  } catch (error) {
    if (fs.existsSync(localPath) && fs.readdirSync(localPath).length === 0) {
      fs.rmdirSync(localPath);
    }

    const message = error instanceof Error ? error.message : "git clone failed";
    throw new Error(
      ghCloneError
        ? `Failed to clone repository. gh: ${ghCloneError}. git: ${message}`
        : `Failed to clone repository: ${message}`
    );
  }
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
  if (repo.githubOwner && repo.githubRepo) {
    const existingProject = findProjectRecordByGitHubRepo(
      repo.githubOwner,
      repo.githubRepo
    );
    if (existingProject) {
      throw new Error(
        `GitHub repository ${repo.githubOwner}/${repo.githubRepo} is already linked to ${existingProject.name}`
      );
    }
  }

  const slug = getUniqueSlug(input.name);
  const localPath = deriveLocalPath(input.localPath, input.name);

  if (repo.repoUrl) {
    cloneRepository(repo, localPath, input.defaultBranch);
  } else {
    fs.mkdirSync(localPath, { recursive: true });
  }

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
