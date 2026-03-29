import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeProvider, CodexProvider } from "./providers.js";

test("codex kanban and scheduler spawns use the yolo alias before the prompt", () => {
  const provider = new CodexProvider();

  assert.equal(
    provider.buildInteractiveCommand({
      binaryPath: "codex",
      prompt: "ship it",
      projectPath: "/tmp/project",
      kind: "kanban",
      skipPermissions: true,
      sandbox: false,
    }),
    "'codex' exec --yolo 'ship it'"
  );

  assert.equal(
    provider.buildInteractiveCommand({
      binaryPath: "codex",
      prompt: "ship it",
      projectPath: "/tmp/project",
      kind: "scheduler",
      skipPermissions: true,
      sandbox: false,
    }),
    "'codex' exec --yolo 'ship it'"
  );
});

test("claude kanban and scheduler spawns place skip-permissions in the option list", () => {
  const provider = new ClaudeProvider();

  assert.equal(
    provider.buildInteractiveCommand({
      binaryPath: "claude",
      prompt: "ship it",
      projectPath: "/tmp/project",
      kind: "kanban",
      skipPermissions: true,
      sandbox: false,
    }),
    "'claude' --dangerously-skip-permissions -p 'ship it'"
  );

  assert.equal(
    provider.buildInteractiveCommand({
      binaryPath: "claude",
      prompt: "ship it",
      projectPath: "/tmp/project",
      kind: "scheduler",
      skipPermissions: true,
      sandbox: false,
    }),
    "'claude' --dangerously-skip-permissions -p 'ship it'"
  );
});

test("manual claude and codex terminals keep the existing sandbox-gated permission flags", () => {
  const codex = new CodexProvider();
  const claude = new ClaudeProvider();

  assert.equal(
    codex.buildInteractiveCommand({
      binaryPath: "codex",
      prompt: "ship it",
      projectPath: "/tmp/project",
      kind: "terminal",
      skipPermissions: true,
      sandbox: false,
    }),
    "'codex' exec 'ship it'"
  );

  assert.equal(
    claude.buildInteractiveCommand({
      binaryPath: "claude",
      prompt: "ship it",
      projectPath: "/tmp/project",
      kind: "terminal",
      skipPermissions: true,
      sandbox: false,
    }),
    "'claude' -p 'ship it'"
  );
});
