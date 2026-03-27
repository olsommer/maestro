import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { MAESTRO_PROJECTS_DIR, MAESTRO_SANDBOXES_DIR } from "../state/files.js";
import {
  getDockerPath,
  isDockerAvailable,
  resolveDockerMountForPath,
  type DockerMountSpec,
} from "./sandbox.js";

const DEFAULT_DIND_IMAGE = process.env.MAESTRO_DIND_IMAGE || "docker:29-dind";
const DEFAULT_DIND_READY_TIMEOUT_MS = Number(
  process.env.MAESTRO_DIND_READY_TIMEOUT_MS || "30000"
);
const DIND_SOCKET_DIR = "/var/run/maestro-dind";
const DIND_SOCKET_PATH = `${DIND_SOCKET_DIR}/docker.sock`;

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
    containerName: `maestro-dind-${suffix}`,
    stateVolumeName: `maestro-dind-state-${suffix}`,
    socketVolumeName: `maestro-dind-sock-${suffix}`,
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
    DEFAULT_DIND_IMAGE,
    "--host",
    runtime.dockerHost,
    "--storage-driver",
    "overlay2"
  );
  return args;
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
