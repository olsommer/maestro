import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RECENT_TERMINAL_INPUTS,
  appendRecentTerminalInputs,
  applyTerminalInputChunk,
} from "./terminal-input-history.js";

test("captures submitted terminal inputs and honors line editing", () => {
  let currentLine = "";
  let recentInputs: string[] = [];

  ({ currentLine } = applyTerminalInputChunk(currentLine, "git stats"));
  ({ currentLine } = applyTerminalInputChunk(currentLine, "\u007fus"));

  const result = applyTerminalInputChunk(currentLine, "\r");
  recentInputs = appendRecentTerminalInputs(recentInputs, result.committedInputs);

  assert.equal(result.currentLine, "");
  assert.deepEqual(recentInputs, ["git status"]);
});

test("ignores escape sequences and empty submissions", () => {
  const result = applyTerminalInputChunk("npm run dev", "\x1b[D\r\u0003\r");

  assert.equal(result.currentLine, "");
  assert.deepEqual(result.committedInputs, ["npm run dev"]);
});

test("keeps only the last ten submitted inputs", () => {
  const inputs = Array.from(
    { length: MAX_RECENT_TERMINAL_INPUTS + 3 },
    (_, index) => `command ${index + 1}`
  );

  const recentInputs = appendRecentTerminalInputs([], inputs);

  assert.equal(recentInputs.length, MAX_RECENT_TERMINAL_INPUTS);
  assert.deepEqual(recentInputs, inputs.slice(-MAX_RECENT_TERMINAL_INPUTS));
});
