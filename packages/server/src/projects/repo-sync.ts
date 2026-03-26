import { execFileSync } from "node:child_process";
import {
  findProjectRecordByPath,
  getProjectRecordById,
  updateProjectRecord,
} from "../state/projects.js";
import type { ProjectRecord } from "../state/types.js";

export interface RepoSyncDecisionInput {
  currentBranch: string;
  upstreamRef: string | null;
  isDirty: boolean;
  localHead: string | null;
  upstreamHead: string | null;
  mergeBase: string | null;
}

export interface RepoSyncDecision {
  action: "skip" | "noop" | "fast-forward";
  reason: string;
}

export interface AutoWorktreeStartPointInput {
  currentBranch: string;
  upstreamRef: string | null;
  preferredBranch: string | null;
  preferredBranchExists: boolean;
}

export interface AutoWorktreeStartPoint {
  ref: string;
  usedRemote: boolean;
  reason: string;
}

function readCommandError(error: unknown, fallback: string): string {
  if (error instanceof Error && "stderr" in error && typeof error.stderr === "string") {
    const stderr = error.stderr.trim();
    if (stderr) {
      return stderr;
    }
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

function runGit(path: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: path,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryRunGit(path: string, args: string[]): { ok: true; output: string } | {
  ok: false;
  error: string;
} {
  try {
    return { ok: true, output: runGit(path, args) };
  } catch (error) {
    return {
      ok: false,
      error: readCommandError(error, `git ${args.join(" ")} failed`),
    };
  }
}

function resolveProjectRecord(input: {
  projectId?: string | null;
  projectPath: string;
}): ProjectRecord | null {
  if (input.projectId) {
    return getProjectRecordById(input.projectId);
  }

  return findProjectRecordByPath(input.projectPath);
}

function shouldPersistSyncStatus(project: ProjectRecord | null): boolean {
  return Boolean(project && (project.repoUrl || (project.githubOwner && project.githubRepo)));
}

function persistSyncSuccess(project: ProjectRecord | null) {
  if (!project || !shouldPersistSyncStatus(project)) {
    return;
  }

  updateProjectRecord(project.id, {
    lastSyncedAt: new Date().toISOString(),
    lastSyncError: null,
  });
}

function persistSyncError(project: ProjectRecord | null, message: string) {
  if (!project || !shouldPersistSyncStatus(project)) {
    return;
  }

  updateProjectRecord(project.id, {
    lastSyncError: message,
  });
}

export function decideRepoSyncAction(input: RepoSyncDecisionInput): RepoSyncDecision {
  if (input.currentBranch === "HEAD") {
    return {
      action: "skip",
      reason: "Skipped pre-spawn sync because the repository is in detached HEAD state.",
    };
  }

  if (!input.upstreamRef) {
    return {
      action: "skip",
      reason: "Skipped pre-spawn sync because the current branch has no upstream branch.",
    };
  }

  if (input.isDirty) {
    return {
      action: "skip",
      reason: "Skipped pre-spawn sync because the repository has uncommitted changes.",
    };
  }

  if (!input.localHead || !input.upstreamHead || !input.mergeBase) {
    return {
      action: "skip",
      reason: "Skipped pre-spawn sync because the repository state could not be resolved.",
    };
  }

  if (input.localHead === input.upstreamHead) {
    return {
      action: "noop",
      reason: "Repository is already up to date with its upstream branch.",
    };
  }

  if (input.mergeBase === input.localHead) {
    return {
      action: "fast-forward",
      reason: `Fast-forwarded ${input.currentBranch} to ${input.upstreamRef}.`,
    };
  }

  if (input.mergeBase === input.upstreamHead) {
    return {
      action: "noop",
      reason: "Repository is ahead of its upstream branch; no fast-forward was needed.",
    };
  }

  return {
    action: "skip",
    reason: "Skipped pre-spawn sync because the local branch has diverged from upstream.",
  };
}

export function decideAutoWorktreeStartPoint(
  input: AutoWorktreeStartPointInput
): AutoWorktreeStartPoint {
  const preferredBranch = input.preferredBranch?.trim() || null;
  if (preferredBranch && input.preferredBranchExists) {
    return {
      ref: `origin/${preferredBranch}`,
      usedRemote: true,
      reason: `Using latest origin/${preferredBranch} in a fresh worktree.`,
    };
  }

  if (input.upstreamRef) {
    return {
      ref: input.upstreamRef,
      usedRemote: true,
      reason: `Using latest ${input.upstreamRef} in a fresh worktree.`,
    };
  }

  if (input.currentBranch !== "HEAD") {
    return {
      ref: input.currentBranch,
      usedRemote: false,
      reason: `Using local ${input.currentBranch} in a fresh worktree because no remote tracking branch was available.`,
    };
  }

  return {
    ref: "HEAD",
    usedRemote: false,
    reason: "Using local HEAD in a fresh worktree because no remote tracking branch was available.",
  };
}

function resolveUpstreamRef(path: string, currentBranch: string): string | null {
  const upstream = tryRunGit(path, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  if (upstream.ok && upstream.output) {
    return upstream.output;
  }

  const originBranch = `refs/remotes/origin/${currentBranch}`;
  const remoteBranch = tryRunGit(path, ["show-ref", "--verify", "--quiet", originBranch]);
  if (remoteBranch.ok) {
    return `origin/${currentBranch}`;
  }

  return null;
}

function hasGitRef(path: string, ref: string): boolean {
  return tryRunGit(path, ["show-ref", "--verify", "--quiet", ref]).ok;
}

export async function resolveAutoWorktreeStartPoint(input: {
  projectId?: string | null;
  projectPath: string;
  preferredBranch?: string | null;
}): Promise<AutoWorktreeStartPoint> {
  const project = resolveProjectRecord(input);
  const insideWorkTree = tryRunGit(input.projectPath, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideWorkTree.ok) {
    const reason = "Auto-worktree requires the project path to be a git repository.";
    persistSyncError(project, reason);
    throw new Error(reason);
  }

  const currentBranch = tryRunGit(input.projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!currentBranch.ok) {
    const reason = `Pre-spawn sync failed while resolving the current branch: ${currentBranch.error}`;
    persistSyncError(project, reason);
    throw new Error(reason);
  }

  const origin = tryRunGit(input.projectPath, ["remote", "get-url", "origin"]);
  if (origin.ok && origin.output) {
    const fetch = tryRunGit(input.projectPath, ["fetch", "--prune", "origin"]);
    if (!fetch.ok) {
      const reason = `Pre-spawn sync failed during fetch: ${fetch.error}`;
      persistSyncError(project, reason);
      throw new Error(reason);
    }
  }

  const preferredBranch = input.preferredBranch?.trim() || project?.defaultBranch?.trim() || null;
  const preferredBranchExists = Boolean(
    preferredBranch && hasGitRef(input.projectPath, `refs/remotes/origin/${preferredBranch}`)
  );
  const upstreamRef = resolveUpstreamRef(input.projectPath, currentBranch.output);
  const decision = decideAutoWorktreeStartPoint({
    currentBranch: currentBranch.output,
    upstreamRef,
    preferredBranch,
    preferredBranchExists,
  });

  if (decision.usedRemote) {
    persistSyncSuccess(project);
  } else {
    persistSyncError(project, decision.reason);
  }

  return decision;
}

export async function syncProjectRepoBeforeSpawn(input: {
  projectId?: string | null;
  projectPath: string;
}): Promise<RepoSyncDecision> {
  const project = resolveProjectRecord(input);
  const insideWorkTree = tryRunGit(input.projectPath, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideWorkTree.ok) {
    const reason = "Skipped pre-spawn sync because the project path is not a git repository.";
    persistSyncError(project, reason);
    return { action: "skip", reason };
  }

  const origin = tryRunGit(input.projectPath, ["remote", "get-url", "origin"]);
  if (!origin.ok || !origin.output) {
    const reason = "Skipped pre-spawn sync because the repository has no origin remote.";
    persistSyncError(project, reason);
    return { action: "skip", reason };
  }

  const fetch = tryRunGit(input.projectPath, ["fetch", "--prune", "origin"]);
  if (!fetch.ok) {
    const reason = `Pre-spawn sync failed during fetch: ${fetch.error}`;
    persistSyncError(project, reason);
    return { action: "skip", reason };
  }

  const currentBranch = tryRunGit(input.projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!currentBranch.ok) {
    const reason = `Pre-spawn sync failed while resolving the current branch: ${currentBranch.error}`;
    persistSyncError(project, reason);
    return { action: "skip", reason };
  }

  const upstreamRef = resolveUpstreamRef(input.projectPath, currentBranch.output);
  const isDirty = Boolean(runGit(input.projectPath, ["status", "--porcelain"]));
  const localHead = tryRunGit(input.projectPath, ["rev-parse", "HEAD"]);
  const upstreamHead = upstreamRef
    ? tryRunGit(input.projectPath, ["rev-parse", upstreamRef])
    : null;
  const mergeBase =
    upstreamRef && localHead.ok && upstreamHead?.ok
      ? tryRunGit(input.projectPath, ["merge-base", "HEAD", upstreamRef])
      : null;

  const decision = decideRepoSyncAction({
    currentBranch: currentBranch.output,
    upstreamRef,
    isDirty,
    localHead: localHead.ok ? localHead.output : null,
    upstreamHead: upstreamHead?.ok ? upstreamHead.output : null,
    mergeBase: mergeBase?.ok ? mergeBase.output : null,
  });

  if (decision.action === "fast-forward") {
    const fastForward = tryRunGit(input.projectPath, ["merge", "--ff-only", upstreamRef!]);
    if (!fastForward.ok) {
      const reason = `Pre-spawn sync failed during fast-forward: ${fastForward.error}`;
      persistSyncError(project, reason);
      return { action: "skip", reason };
    }
  }

  if (decision.action === "skip") {
    persistSyncError(project, decision.reason);
  } else {
    persistSyncSuccess(project);
  }

  return decision;
}
