import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { MAESTRO_PROJECTS_DIR, MAESTRO_SANDBOXES_DIR } from "../state/files.js";
import { listTerminalRecords } from "../state/terminals.js";
import {
  getDockerPath,
  isDockerAvailable,
  resolveDockerMountForPath,
  type DockerMountSpec,
} from "./sandbox.js";

const DEFAULT_DIND_IMAGE = process.env.MAESTRO_DIND_IMAGE || "maestro-dind:latest";
const DEFAULT_DIND_READY_TIMEOUT_MS = Number(
  process.env.MAESTRO_DIND_READY_TIMEOUT_MS || "30000"
);
const DOCKER_RUNTIME_GC_INTERVAL_MS = Number(
  process.env.MAESTRO_DIND_GC_INTERVAL_MS || String(60 * 60 * 1000)
);
const DIND_SOCKET_DIR = "/var/run/maestro-dind";
const DIND_SOCKET_PATH = `${DIND_SOCKET_DIR}/docker.sock`;
const DIND_CONTAINER_PREFIX = "maestro-dind-";
const DIND_STATE_VOLUME_PREFIX = "maestro-dind-state-";
const DIND_SOCKET_VOLUME_PREFIX = "maestro-dind-sock-";
let dindImageReadyFor: string | null = null;
let dockerRuntimeGcTimer: ReturnType<typeof setInterval> | null = null;

export interface TerminalDockerRuntime {
  containerName: string;
  stateVolumeName: string;
  socketVolumeName: string;
  socketMount: DockerMountSpec;
  dockerHost: string;
  composeProjectName: string;
}

function getTerminalDockerResourceSuffix(terminalId: string): string {
  return terminalId.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
}

export function getTerminalDockerRuntime(terminalId: string): TerminalDockerRuntime {
  const suffix = getTerminalDockerResourceSuffix(terminalId);
  return {
    containerName: `${DIND_CONTAINER_PREFIX}${suffix}`,
    stateVolumeName: `${DIND_STATE_VOLUME_PREFIX}${suffix}`,
    socketVolumeName: `${DIND_SOCKET_VOLUME_PREFIX}${suffix}`,
    socketMount: {
      type: "volume",
      source: `maestro-dind-sock-${suffix}`,
      target: DIND_SOCKET_DIR,
      readonly: false,
    },
    dockerHost: `unix://${DIND_SOCKET_PATH}`,
    composeProjectName: `maestro-${suffix}`,
  };
}

function getSharedTerminalRuntimeMounts(): DockerMountSpec[] {
  const requestedPaths = [
    MAESTRO_SANDBOXES_DIR,
    MAESTRO_PROJECTS_DIR,
  ];

  return requestedPaths.flatMap((requestedPath) => {
    const mount = resolveDockerMountForPath(requestedPath, false);
    return mount ? [mount] : [];
  });
}

