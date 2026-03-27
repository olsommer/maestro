import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

test("isolated terminal home bootstrap copies shared CLI config into the isolated home", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-terminal-home-"));
  const tempState = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-terminal-state-"));
  const previousHome = process.env.HOME;
  const previousStateBase = process.env.MAESTRO_TERMINAL_STATE_BASE;

  fs.writeFileSync(path.join(tempHome, ".gitconfig"), "[user]\n\tname = Test User\n");
  fs.writeFileSync(path.join(tempHome, ".claude.json"), '{"hasCompletedOnboarding":true}');
  fs.mkdirSync(path.join(tempHome, ".config", "gh"), { recursive: true });
  fs.writeFileSync(path.join(tempHome, ".config", "gh", "hosts.yml"), "github.com:\n  user: test\n");
  fs.mkdirSync(path.join(tempHome, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(tempHome, ".claude", "settings.json"), "{}");
  fs.mkdirSync(path.join(tempHome, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(tempHome, ".codex", "config.json"), "{}");

  process.env.HOME = tempHome;
  process.env.MAESTRO_TERMINAL_STATE_BASE = tempState;

  try {
    const { ensureTerminalIsolationHome } = await import(
      `./terminal-isolation.js?test=${Date.now()}`
    );

    const paths = ensureTerminalIsolationHome("terminal-123");

    assert.equal(
      fs.readFileSync(path.join(paths.homeDir, ".gitconfig"), "utf-8"),
      "[user]\n\tname = Test User\n"
    );
    assert.equal(
      fs.readFileSync(path.join(paths.homeDir, ".claude.json"), "utf-8"),
      '{"hasCompletedOnboarding":true}'
    );
    assert.ok(fs.existsSync(path.join(paths.homeDir, ".config", "gh", "hosts.yml")));
    assert.ok(fs.existsSync(path.join(paths.homeDir, ".claude", "settings.json")));
    assert.ok(fs.existsSync(path.join(paths.homeDir, ".codex", "config.json")));
    assert.ok(fs.existsSync(path.join(paths.homeDir, ".bash_history")));
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousStateBase === undefined) {
      delete process.env.MAESTRO_TERMINAL_STATE_BASE;
    } else {
      process.env.MAESTRO_TERMINAL_STATE_BASE = previousStateBase;
    }
  }
});
