import * as path from "path";
import { randomUUID } from "crypto";
import { ensureDataDir, nowIso, readJsonFile, writeJsonFile } from "./files.js";
import type { ProjectRecord } from "./types.js";

const PROJECTS_PATH = path.join(ensureDataDir(), "projects.json");

function readProjects(): ProjectRecord[] {
  return readJsonFile<ProjectRecord[]>(PROJECTS_PATH, []);
}

function writeProjects(projects: ProjectRecord[]): void {
  writeJsonFile(PROJECTS_PATH, projects);
}

export function listProjectRecords(): ProjectRecord[] {
  return readProjects().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getProjectRecordById(projectId: string): ProjectRecord | null {
  return readProjects().find((project) => project.id === projectId) ?? null;
}

export function getProjectRecordBySlug(slug: string): ProjectRecord | null {
  return readProjects().find((project) => project.slug === slug) ?? null;
}

export function findProjectRecordByPath(projectPath: string): ProjectRecord | null {
  return readProjects().find((project) => project.localPath === projectPath) ?? null;
}

export function findProjectRecordByGitHubRepo(
  githubOwner: string,
  githubRepo: string
): ProjectRecord | null {
  const owner = githubOwner.trim().toLowerCase();
  const repo = githubRepo.trim().toLowerCase();

  return (
    readProjects().find(
      (project) =>
        project.githubOwner?.toLowerCase() === owner &&
        project.githubRepo?.toLowerCase() === repo
    ) ?? null
  );
}

export function createProjectRecord(
  data: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt">
): ProjectRecord {
  const timestamp = nowIso();
  const project: ProjectRecord = {
    id: randomUUID(),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const projects = readProjects();
  projects.push(project);
  writeProjects(projects);
  return project;
}

export function updateProjectRecord(
  projectId: string,
  patch: Partial<Omit<ProjectRecord, "id" | "createdAt">>
): ProjectRecord {
  const projects = readProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index === -1) {
    throw new Error("Project not found");
  }

  const next: ProjectRecord = {
    ...projects[index],
    ...patch,
    updatedAt: nowIso(),
  };
  projects[index] = next;
  writeProjects(projects);
  return next;
}

export function removeProjectRecord(projectId: string): void {
  writeProjects(readProjects().filter((project) => project.id !== projectId));
}
