import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildDockerRunArgs,
  normalizeSandboxProvider,
  resolveSandboxProviderAvailability,
  type SandboxConfig,
} from "./sandbox.js";

test("normalizes sandbox providers and legacy booleans", () => {
  assert.equal(normalizeSandboxProvider("docker"), "docker");
  assert.equal(normalizeSandboxProvider("nsjail"), "nsjail");
  assert.equal(normalizeSandboxProvider("bogus"), "none");
  assert.equal(normalizeSandboxProvider(undefined, true), "nsjail");
});

test("falls back to none when requested sandbox is unavailable", () => {
  assert.equal(
    resolveSandboxProviderAvailability("docker", {
      dockerAvailable: false,
      nsjailAvailable: true,
    }),
    "none"
  );
  assert.equal(
    resolveSandboxProviderAvailability("nsjail", {
      dockerAvailable: true,
      nsjailAvailable: false,
    }),
    "none"
  );
  assert.equal(
    resolveSandboxProviderAvailability("docker", {
      dockerAvailable: true,
      nsjailAvailable: false,
    }),
    "docker"
  );
});

test("builds docker run args with mounts, env, and command", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-sandbox-"));
  const readonlyDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-sandbox-ro-"));

  const config: SandboxConfig = {
    cwd,
    env: { FOO: "bar" },
    readonlyMounts: [readonlyDir],
    memoryLimit: 128 * 1024 * 1024,
    maxProcesses: 16,
  };

  const args = buildDockerRunArgs(config, ["/bin/bash", "-l"], "example-sandbox:latest");

  assert.equal(args[0], "run");
  assert.ok(args.includes("--workdir"));
  assert.ok(args.includes(cwd));
  assert.ok(args.includes("example-sandbox:latest"));
  assert.ok(args.includes("/bin/bash"));
  assert.ok(args.includes("-l"));
  assert.ok(args.includes("--env"));
  assert.ok(args.includes("FOO=bar"));

  const mountArgs = args.filter((value) => value.startsWith("type=bind,"));
  assert.ok(mountArgs.some((value) => value.includes(`src=${cwd}`)));
  assert.ok(mountArgs.some((value) => value.includes(`src=${readonlyDir}`)));
  assert.ok(mountArgs.some((value) => value.includes(`dst=${readonlyDir}`) && value.includes("readonly")));
});
