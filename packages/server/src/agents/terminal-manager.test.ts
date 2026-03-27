import test from "node:test";
import assert from "node:assert/strict";
import { prepareShellCommand } from "./terminal-manager.js";

test("leaves manual terminal commands attached to the shell", () => {
  assert.equal(
    prepareShellCommand("'codex' exec 'ship it'", "terminal"),
    "'codex' exec 'ship it'"
  );
});

test("exits the shell after kanban commands finish", () => {
  assert.equal(
    prepareShellCommand("'codex' exec 'ship it'", "kanban"),
    "'codex' exec 'ship it'; exit $?"
  );
});

test("exits the shell after scheduler and automation commands finish", () => {
  assert.equal(
    prepareShellCommand("'codex' exec 'ship it'", "scheduler"),
    "'codex' exec 'ship it'; exit $?"
  );
  assert.equal(
    prepareShellCommand("'codex' exec 'ship it'", "automation"),
    "'codex' exec 'ship it'; exit $?"
  );
});

test("keeps empty commands empty", () => {
  assert.equal(prepareShellCommand("   ", "kanban"), "");
});
