import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalReplica } from "./terminal-replica.js";

test("serializes and restores terminal state on the server", async () => {
  const replica = createTerminalReplica({ cols: 12, rows: 4, scrollback: 100 });
  await replica.write("\u001b[31mhello\u001b[0m\r\nworld", 2);
  const snapshot = await replica.snapshot();

  const restored = createTerminalReplica({
    scrollback: 100,
    snapshot: {
      data: snapshot.data,
      cols: snapshot.cols,
      rows: snapshot.rows,
    },
  });
  const restoredSnapshot = await restored.snapshot();

  assert.equal(restoredSnapshot.data, snapshot.data);
  assert.equal(restoredSnapshot.cols, 12);
  assert.equal(restoredSnapshot.rows, 4);
  assert.equal(restoredSnapshot.cursor, 0);

  replica.dispose();
  restored.dispose();
});

test("tracks resize operations in persisted snapshots", async () => {
  const replica = createTerminalReplica({ cols: 10, rows: 3, scrollback: 100 });
  await replica.write("1234567890", 1);
  await replica.resize(20, 6, 1);
  const snapshot = await replica.snapshot();

  assert.equal(snapshot.cols, 20);
  assert.equal(snapshot.rows, 6);
  assert.match(snapshot.data, /1234567890/);

  replica.dispose();
});
