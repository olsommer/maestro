import test from "node:test";
import assert from "node:assert/strict";
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
