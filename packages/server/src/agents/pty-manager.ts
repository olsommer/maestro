import * as pty from "node-pty";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let didEnsureSpawnHelper = false;

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
  const childEnv = {
    ...(process.env as Record<string, string>),
    ...env,
  };

  // Local Maestro launches may happen from within a Claude Code session.
  // Strip the parent marker so spawned Claude agents don't abort as nested sessions.
  delete childEnv.CLAUDECODE;

  return childEnv;
}

export interface PtyInstance {
  id: string;
  process: pty.IPty;
  agentId: string;
}

const ptyProcesses = new Map<string, PtyInstance>();

let idCounter = 0;

function generateId(): string {
  return `pty_${Date.now()}_${++idCounter}`;
}

export interface PtySpawnOptions {
  agentId: string;
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

export function spawnPty(options: PtySpawnOptions): PtyInstance {
  ensureSpawnHelperExecutable();

  const shell = process.env.SHELL || "/bin/bash";
  const cwd = options.cwd || os.homedir();

  const ptyProcess = pty.spawn(shell, ["-l"], {
    name: "xterm-256color",
    cols: options.cols ?? 120,
    rows: options.rows ?? 30,
    cwd,
    env: buildChildEnv(options.env),
  });

  const id = generateId();
  const instance: PtyInstance = {
    id,
    process: ptyProcess,
    agentId: options.agentId,
  };

  ptyProcesses.set(id, instance);

  ptyProcess.onData((data) => {
    options.onData(data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    ptyProcesses.delete(id);
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
  ptyProcesses.delete(ptyId);
  return true;
}

export function killAllPty(): void {
  let killed = 0;
  for (const [id, instance] of ptyProcesses) {
    try {
      instance.process.kill();
      killed++;
    } catch {
      // Ignore
    }
  }
  ptyProcesses.clear();
  console.log(`Killed ${killed} PTY process(es) on shutdown`);
}

export function getPtyByAgent(agentId: string): PtyInstance | undefined {
  for (const instance of ptyProcesses.values()) {
    if (instance.agentId === agentId) return instance;
  }
  return undefined;
}

export function getAllPty(): PtyInstance[] {
  return Array.from(ptyProcesses.values());
}