function inspectContainerRunning(containerName: string): boolean | null {
  try {
    const value = execFileSync(
      getDockerPath(),
      ["inspect", containerName, "--format", "{{.State.Running}}"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return value === "true";
  } catch {
    return null;
  }
}

function buildDindRunArgs(runtime: TerminalDockerRuntime): string[] {
  const args: string[] = [
    "run",
    "--detach",
    "--privileged",
    "--name", runtime.containerName,
    "--tmpfs", "/tmp:exec,mode=1777",
    "--env", "DOCKER_TLS_CERTDIR=",
    "--mount", `type=volume,src=${runtime.stateVolumeName},dst=/var/lib/docker`,
    "--mount", `type=volume,src=${runtime.socketVolumeName},dst=${DIND_SOCKET_DIR}`,
  ];

  for (const mount of getSharedTerminalRuntimeMounts()) {
    args.push(
      "--mount",
      `type=${mount.type},src=${mount.source},dst=${mount.target}${mount.readonly ? ",readonly" : ""}`
    );
  }

  args.push(
    ensureTerminalDockerRuntimeImage(),
    "--host",
    runtime.dockerHost,
    "--storage-driver",
    "overlay2"
  );
  return args;
}

function ensureTerminalDockerRuntimeImage(): string {
  if (!isDockerAvailable()) {
    throw new Error("docker is not available");
  }

  const image = DEFAULT_DIND_IMAGE;
  if (dindImageReadyFor === image) {
    return image;
  }

  try {
    execFileSync(getDockerPath(), ["image", "inspect", image], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    dindImageReadyFor = image;
    return image;
  } catch {
    const dockerfilePath = resolveDindDockerfile();
    const repoRoot = path.resolve(dockerfilePath, "../../..");
    console.log(`Building terminal DIND image ${image} from ${dockerfilePath}`);
    execFileSync(
      getDockerPath(),
      ["build", "-t", image, "-f", dockerfilePath, repoRoot],
      { stdio: "inherit" }
    );
    dindImageReadyFor = image;
    return image;
  }
}

function resolveDindDockerfile(): string {
  const localDir = path.dirname(fileURLToPath(import.meta.url));
  const installRoot = process.env.MAESTRO_INSTALL_ROOT?.trim();
  const candidates = [
    ...(installRoot ? [path.resolve(installRoot, "assets/docker/dind/Dockerfile")] : []),
    path.resolve(process.cwd(), "docker/dind/Dockerfile"),
    path.resolve(localDir, "../../../../docker/dind/Dockerfile"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Terminal DIND Dockerfile not found");
}

function recreateContainer(runtime: TerminalDockerRuntime): void {
  try {
    execFileSync(getDockerPath(), ["rm", "-f", runtime.containerName], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // best effort
  }

  execFileSync(getDockerPath(), buildDindRunArgs(runtime), {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function waitForDockerRuntime(runtime: TerminalDockerRuntime): void {
  const deadline = Date.now() + DEFAULT_DIND_READY_TIMEOUT_MS;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      execFileSync(
        getDockerPath(),
        [
          "exec",
          runtime.containerName,
          "docker",
          "--host",
          runtime.dockerHost,
          "version",
          "--format",
          "{{.Server.Version}}",
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      return;
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }

  throw new Error(
    `Timed out waiting for terminal Docker runtime ${runtime.containerName} to become ready` +
      (lastError instanceof Error ? `: ${lastError.message}` : "")
  );
}

export function ensureTerminalDockerRuntime(terminalId: string): TerminalDockerRuntime {
  if (!isDockerAvailable()) {
    throw new Error("docker is not available");
  }

  const runtime = getTerminalDockerRuntime(terminalId);
  const running = inspectContainerRunning(runtime.containerName);
  if (running !== true) {
    recreateContainer(runtime);
  }
  waitForDockerRuntime(runtime);
  return runtime;
}

export function cleanupTerminalDockerRuntime(terminalId: string): void {
  if (!isDockerAvailable()) {
    return;
  }

  const runtime = getTerminalDockerRuntime(terminalId);
  try {
    execFileSync(getDockerPath(), ["rm", "-f", runtime.containerName], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // best effort
  }

  for (const volumeName of [runtime.socketVolumeName, runtime.stateVolumeName]) {
    try {
      execFileSync(getDockerPath(), ["volume", "rm", "-f", volumeName], {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      // best effort
    }
  }
}

function listDockerResourceNames(kind: "container" | "volume", prefix: string): string[] {
  if (!isDockerAvailable()) {
    return [];
  }

  try {
    const args =
      kind === "container"
        ? ["ps", "-a", "--filter", `name=^${prefix}`, "--format", "{{.Names}}"]
        : ["volume", "ls", "--filter", `name=^${prefix}`, "--format", "{{.Name}}"];
    const output = execFileSync(getDockerPath(), args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!output) {
      return [];
    }
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getExpectedDockerRuntimeResources(): {
  containers: Set<string>;
  volumes: Set<string>;
} {
  const containers = new Set<string>();
  const volumes = new Set<string>();

  for (const terminal of listTerminalRecords()) {
    const runtime = getTerminalDockerRuntime(terminal.id);
    containers.add(runtime.containerName);
    volumes.add(runtime.stateVolumeName);
    volumes.add(runtime.socketVolumeName);
  }

  return { containers, volumes };
}

export function runTerminalDockerRuntimeGcOnce(): void {
  if (!isDockerAvailable()) {
    return;
  }

  const expected = getExpectedDockerRuntimeResources();

  for (const containerName of listDockerResourceNames("container", DIND_CONTAINER_PREFIX)) {
    if (expected.containers.has(containerName)) {
      continue;
    }
    try {
      execFileSync(getDockerPath(), ["rm", "-f", containerName], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      console.log(`[docker-gc] Removed orphaned terminal runtime container ${containerName}`);
    } catch (error) {
      console.warn(`[docker-gc] Failed to remove orphaned container ${containerName}:`, error);
    }
  }

  const orphanedVolumes = [
    ...listDockerResourceNames("volume", DIND_STATE_VOLUME_PREFIX),
    ...listDockerResourceNames("volume", DIND_SOCKET_VOLUME_PREFIX),
  ];
  for (const volumeName of orphanedVolumes) {
    if (expected.volumes.has(volumeName)) {
      continue;
    }
    try {
      execFileSync(getDockerPath(), ["volume", "rm", "-f", volumeName], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      console.log(`[docker-gc] Removed orphaned terminal runtime volume ${volumeName}`);
    } catch (error) {
      console.warn(`[docker-gc] Failed to remove orphaned volume ${volumeName}:`, error);
    }
  }
}

export function startTerminalDockerRuntimeGc(): void {
  if (dockerRuntimeGcTimer) {
    return;
  }

  runTerminalDockerRuntimeGcOnce();
  dockerRuntimeGcTimer = setInterval(() => {
    runTerminalDockerRuntimeGcOnce();
  }, DOCKER_RUNTIME_GC_INTERVAL_MS);
}

export function stopTerminalDockerRuntimeGc(): void {
  if (!dockerRuntimeGcTimer) {
    return;
  }
  clearInterval(dockerRuntimeGcTimer);
  dockerRuntimeGcTimer = null;
}
