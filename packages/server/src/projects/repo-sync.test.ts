import test from "node:test";
import assert from "node:assert/strict";
import { decideRepoSyncAction } from "./repo-sync.js";

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
