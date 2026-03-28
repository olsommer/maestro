import * as pty from "node-pty";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import type { SandboxProvider } from "@maestro/wire";
import {
  resolveSandboxProvider,
  isDockerAvailable,
  getDockerPath,
  buildDockerRunArgs,
  ensureDockerSandboxImage,
  type DockerMountSpec,
  type SandboxConfig,
} from "./sandbox.js";
import { ensureFirecrackerRuntime } from "./firecracker.js";

const require = createRequire(import.meta.url);
let didEnsureSpawnHelper = false;

function getShellPath(env?: Record<string, string>): string {
  return env?.SHELL || process.env.SHELL || "/bin/bash";
}

function hardenShellHistory(env: Record<string, string>): Record<string, string> {
  const shellName = path.basename(getShellPath(env));
  const hardened = { ...env };

  if (shellName === "bash") {
    const existingPromptCommand = hardened.PROMPT_COMMAND?.trim();
    const bashOpts = new Set((hardened.BASHOPTS || "").split(":").filter(Boolean));
    const promptParts = ["history -a", "history -n"];
    if (existingPromptCommand) {
      promptParts.push(existingPromptCommand);
    }

    bashOpts.add("histappend");
    hardened.BASHOPTS = Array.from(bashOpts).join(":");
    hardened.PROMPT_COMMAND = promptParts.join("; ");
    hardened.HISTCONTROL = hardened.HISTCONTROL || "ignoredups:erasedups";
    hardened.HISTSIZE = hardened.HISTSIZE || "100000";
    hardened.HISTFILESIZE = hardened.HISTFILESIZE || "200000";
  } else if (shellName === "zsh") {
    hardened.HISTSIZE = hardened.HISTSIZE || "100000";
    hardened.SAVEHIST = hardened.SAVEHIST || "200000";
  }

  return hardened;
}

function ensureSpawnHelperExecutable(): void {
  if (didEnsureSpawnHelper || process.platform !== "darwin") return;
  didEnsureSpawnHelper = true;

  try {
    const nodePtyPackage = require.resolve("node-pty/package.json");
    const helperPath = path.join(
      path.dirname(nodePtyPackage),
      "prebuilds",
      `darwin-${process.arch}`,
      "spawn-helper"
    );

    if (!fs.existsSync(helperPath)) return;

    const mode = fs.statSync(helperPath).mode & 0o777;
    if ((mode & 0o111) !== 0) return;

    fs.chmodSync(helperPath, mode | 0o755);
    console.log(`Fixed node-pty helper permissions: ${helperPath}`);
  } catch (error) {
    console.warn("Failed to ensure node-pty helper permissions", error);
  }
}

function buildChildEnv(env?: Record<string, string>): Record<string, string> {
  const childEnv = hardenShellHistory({
    ...(process.env as Record<string, string>),
    ...env,
  });

  // Local Maestro launches may happen from within a Claude Code session.
  // Strip the parent marker so spawned Claude agents don't abort as nested sessions.
  delete childEnv.CLAUDECODE;

  return childEnv;
}

export interface PtyInstance {
  id: string;
  process: pty.IPty;
  terminalId: string;
  sandboxed: boolean;
  sandboxProvider: SandboxProvider;
  cleanup?: (() => void) | null;
}

const ptyProcesses = new Map<string, PtyInstance>();

let idCounter = 0;

function generateId(): string {
  return `pty_${Date.now()}_${++idCounter}`;
}

export interface PtySpawnOptions {
  terminalId: string;
  cwd: string;
  homeDir?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
  /** Legacy sandbox toggle; maps to docker when true */
  sandbox?: boolean;
  /** Requested sandbox provider */
  sandboxProvider?: SandboxProvider;
  /** Additional read-only mount paths for sandbox */
  readonlyMounts?: string[];
  /** Additional read-write mount paths for sandbox */
  writableMounts?: string[];
  /** Additional Docker-only mounts */
  dockerExtraMounts?: DockerMountSpec[];
  /** Memory limit in bytes for sandbox (default: 512MB) */
  memoryLimit?: number;
}

