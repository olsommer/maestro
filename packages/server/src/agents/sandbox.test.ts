import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildNsjailArgs } from "./sandbox.js";

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void
): void {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function getEnvArg(args: string[], key: string): string {
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === "--env" && args[index + 1].startsWith(`${key}=`)) {
      return args[index + 1].slice(key.length + 1);
    }
  }

  throw new Error(`Missing ${key} env arg`);
}

function hasReadonlyMount(args: string[], targetPath: string): boolean {
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === "--bindmount_ro" && args[index + 1] === `${targetPath}:${targetPath}`) {
      return true;
    }
  }

  return false;
}

function createFakeCodexInstall(baseDir: string, globalBinDir: string): string {
  const companionDir = path.join(baseDir, "lib", "node_modules", "@openai", "codex", "bin");
  const entrypoint = path.join(companionDir, "codex.js");
  const symlinkPath = path.join(globalBinDir, "codex");

  fs.mkdirSync(companionDir, { recursive: true });
  fs.mkdirSync(globalBinDir, { recursive: true });
  fs.writeFileSync(entrypoint, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(entrypoint, 0o755);
  fs.symlinkSync(entrypoint, symlinkPath);

  return companionDir;
}

test("adds Codex companion bin dir to sandbox PATH", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-sandbox-path-"));
  const projectDir = path.join(tempDir, "project");
  const npmPrefix = path.join(tempDir, "npm-global");
  const globalBinDir = path.join(npmPrefix, "bin");
  const companionDir = createFakeCodexInstall(npmPrefix, globalBinDir);

  fs.mkdirSync(projectDir, { recursive: true });

  withEnv(
    {
      PATH: `${globalBinDir}:${process.env.PATH ?? ""}`,
      npm_config_prefix: npmPrefix,
    },
    () => {
      const args = buildNsjailArgs({ cwd: projectDir, env: {} });
      const sandboxPath = getEnvArg(args, "PATH").split(":");

      assert.ok(sandboxPath.includes(globalBinDir));
      assert.ok(sandboxPath.includes(companionDir));
      assert.ok(hasReadonlyMount(args, npmPrefix));
    }
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("mounts the Codex companion dir when it lives outside the global prefix", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-sandbox-mount-"));
  const projectDir = path.join(tempDir, "project");
  const launcherBinDir = path.join(tempDir, "launcher-bin");
  const companionRoot = path.join(tempDir, "standalone-codex");
  const companionDir = createFakeCodexInstall(companionRoot, launcherBinDir);

  fs.mkdirSync(projectDir, { recursive: true });

  withEnv(
    {
      PATH: `${launcherBinDir}:${process.env.PATH ?? ""}`,
      npm_config_prefix: undefined,
    },
    () => {
      const args = buildNsjailArgs({ cwd: projectDir, env: {} });
      const sandboxPath = getEnvArg(args, "PATH").split(":");

      assert.ok(sandboxPath.includes(companionDir));
      assert.ok(hasReadonlyMount(args, companionDir));
    }
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});
