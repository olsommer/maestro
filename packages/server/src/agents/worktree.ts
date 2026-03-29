import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { MAESTRO_SANDBOX_WORKTREES_DIR } from "../state/files.js";

const DEFAULT_WORKTREE_BASE = MAESTRO_SANDBOX_WORKTREES_DIR;
const WORKTREE_BASE = process.env.MAESTRO_WORKTREE_BASE?.trim() || DEFAULT_WORKTREE_BASE;

export function getWorktreeBasePath(): string {
  return WORKTREE_BASE;
}

function readGitdirPointer(worktreePath: string): string | null {
  const gitPath = path.join(worktreePath, ".git");
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      return gitPath;
    }
    if (!stat.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const contents = fs.readFileSync(gitPath, "utf8");
  const match = /^gitdir:\s*(.+)\s*$/im.exec(contents);
  if (!match) {
    return null;
  }

  const resolved = path.resolve(worktreePath, match[1]);
  return fs.existsSync(resolved) ? resolved : null;
}

function readCommonDir(gitdir: string): string | null {
  const commondirPath = path.join(gitdir, "commondir");
  if (!fs.existsSync(commondirPath)) {
    return null;
  }

  try {
    const contents = fs.readFileSync(commondirPath, "utf8").trim();
    if (!contents) {
      return null;
    }

    const resolved = path.resolve(gitdir, contents);
    return fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

export function getWorktreeGitMountPaths(worktreePath: string): string[] {
  const gitdir = readGitdirPointer(worktreePath);
  if (!gitdir) {
    return [];
  }

  const mountPaths = new Set<string>([gitdir]);
  const commonDir = readCommonDir(gitdir);
  if (commonDir) {
    mountPaths.add(commonDir);
  }

  const resolvedWorktreePath = path.resolve(worktreePath);
  return Array.from(mountPaths).filter((mountPath) => {
    const resolvedMountPath = path.resolve(mountPath);
    if (resolvedMountPath === resolvedWorktreePath) {
      return false;
    }
    return !resolvedMountPath.startsWith(`${resolvedWorktreePath}${path.sep}`);
  });
}

/**
 * Create a git worktree for a terminal.
 * Creates a new branch `agent/<terminalId>` from the requested git ref.
 * Returns the absolute path to the new worktree.
 */
export function createTerminalWorktree(
  projectPath: string,
  terminalId: string,
  startPoint = "HEAD"
): string {
  const worktreeDir = path.join(WORKTREE_BASE, terminalId);
  const branchName = `agent/${terminalId}`;

  // Ensure base directory exists
  fs.mkdirSync(WORKTREE_BASE, { recursive: true });

  // Drop stale worktree metadata first so missing /tmp directories don't block recovery.
  try {
    execSync("git worktree prune", { cwd: projectPath, stdio: "ignore" });
  } catch {
    // Best effort
  }

  // Clean up stale worktree at this path if it exists
  if (fs.existsSync(worktreeDir)) {
    try {
      execSync(`git worktree remove --force ${JSON.stringify(worktreeDir)}`, {
        cwd: projectPath,
        stdio: "ignore",
      });
    } catch {
      // May fail if the main repo moved; force-remove the directory
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  }

  // Delete the branch if it already exists (stale from a previous agent)
  try {
    execSync(`git branch -D ${JSON.stringify(branchName)}`, {
      cwd: projectPath,
      stdio: "ignore",
    });
  } catch {
    // Branch doesn't exist — fine
  }

  // Create the worktree with a new branch from the requested start point.
  execSync(
    `git worktree add -b ${JSON.stringify(branchName)} ${JSON.stringify(worktreeDir)} ${JSON.stringify(startPoint)}`,
    { cwd: projectPath, stdio: "pipe" }
  );

  console.log(
    `Created worktree for terminal ${terminalId}: ${worktreeDir} (branch: ${branchName})`
  );

  return worktreeDir;
}

/**
 * Remove a git worktree created for a terminal.
 * Also deletes the associated branch.
 */
export function removeTerminalWorktree(
  projectPath: string,
  terminalId: string
): void {
  const worktreeDir = path.join(WORKTREE_BASE, terminalId);
  const branchName = `agent/${terminalId}`;

  // Remove the worktree
  if (fs.existsSync(worktreeDir)) {
    try {
      execSync(
        `git worktree remove --force ${JSON.stringify(worktreeDir)}`,
        { cwd: projectPath, stdio: "ignore" }
      );
    } catch {
      // Fallback: just delete the directory
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  }

  // Prune stale worktree references
  try {
    execSync("git worktree prune", { cwd: projectPath, stdio: "ignore" });
  } catch {
    // Best effort
  }

  // Delete the branch
  try {
    execSync(`git branch -D ${JSON.stringify(branchName)}`, {
      cwd: projectPath,
      stdio: "ignore",
    });
  } catch {
    // Branch may already be gone
  }

  console.log(`Removed worktree for terminal ${terminalId}`);
}

/**
 * Check if a project path is a git repository.
 */
export function isGitRepo(projectPath: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: projectPath,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}
