import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  __setRunningInsideContainerForTests,
  __setSelfContainerMountsForTests,
  buildDockerRunArgs,
  type DockerMountSpec,
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
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-sandbox-home-"));
  const previousHome = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-home-"));
  const codexDir = path.join(home, ".codex");
  const claudeDir = path.join(home, ".claude");
  const claudeJson = path.join(home, ".claude.json");
  const ghConfigDir = path.join(home, ".config", "gh");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(ghConfigDir, { recursive: true });
  fs.writeFileSync(claudeJson, '{"hasCompletedOnboarding":true}');
  process.env.HOME = home;
  __setRunningInsideContainerForTests(false);
  __setSelfContainerMountsForTests([]);

  try {
    const config: SandboxConfig = {
      cwd,
      homeDir,
      env: { FOO: "bar" },
      readonlyMounts: [readonlyDir],
      dockerExtraMounts: [
        {
          type: "volume",
          source: "maestro-test-sock",
          target: "/var/run/maestro-dind",
          readonly: false,
        } satisfies DockerMountSpec,
      ],
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
    assert.ok(args.includes(`HOME=${homeDir}`));

    const mountArgs = args.filter((value) => value.startsWith("type="));
    assert.ok(mountArgs.some((value) => value.includes(`src=${cwd}`)));
    assert.ok(mountArgs.some((value) => value.includes(`src=${readonlyDir}`)));
    assert.ok(mountArgs.some((value) => value.includes(`dst=${readonlyDir}`) && value.includes("readonly")));
    assert.ok(mountArgs.some((value) => value.includes(`src=${homeDir}`)));
    assert.ok(mountArgs.some((value) => value.includes("type=volume,src=maestro-test-sock,dst=/var/run/maestro-dind")));
    assert.ok(!mountArgs.some((value) => value.includes(`dst=${codexDir}`)));
    assert.ok(!mountArgs.some((value) => value.includes(`dst=${claudeDir}`)));
    assert.ok(!mountArgs.some((value) => value.includes(`dst=${claudeJson}`)));
    assert.ok(!mountArgs.some((value) => value.includes(`dst=${ghConfigDir}`)));
  } finally {
    __setSelfContainerMountsForTests(undefined);
    __setRunningInsideContainerForTests(undefined);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

test("skips container-only home files that are not backed by a Docker mount", () => {
  const previousHome = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-project-"));
  const claudeJson = path.join(home, ".claude.json");

  fs.writeFileSync(claudeJson, '{"hasCompletedOnboarding":true}');
  process.env.HOME = home;
  __setRunningInsideContainerForTests(true);
  __setSelfContainerMountsForTests([
    {
      Type: "bind",
      Source: "/host/project",
      Destination: cwd,
    },
  ]);

  try {
    const config: SandboxConfig = {
      cwd,
      env: {},
    };

    const args = buildDockerRunArgs(config, ["/bin/bash", "-l"], "example-sandbox:latest");
    const mountArgs = args.filter((value) => value.startsWith("type="));

    assert.ok(mountArgs.some((value) => value.includes("src=/host/project") && value.includes(`dst=${cwd}`)));
    assert.ok(!mountArgs.some((value) => value.includes(`dst=${claudeJson}`)));
  } finally {
    __setSelfContainerMountsForTests(undefined);
    __setRunningInsideContainerForTests(undefined);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});
