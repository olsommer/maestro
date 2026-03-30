import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prepareShellCommand, shouldDeleteTerminalDuringRestore } from "./terminal-manager.js";
import { buildStartupShellCommand } from "./pty-manager.js";

test("leaves manual terminal commands attached to the shell", () => {
  assert.equal(
    prepareShellCommand("'codex' exec 'ship it'", "terminal"),
    "'codex' exec 'ship it'"
  );
});

test("exits the shell after kanban commands finish", () => {
  assert.equal(
    prepareShellCommand("'codex' exec 'ship it'", "kanban"),
    "'codex' exec 'ship it'\n__maestro_exit_status=$?\nexit $__maestro_exit_status"
  );
});

test("exits the shell after scheduler and automation commands finish", () => {
  assert.equal(
    prepareShellCommand("'codex' exec 'ship it'", "scheduler"),
    "'codex' exec 'ship it'\n__maestro_exit_status=$?\nexit $__maestro_exit_status"
  );
  assert.equal(
    prepareShellCommand("'codex' exec 'ship it'", "automation"),
    "'codex' exec 'ship it'\n__maestro_exit_status=$?\nexit $__maestro_exit_status"
  );
});

test("keeps empty commands empty", () => {
  assert.equal(prepareShellCommand("   ", "kanban"), "");
});

test("keeps manual startup shells open after a successful startup command", () => {
  assert.equal(
    buildStartupShellCommand("'codex' exec 'ship it'", "/bin/bash", true),
    "'codex' exec 'ship it'\n__maestro_exit_status=$?\nif [ $__maestro_exit_status -eq 0 ]; then\n  exec '/bin/bash' -l\nfi\nexit $__maestro_exit_status"
  );
});

test("uses startup commands unchanged when the shell should not stay open", () => {
  assert.equal(
    buildStartupShellCommand(
      "'codex' exec 'ship it'\n__maestro_exit_status=$?\nexit $__maestro_exit_status",
      "/bin/bash",
      false
    ),
    "'codex' exec 'ship it'\n__maestro_exit_status=$?\nexit $__maestro_exit_status"
  );
});

test("deletes auto-worktree terminals during restore when the worktree path is missing", () => {
  assert.equal(
    shouldDeleteTerminalDuringRestore({
      id: "terminal-1",
      name: null,
      kind: "terminal",
      provider: "codex",
      projectId: null,
      projectPath: "/tmp/project",
      customDisplayName: null,
      customCommandTemplate: null,
      customEnv: null,
      sandboxProvider: null,
      secondaryProjectPaths: [],
      worktreePath: "/tmp/missing-worktree",
      autoWorktree: true,
      skills: [],
      status: "idle",
      startupStatus: null,
      currentTask: null,
      error: null,
      recentInputs: [],
      lastActivity: null,
      skipPermissions: false,
      disableSandbox: false,
      kanbanTaskId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    true
  );
});

test("keeps terminals during restore when the auto-worktree path still exists", () => {
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-terminal-restore-"));

  try {
    assert.equal(
      shouldDeleteTerminalDuringRestore({
        id: "terminal-2",
        name: null,
        kind: "terminal",
        provider: "codex",
        projectId: null,
        projectPath: "/tmp/project",
        customDisplayName: null,
        customCommandTemplate: null,
        customEnv: null,
        sandboxProvider: null,
        secondaryProjectPaths: [],
        worktreePath,
        autoWorktree: true,
        skills: [],
        status: "idle",
        startupStatus: null,
        currentTask: null,
        error: null,
        recentInputs: [],
        lastActivity: null,
        skipPermissions: false,
        disableSandbox: false,
        kanbanTaskId: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }),
      false
    );
  } finally {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
});