export function spawnPty(options: PtySpawnOptions): PtyInstance {
  ensureSpawnHelperExecutable();

  const shell = getShellPath(options.env);
  const cwd = options.cwd || os.homedir();
  const requestedSandboxProvider =
    options.sandboxProvider ?? (options.sandbox ? "docker" : "none");
  const sandboxProvider = resolveSandboxProvider(requestedSandboxProvider);
  let actualSandboxProvider = sandboxProvider;
  const fullEnv = buildChildEnv(options.env);

  let ptyProcess: pty.IPty;
  let cleanup: (() => void) | null = null;

  if (sandboxProvider === "docker") {
    const sandboxConfig: SandboxConfig = {
      cwd,
      homeDir: options.homeDir,
      env: fullEnv,
      readonlyMounts: options.readonlyMounts,
      writableMounts: options.writableMounts,
      dockerExtraMounts: options.dockerExtraMounts,
      memoryLimit: options.memoryLimit,
    };

    const dockerArgs = buildDockerRunArgs(
      sandboxConfig,
      ["/bin/bash", "-l"],
      ensureDockerSandboxImage()
    );

    ptyProcess = pty.spawn(getDockerPath(), dockerArgs, {
      name: "xterm-256color",
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      cwd,
      env: { TERM: "xterm-256color" },
    });

    console.log(`Spawned docker-sandboxed PTY for terminal ${options.terminalId}`);
  } else if (sandboxProvider === "firecracker") {
    const firecrackerRuntime = ensureFirecrackerRuntime({
      terminalId: options.terminalId,
      cwd,
      homeDir: options.homeDir ?? os.homedir(),
      env: fullEnv,
      readonlyMounts: options.readonlyMounts,
      writableMounts: options.writableMounts,
      memoryLimit: options.memoryLimit,
    });
    cleanup = firecrackerRuntime.cleanup;

    ptyProcess = pty.spawn(
      firecrackerRuntime.bridgeCommand,
      firecrackerRuntime.bridgeArgs,
      {
        name: "xterm-256color",
        cols: options.cols ?? 120,
        rows: options.rows ?? 30,
        cwd,
        env: { TERM: "xterm-256color" },
      }
    );

    console.log(`Spawned firecracker-sandboxed PTY for terminal ${options.terminalId}`);
  } else {
    if (requestedSandboxProvider === "docker" && !isDockerAvailable()) {
      throw new Error(
        `Sandbox requested for terminal ${options.terminalId} but docker is not available.`
      );
    }
    if (requestedSandboxProvider === "firecracker") {
      throw new Error(
        `Sandbox requested for terminal ${options.terminalId} but firecracker is not available.`
      );
    }

    ptyProcess = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      cwd,
      env: fullEnv,
    });
  }

  const id = generateId();
  const instance: PtyInstance = {
    id,
    process: ptyProcess,
    terminalId: options.terminalId,
    sandboxed: actualSandboxProvider !== "none",
    sandboxProvider: actualSandboxProvider,
    cleanup,
  };

  ptyProcesses.set(id, instance);

  ptyProcess.onData((data) => {
    options.onData(data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    ptyProcesses.delete(id);
    instance.cleanup?.();
    instance.cleanup = null;
    options.onExit(exitCode);
  });

  return instance;
}

export function writeToPty(ptyId: string, data: string): boolean {
  const instance = ptyProcesses.get(ptyId);
  if (!instance) return false;
  instance.process.write(data);
  return true;
}

export function writeCommandToPty(ptyId: string, command: string): boolean {
  const instance = ptyProcesses.get(ptyId);
  if (!instance) return false;
  instance.process.write(command);
  instance.process.write("\r");
  return true;
}

export function resizePty(
  ptyId: string,
  cols: number,
  rows: number
): boolean {
  const instance = ptyProcesses.get(ptyId);
  if (!instance) return false;
  instance.process.resize(cols, rows);
  return true;
}

export function killPty(ptyId: string): boolean {
  const instance = ptyProcesses.get(ptyId);
  if (!instance) return false;
  try {
    instance.process.kill();
  } catch {
    // Already dead
  }
  instance.cleanup?.();
  instance.cleanup = null;
  ptyProcesses.delete(ptyId);
  return true;
}

export function killAllPty(): void {
  let killed = 0;
  for (const [id, instance] of ptyProcesses) {
    try {
      instance.process.kill();
      instance.cleanup?.();
      instance.cleanup = null;
      killed++;
    } catch {
      // Ignore
    }
  }
  ptyProcesses.clear();
  console.log(`Killed ${killed} PTY process(es) on shutdown`);
}

export function getPtyByTerminal(terminalId: string): PtyInstance | undefined {
  for (const instance of ptyProcesses.values()) {
    if (instance.terminalId === terminalId) return instance;
  }
  return undefined;
}

export function getAllPty(): PtyInstance[] {
  return Array.from(ptyProcesses.values());
}
