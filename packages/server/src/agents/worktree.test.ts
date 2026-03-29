import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

test("defaults auto-worktrees under the sandbox state tree", async () => {
  const previousBase = process.env.MAESTRO_WORKTREE_BASE;
  delete process.env.MAESTRO_WORKTREE_BASE;

  try {
    const { getWorktreeBasePath } = await import(`./worktree.js?test=${Date.now()}`);
    assert.equal(
      getWorktreeBasePath(),
      path.join(os.homedir(), ".maestro", "sandboxes", "worktrees")
    );
  } finally {
    if (previousBase === undefined) {
      delete process.env.MAESTRO_WORKTREE_BASE;
    } else {
      process.env.MAESTRO_WORKTREE_BASE = previousBase;
    }
  }
});

test("resolves linked worktree git admin paths for sandbox mounts", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-worktree-"));
  const projectGitDir = path.join(tempRoot, "project", ".git");
  const gitdir = path.join(projectGitDir, "worktrees", "agent-123");
  const worktreeDir = path.join(tempRoot, "worktree");

  fs.mkdirSync(gitdir, { recursive: true });
  fs.mkdirSync(worktreeDir, { recursive: true });
  fs.writeFileSync(path.join(worktreeDir, ".git"), `gitdir: ${gitdir}\n`);
  fs.writeFileSync(path.join(gitdir, "commondir"), "../..\n");

  try {
    const { getWorktreeGitMountPaths } = await import(`./worktree.js?test=${Date.now()}`);
    assert.deepEqual(getWorktreeGitMountPaths(worktreeDir), [gitdir, projectGitDir]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("does not request extra mounts for regular git checkouts", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-worktree-"));
  const worktreeDir = path.join(tempRoot, "repo");
  const gitDir = path.join(worktreeDir, ".git");

  fs.mkdirSync(gitDir, { recursive: true });

  try {
    const { getWorktreeGitMountPaths } = await import(`./worktree.js?test=${Date.now()}`);
    assert.deepEqual(getWorktreeGitMountPaths(worktreeDir), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
