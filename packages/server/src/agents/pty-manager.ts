import * as pty from "node-pty";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import {
  isNsjailAvailable,
  getNsjailPath,
  buildNsjailArgs,
  ensureSandboxWritable,
  type SandboxConfig,
} from "./sandbox.js";
import { ensureDataDir } from "../state/files.js";

const require = createRequire(import.meta.url);
let didEnsureSpawnHelper = false;
let cachedTmuxAvailable: boolean | null = null;
const TMUX_SOCKET_PATH = path.join(ensureDataDir(), "tmux.sock");
const DEFAULT_TMUX_HISTORY_LIMIT = 50_000;

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
}

const ptyProcesses = new Map<string, PtyInstance>();

let idCounter = 0;

function generateId(): string {
  return `pty_${Date.now()}_${++idCounter}`;
}

function buildTmuxArgs(args: string[]): string[] {
  return ["-S", TMUX_SOCKET_PATH, ...args];
}

function execTmux(args: string[], options?: { env?: Record<string, string> }): string {
  return execFileSync("tmux", buildTmuxArgs(args), {
    env: options?.env ? buildChildEnv(options.env) : undefined,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function tryExecTmux(args: string[], options?: { env?: Record<string, string> }): boolean {
  try {
    execTmux(args, options);
    return true;
  } catch {
    return false;
  }
}

function tmuxSessionName(terminalId: string): string {
  return `maestro-${terminalId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function configureTmuxSession(sessionName: string): void {
  const options: string[][] = [
    ["set-option", "-t", sessionName, "status", "off"],
    ["set-option", "-t", sessionName, "prefix", "None"],
    ["set-option", "-t", sessionName, "mouse", "off"],
    ["set-option", "-t", sessionName, "history-limit", String(DEFAULT_TMUX_HISTORY_LIMIT)],
    ["set-option", "-t", sessionName, "detach-on-destroy", "off"],
  ];

  for (const args of options) {
    tryExecTmux(args);
  }
}

export function isTmuxAvailable(): boolean {
  if (cachedTmuxAvailable !== null) {
    return cachedTmuxAvailable;
  }

  cachedTmuxAvailable = tryExecTmux(["-V"]);
  return cachedTmuxAvailable;
}

export function tmuxSessionExists(terminalId: string): boolean {
  if (!isTmuxAvailable()) return false;
  return tryExecTmux(["has-session", "-t", tmuxSessionName(terminalId)]);
}

export function ensureTmuxSession(options: {
  terminalId: string;
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}): string {
  if (!isTmuxAvailable()) {
    throw new Error("tmux is not available");
  }

  const sessionName = tmuxSessionName(options.terminalId);
  if (!tmuxSessionExists(options.terminalId)) {
    const shell = getShellPath(options.env);
    execTmux(
      [
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-c",
        options.cwd,
        "-x",
        String(options.cols ?? 120),
        "-y",
        String(options.rows ?? 30),
        shell,
        "-l",
      ],
      { env: options.env }
    );
    configureTmuxSession(sessionName);
  }

  return sessionName;
}

export function killTmuxSession(terminalId: string): boolean {
  if (!isTmuxAvailable()) return false;
  return tryExecTmux(["kill-session", "-t", tmuxSessionName(terminalId)]);
}

export function captureTmuxPane(terminalId: string, maxLines = 5_000): string {
  if (!tmuxSessionExists(terminalId)) {
    return "";
  }

  try {
    return execTmux([
      "capture-pane",
      "-e",
      "-p",
      "-t",
      `${tmuxSessionName(terminalId)}:0.0`,
      "-S",
      `-${maxLines}`,
    ]);
  } catch {
    return "";
  }
}

export function getTmuxAttachCommand(
  terminalId: string
): { file: string; args: string[] } {
  return {
    file: "tmux",
    args: buildTmuxArgs(["attach-session", "-t", tmuxSessionName(terminalId)]),
  };
}

export interface PtySpawnOptions {
  terminalId: string;
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
  /** Enable nsjail sandbox (Linux only, falls back gracefully) */
  sandbox?: boolean;
  /** Additional read-only mount paths for sandbox */
  readonlyMounts?: string[];
  /** Additional read-write mount paths for sandbox */
  writableMounts?: string[];
  /** Memory limit in bytes for sandbox (default: 512MB) */
  memoryLimit?: number;
  /** Spawn a specific command instead of the default login shell */
  command?: {
    file: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

export function spawnPty(options: PtySpawnOptions): PtyInstance {
  ensureSpawnHelperExecutable();

  const shell = getShellPath(options.env);
  const cwd = options.cwd || os.homedir();
  const useSandbox = options.sandbox && isNsjailAvailable();
  const fullEnv = buildChildEnv({
    ...options.env,
    ...options.command?.env,
  });
  const targetFile = options.command?.file || shell;
  const targetArgs = options.command?.args || ["-l"];

  let ptyProcess: pty.IPty;

  if (useSandbox) {
    // Ensure project dir is writable by sandbox user (uid 1500)
    ensureSandboxWritable(cwd);

    // Sandboxed spawn: run shell inside nsjail
    const sandboxConfig: SandboxConfig = {
      cwd,
      env: fullEnv,
      readonlyMounts: options.readonlyMounts,
      writableMounts: options.writableMounts,
      memoryLimit: options.memoryLimit,
    };

    const nsjailArgs = [
      ...buildNsjailArgs(sandboxConfig),
      "--", targetFile, ...targetArgs,
    ];

    ptyProcess = pty.spawn(getNsjailPath(), nsjailArgs, {
      name: "xterm-256color",
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      cwd,
      // nsjail manages env vars via --env flags, but node-pty still needs
      // a minimal env for the PTY master side
      env: { TERM: "xterm-256color" },
    });

    console.log(`Spawned sandboxed PTY for terminal ${options.terminalId}`);
  } else {
    if (options.sandbox && !isNsjailAvailable()) {
      console.warn(
        `Sandbox requested for terminal ${options.terminalId} but nsjail is not available ` +
        `(platform: ${process.platform}). Running unsandboxed.`
      );
    }

    // Unsandboxed spawn (original behavior)
    ptyProcess = pty.spawn(targetFile, targetArgs, {
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
    sandboxed: useSandbox ?? false,
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

export function getPtyByTerminal(terminalId: string): PtyInstance | undefined {
  for (const instance of ptyProcesses.values()) {
    if (instance.terminalId === terminalId) return instance;
  }
  return undefined;
}

export function getAllPty(): PtyInstance[] {
  return Array.from(ptyProcesses.values());
}
