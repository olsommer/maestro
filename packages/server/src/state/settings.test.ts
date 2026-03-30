import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAutoSpawnSandboxProvider } from "./settings.js";

test("codex auto-spawn settings downgrade gvisor to docker", () => {
  assert.equal(normalizeAutoSpawnSandboxProvider("codex", "gvisor"), "docker");
});

test("claude auto-spawn settings keep gvisor enabled", () => {
  assert.equal(normalizeAutoSpawnSandboxProvider("claude", "gvisor"), "gvisor");
});

test("codex auto-spawn settings preserve none and docker", () => {
  assert.equal(normalizeAutoSpawnSandboxProvider("codex", "none"), "none");
  assert.equal(normalizeAutoSpawnSandboxProvider("codex", "docker"), "docker");
});
