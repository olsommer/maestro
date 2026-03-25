import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTerminalAttachResponse,
  buildTerminalSnapshotOutput,
} from "./terminal-attach.js";

test("returns a snapshot for an initial attach", () => {
  const result = buildTerminalAttachResponse({
    terminalId: "term-1",
    requestedCursor: 0,
    outputBuffer: [
      { seq: 5, data: "hello" },
      { seq: 6, data: " world" },
    ],
    snapshotOutput: ["persisted history"],
    snapshotCursor: 6,
  });

  assert.deepEqual(result, {
    mode: "snapshot",
    terminalId: "term-1",
    output: ["persisted history"],
    cursor: 6,
  });
});

test("returns buffered replay chunks when the cursor is still covered in memory", () => {
  const result = buildTerminalAttachResponse({
    terminalId: "term-1",
    requestedCursor: 5,
    outputBuffer: [
      { seq: 4, data: "a" },
      { seq: 5, data: "b" },
      { seq: 6, data: "c" },
      { seq: 7, data: "d" },
    ],
    snapshotOutput: ["full transcript"],
    snapshotCursor: 7,
  });

  assert.deepEqual(result, {
    mode: "replay",
    terminalId: "term-1",
    chunks: [
      { seq: 6, data: "c" },
      { seq: 7, data: "d" },
    ],
    cursor: 7,
  });
});

test("falls back to a snapshot when the requested cursor predates the in-memory buffer", () => {
  const result = buildTerminalAttachResponse({
    terminalId: "term-1",
    requestedCursor: 2,
    outputBuffer: [
      { seq: 10, data: "x" },
      { seq: 11, data: "y" },
    ],
    snapshotOutput: ["full transcript"],
    snapshotCursor: 11,
  });

  assert.deepEqual(result, {
    mode: "snapshot",
    terminalId: "term-1",
    output: ["full transcript"],
    cursor: 11,
  });
});

test("falls back to a snapshot after a restart when no replay buffer is available", () => {
  const result = buildTerminalAttachResponse({
    terminalId: "term-1",
    requestedCursor: 9,
    outputBuffer: [],
    snapshotOutput: ["persisted transcript after restart"],
    snapshotCursor: 0,
  });

  assert.deepEqual(result, {
    mode: "snapshot",
    terminalId: "term-1",
    output: ["persisted transcript after restart"],
    cursor: 0,
  });
});

test("builds snapshot output from the persisted snapshot plus a contiguous live tail", () => {
  const result = buildTerminalSnapshotOutput({
    persistedSnapshot: {
      data: "persisted-screen",
      cursor: 10,
    },
    outputBuffer: [
      { seq: 11, data: "a" },
      { seq: 12, data: "b" },
    ],
  });

  assert.deepEqual(result, {
    output: ["persisted-screen", "a", "b"],
    cursor: 12,
  });
});

test("does not use non-contiguous live chunks to advance a persisted snapshot", () => {
  const result = buildTerminalSnapshotOutput({
    persistedSnapshot: {
      data: "persisted-screen",
      cursor: 10,
    },
    outputBuffer: [
      { seq: 12, data: "b" },
      { seq: 13, data: "c" },
    ],
  });

  assert.deepEqual(result, {
    output: ["persisted-screen"],
    cursor: 10,
  });
});

test("prefers a persisted snapshot over replay chunks when building snapshot output", () => {
  const result = buildTerminalSnapshotOutput({
    persistedSnapshot: {
      data: "rendered-screen",
      cursor: 6,
    },
    outputBuffer: [
      { seq: 5, data: "hello" },
      { seq: 6, data: " world" },
    ],
  });

  assert.deepEqual(result, {
    output: ["rendered-screen"],
    cursor: 6,
  });
});
