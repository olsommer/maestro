import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const WORKTREE_BASE = "/tmp/maestro-worktrees";

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
