import test from "node:test";
import assert from "node:assert/strict";
import { decideAutoWorktreeStartPoint, decideRepoSyncAction } from "./repo-sync.js";

test("skips sync for detached head", () => {
  assert.deepEqual(
    decideRepoSyncAction({
      currentBranch: "HEAD",
      upstreamRef: "origin/main",
      isDirty: false,
      localHead: "a",
      upstreamHead: "b",
      mergeBase: "a",
    }),
    {
      action: "skip",
      reason: "Skipped pre-spawn sync because the repository is in detached HEAD state.",
    }
  );
});

test("skips sync for dirty repos", () => {
  assert.deepEqual(
    decideRepoSyncAction({
      currentBranch: "main",
      upstreamRef: "origin/main",
      isDirty: true,
      localHead: "a",
      upstreamHead: "b",
      mergeBase: "a",
    }),
    {
      action: "skip",
      reason: "Skipped pre-spawn sync because the repository has uncommitted changes.",
    }
  );
});

test("fast-forwards when local branch is behind upstream", () => {
  assert.deepEqual(
    decideRepoSyncAction({
      currentBranch: "main",
      upstreamRef: "origin/main",
      isDirty: false,
      localHead: "a",
      upstreamHead: "b",
      mergeBase: "a",
    }),
    {
      action: "fast-forward",
      reason: "Fast-forwarded main to origin/main.",
    }
  );
});

test("does nothing when repository is already up to date", () => {
  assert.deepEqual(
    decideRepoSyncAction({
      currentBranch: "main",
      upstreamRef: "origin/main",
      isDirty: false,
      localHead: "a",
      upstreamHead: "a",
      mergeBase: "a",
    }),
    {
      action: "noop",
      reason: "Repository is already up to date with its upstream branch.",
    }
  );
});

test("does nothing when local branch is ahead of upstream", () => {
  assert.deepEqual(
    decideRepoSyncAction({
      currentBranch: "main",
      upstreamRef: "origin/main",
      isDirty: false,
      localHead: "b",
      upstreamHead: "a",
      mergeBase: "a",
    }),
    {
      action: "noop",
      reason: "Repository is ahead of its upstream branch; no fast-forward was needed.",
    }
  );
});

test("skips sync for diverged branches", () => {
  assert.deepEqual(
    decideRepoSyncAction({
      currentBranch: "main",
      upstreamRef: "origin/main",
      isDirty: false,
      localHead: "b",
      upstreamHead: "c",
      mergeBase: "a",
    }),
    {
      action: "skip",
      reason: "Skipped pre-spawn sync because the local branch has diverged from upstream.",
    }
  );
});

test("auto-worktree prefers the configured default branch on origin", () => {
  assert.deepEqual(
    decideAutoWorktreeStartPoint({
      currentBranch: "feature",
      upstreamRef: "origin/feature",
      preferredBranch: "main",
      preferredBranchExists: true,
    }),
    {
      ref: "origin/main",
      usedRemote: true,
      reason: "Using latest origin/main in a fresh worktree.",
    }
  );
});

test("auto-worktree falls back to the branch upstream when the default branch is unavailable", () => {
  assert.deepEqual(
    decideAutoWorktreeStartPoint({
      currentBranch: "feature",
      upstreamRef: "origin/feature",
      preferredBranch: "main",
      preferredBranchExists: false,
    }),
    {
      ref: "origin/feature",
      usedRemote: true,
      reason: "Using latest origin/feature in a fresh worktree.",
    }
  );
});

test("auto-worktree falls back to the local branch when no remote branch is available", () => {
  assert.deepEqual(
    decideAutoWorktreeStartPoint({
      currentBranch: "feature",
      upstreamRef: null,
      preferredBranch: "main",
      preferredBranchExists: false,
    }),
    {
      ref: "feature",
      usedRemote: false,
      reason:
        "Using local feature in a fresh worktree because no remote tracking branch was available.",
    }
  );
});

test("auto-worktree falls back to detached HEAD when no branch can be resolved", () => {
  assert.deepEqual(
    decideAutoWorktreeStartPoint({
      currentBranch: "HEAD",
      upstreamRef: null,
      preferredBranch: null,
      preferredBranchExists: false,
    }),
    {
      ref: "HEAD",
      usedRemote: false,
      reason:
        "Using local HEAD in a fresh worktree because no remote tracking branch was available.",
    }
  );
});
