import * as fs from "fs";
import type { Server as SocketServer } from "socket.io";
import type { AgentStatus, AgentProvider } from "@maestro/wire";
import {
  spawnPty,
  writeToPty,
  writeCommandToPty,
  killPty,
  resizePty,
} from "./pty-manager.js";
import { getProvider } from "./providers.js";
import {
  buildTerminalAttachResponse,
  type TerminalAttachResponse,
} from "./terminal-attach.js";
import { removeTerminalWorktree } from "./worktree.js";
import { assertAutoSpawnProviderReady } from "./auto-spawn-provider.js";
import {
  appendTerminalHistory,
  readTerminalHistory,
  createTerminalRecord,
  deleteTerminalRecord,
  getTerminalRecord,
  listTerminalRecords,
  updateTerminalRecord,
} from "../state/terminals.js";
import { finalizeKanbanTaskAfterTerminalExit } from "../state/kanban.js";
import { getProjectRecordById } from "../state/projects.js";
import { getGitHubChildEnvVars } from "../integrations/github.js";
import { getSettings } from "../state/settings.js";
import type { TerminalRecord } from "../state/types.js";

export interface TerminalRuntime {
  ptyId: string | null;
  outputBuffer: Array<{ seq: number; data: string }>;
  nextOutputSeq: number;
  lastStartedAt: number | null;
  intentionalStop: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
}

export interface StartTerminalOptions {
  mcpConfigPath?: string;
  /** Enable nsjail sandbox for this agent (Linux only, graceful fallback) */
  sandbox?: boolean;
}

const agentRuntimes = new Map<string, TerminalRuntime>();
const MAX_OUTPUT_LINES = 1000;

export interface TerminalManagerDeps {
  io: SocketServer;
}

let deps: TerminalManagerDeps;

export function initTerminalManager(d: TerminalManagerDeps) {
  deps = d;
}

function normalizeTerminalName(name?: string): string | null {
  const trimmed = name?.trim();
  if (!trimmed) {
    return null;
  }

  const legacyGeneratedName = /^terminal ([0-9a-f]{6})$/i.exec(trimmed);
  if (legacyGeneratedName) {
    return legacyGeneratedName[1].toLowerCase();
  }

  return trimmed;
}

function getRuntime(terminalId: string): TerminalRuntime {
  let rt = agentRuntimes.get(terminalId);
  if (!rt) {
    rt = {
      ptyId: null,
      outputBuffer: [],
      nextOutputSeq: 1,
      lastStartedAt: null,
      intentionalStop: false,
      restartTimer: null,
    };
    agentRuntimes.set(terminalId, rt);
  }
  return rt;
}

type TerminalWithProject = TerminalRecord & {
  project: { id: string; name: string } | null;
};

function hydrateTerminal(terminal: TerminalRecord | null): TerminalWithProject | null {
  if (!terminal) {
    return null;
  }

  const project = terminal.projectId ? getProjectRecordById(terminal.projectId) : null;
  return {
    ...terminal,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

export async function createTerminal(options: {
  name?: string;
  kind?: TerminalRecord["kind"];
  provider?: AgentProvider;
  projectId?: string;
  projectPath: string;
  worktreePath?: string | null;
  autoWorktree?: boolean;
  customDisplayName?: string;
  customCommandTemplate?: string;
  customEnv?: Record<string, string>;
  secondaryProjectPaths?: string[];
  skills?: string[];
  skipPermissions?: boolean;
  disableSandbox?: boolean;
}) {
  const agent = createTerminalRecord({
    name: normalizeTerminalName(options.name),
    kind: options.kind ?? "terminal",
    provider: options.provider ?? "claude",
    projectId: options.projectId ?? null,
    projectPath: options.projectPath,
    worktreePath: options.worktreePath ?? null,
    autoWorktree: options.autoWorktree ?? false,
    customDisplayName: options.customDisplayName ?? null,
    customCommandTemplate: options.customCommandTemplate ?? null,
    customEnv: options.customEnv ?? null,
    secondaryProjectPaths: options.secondaryProjectPaths ?? [],
    skills: options.skills ?? [],
    status: "idle",
    currentTask: null,
    error: null,
    lastActivity: null,
    skipPermissions: options.skipPermissions ?? false,
    disableSandbox: options.disableSandbox ?? false,
    kanbanTaskId: null,
  });

  deps.io.emit("terminal:status", {
    terminalId: agent.id,
    status: agent.status,
    error: null,
  });

  return agent;
}

export async function createAutoSpawnTerminal(options: {
  name?: string;
  kind?: TerminalRecord["kind"];
  projectId?: string;
  projectPath: string;
}) {
  const settings = getSettings();
  const provider = assertAutoSpawnProviderReady();
  return createTerminal({
    name: options.name,
    kind: options.kind ?? "kanban",
    provider,
    projectId: options.projectId,
    projectPath: options.projectPath,
    skipPermissions: settings.agentDefaultSkipPermissions,
    disableSandbox: settings.agentDefaultDisableSandbox,
    autoWorktree: settings.agentDefaultWorktreeMode === "new",
  });
}

export async function startTerminal(
  terminalId: string,
  prompt: string,
  options?: StartTerminalOptions
) {
  const agent = getTerminalRecord(terminalId);
  if (!agent) throw new Error(`Agent ${terminalId} not found`);
  const rt = getRuntime(terminalId);
  if (rt.ptyId) {
    throw new Error(`Agent ${terminalId} is already running`);
  }

  const cwd = agent.worktreePath || agent.projectPath;
  if (!fs.existsSync(cwd)) {
    throw new Error(`Agent working directory does not exist: ${cwd}`);
  }

  const provider = getProvider(agent.provider as AgentProvider, {
    displayName: agent.customDisplayName,
    commandTemplate: agent.customCommandTemplate,
    env: agent.customEnv,
  });
  const binaryPath = provider.resolveBinaryPath();
  const envVars = provider.getPtyEnvVars(agent.id, cwd, agent.skills);
  const githubEnvVars = getGitHubChildEnvVars();
  const childEnv = {
    ...envVars,
    ...githubEnvVars,
  };

  const settings = getSettings();
  const sandboxEnabled = agent.disableSandbox ? false : (options?.sandbox ?? settings.sandboxEnabled);

  const command = provider.buildInteractiveCommand({
    binaryPath,
    prompt,
    projectPath: cwd,
    skipPermissions: agent.skipPermissions,
    sandbox: sandboxEnabled,
    mcpConfigPath: options?.mcpConfigPath,
    secondaryProjectPaths: agent.secondaryProjectPaths,
    skills: agent.skills,
  });

  if (rt.restartTimer) {
    clearTimeout(rt.restartTimer);
    rt.restartTimer = null;
  }
  rt.intentionalStop = false;
  rt.lastStartedAt = Date.now();
  rt.outputBuffer = [];

  const ptyInstance = spawnPty({
    terminalId,
    cwd,
    env: childEnv,
    sandbox: sandboxEnabled,
    readonlyMounts: agent.secondaryProjectPaths,
    onData: (data) => {
      if (!getTerminalRecord(terminalId)) {
        return;
      }

      const seq = rt.nextOutputSeq++;
      rt.outputBuffer.push({ seq, data });
      if (rt.outputBuffer.length > MAX_OUTPUT_LINES) {
        rt.outputBuffer = rt.outputBuffer.slice(-MAX_OUTPUT_LINES);
      }

      appendTerminalHistory(terminalId, data);

      deps.io.to(`terminal:${terminalId}`).emit("terminal:output", {
        terminalId,
        data,
        seq,
      });

      updateTerminalRecord(terminalId, {
        lastActivity: new Date().toISOString(),
      });
    },
    onExit: async (exitCode) => {
      const newStatus: AgentStatus = exitCode === 0 ? "completed" : "error";
      rt.ptyId = null;
      const agent = getTerminalRecord(terminalId);
      const ranForMs = rt.lastStartedAt ? Date.now() - rt.lastStartedAt : null;
      rt.lastStartedAt = null;

      if (!agent) {
        return;
      }

      updateTerminalRecord(terminalId, {
        status: newStatus,
        error: exitCode !== 0 ? `Exited with code ${exitCode}` : null,
        lastActivity: new Date().toISOString(),
      });

      deps.io.emit("terminal:status", {
        terminalId,
        status: newStatus,
        error: exitCode !== 0 ? `Exited with code ${exitCode}` : null,
      });

      const shouldAutoRestart =
        agent.kind !== "kanban" &&
        agent.kind !== "automation" &&
        agent.kind !== "scheduler" &&
        !rt.intentionalStop &&
        (exitCode === 0 || ranForMs === null || ranForMs >= 5_000);

      rt.intentionalStop = false;

      if (agent.kanbanTaskId) {
        try {
          const taskResult = await finalizeKanbanTaskAfterTerminalExit(
            terminalId,
            agent.kanbanTaskId,
            exitCode === 0
          );

          updateTerminalRecord(terminalId, {
            status: exitCode === 0 ? "idle" : newStatus,
            currentTask: null,
            error: exitCode === 0 ? null : `Exited with code ${exitCode}`,
            kanbanTaskId: null,
            lastActivity: new Date().toISOString(),
          });

          deps.io.emit("terminal:status", {
            terminalId,
            status: exitCode === 0 ? "idle" : newStatus,
            error: exitCode === 0 ? null : `Exited with code ${exitCode}`,
          });
          deps.io.emit("kanban:updated", {
            taskId: taskResult.taskId,
            column: taskResult.column,
            assignedTerminalId: terminalId,
          });
        } catch (error) {
          console.error(`Failed to finalize kanban task for terminal ${terminalId}:`, error);
          updateTerminalRecord(terminalId, {
            kanbanTaskId: null,
            lastActivity: new Date().toISOString(),
          });
        }
      }

      if (shouldAutoRestart && getTerminalRecord(terminalId)) {
        updateTerminalRecord(terminalId, {
          status: "idle",
          currentTask: null,
          error: null,
          lastActivity: new Date().toISOString(),
        });
        deps.io.emit("terminal:status", {
          terminalId,
          status: "idle" as AgentStatus,
          error: null,
        });

        rt.restartTimer = setTimeout(() => {
          rt.restartTimer = null;
          void startTerminal(terminalId, "").catch((error) => {
            console.error(`Failed to auto-restart terminal ${terminalId}:`, error);
            if (!getTerminalRecord(terminalId)) {
              return;
            }
            updateTerminalRecord(terminalId, {
              status: "error",
              error:
                error instanceof Error ? error.message : "Failed to auto-restart terminal",
              lastActivity: new Date().toISOString(),
            });
            deps.io.emit("terminal:status", {
              terminalId,
              status: "error" as AgentStatus,
              error:
                error instanceof Error ? error.message : "Failed to auto-restart terminal",
            });
          });
        }, 250);
      }
    },
  });

  rt.ptyId = ptyInstance.id;

  updateTerminalRecord(terminalId, {
    status: "running",
    currentTask: prompt.trim() ? prompt.slice(0, 200) : null,
    error: null,
    lastActivity: new Date().toISOString(),
  });

  deps.io.emit("terminal:status", {
    terminalId,
    status: "running" as AgentStatus,
    error: null,
  });

  if (command.trim()) {
    writeCommandToPty(ptyInstance.id, command);
  }
  return { ptyId: ptyInstance.id };
}

export async function stopTerminal(terminalId: string) {
  const rt = agentRuntimes.get(terminalId);
  if (rt?.ptyId) {
    rt.intentionalStop = true;
    killPty(rt.ptyId);
    rt.ptyId = null;
  }

  updateTerminalRecord(terminalId, {
    status: "idle",
    lastActivity: new Date().toISOString(),
  });

  deps.io.emit("terminal:status", {
    terminalId,
    status: "idle" as AgentStatus,
    error: null,
  });
}

export async function deleteTerminal(terminalId: string) {
  const agent = getTerminalRecord(terminalId);
  if (agent?.kanbanTaskId) {
    updateTerminalRecord(terminalId, {
      kanbanTaskId: null,
      currentTask: null,
      lastActivity: new Date().toISOString(),
    });
  }
  const rt = agentRuntimes.get(terminalId);
  if (rt?.restartTimer) {
    clearTimeout(rt.restartTimer);
    rt.restartTimer = null;
  }
  if (rt) {
    rt.intentionalStop = true;
  }
  if (rt?.ptyId) {
    killPty(rt.ptyId);
  }
  agentRuntimes.delete(terminalId);

  // Clean up auto-created worktree
  if (agent?.autoWorktree && agent.worktreePath) {
    try {
      removeTerminalWorktree(agent.projectPath, terminalId);
    } catch (err) {
      console.warn(`Failed to remove worktree for terminal ${terminalId}:`, err);
    }
  }

  deleteTerminalRecord(terminalId);

  deps.io.emit("terminal:status", {
    terminalId,
    status: "idle" as AgentStatus,
    error: null,
  });
}

export function sendTerminalInput(terminalId: string, data: string): boolean {
  const rt = agentRuntimes.get(terminalId);
  if (!rt?.ptyId) return false;
  return writeToPty(rt.ptyId, data);
}

export function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number
): boolean {
  const rt = agentRuntimes.get(terminalId);
  if (!rt?.ptyId) return false;
  return resizePty(rt.ptyId, cols, rows);
}

export async function restorePersistentTerminals() {
  const terminals = listTerminalRecords().filter(
    (agent) =>
      agent.kind !== "kanban" &&
      agent.kind !== "automation" &&
      agent.kind !== "scheduler"
  );

  for (const terminal of terminals) {
    try {
      await startTerminal(terminal.id, "");
    } catch (error) {
      console.error(`Failed to restore terminal ${terminal.id}:`, error);
      updateTerminalRecord(terminal.id, {
        status: "error",
        error:
          error instanceof Error ? error.message : "Failed to restore terminal session",
        lastActivity: new Date().toISOString(),
      });
      deps.io.emit("terminal:status", {
        terminalId: terminal.id,
        status: "error" as AgentStatus,
        error:
          error instanceof Error ? error.message : "Failed to restore terminal session",
      });
    }
  }
}

export function getTerminalOutput(terminalId: string): string[] {
  return getTerminalOutputSnapshot(terminalId).output;
}

export function getTerminalOutputSnapshot(
  terminalId: string
): { output: string[]; cursor: number } {
  const rt = getRuntime(terminalId);
  const cursor = rt.nextOutputSeq - 1;

  if (rt.outputBuffer.length > 0) {
    return {
      output: rt.outputBuffer.map((chunk) => chunk.data),
      cursor,
    };
  }

  // Fall back to the persisted transcript after server restart or when no
  // in-memory replay buffer is available.
  const history = readTerminalHistory(terminalId);
  if (history) {
    return { output: [history], cursor };
  }

  return { output: [], cursor };
}

export function getBufferedTerminalOutputSince(
  terminalId: string,
  sinceSeq: number
): Array<{ seq: number; data: string }> {
  const rt = getRuntime(terminalId);
  return rt.outputBuffer.filter((chunk) => chunk.seq >= sinceSeq);
}

export function getTerminalAttachment(
  terminalId: string,
  cursor?: number
): TerminalAttachResponse {
  if (!getTerminalRecord(terminalId)) {
    throw new Error("Terminal not found");
  }

  const rt = getRuntime(terminalId);
  const snapshot = getTerminalOutputSnapshot(terminalId);

  return buildTerminalAttachResponse({
    terminalId,
    requestedCursor: cursor,
    outputBuffer: rt.outputBuffer,
    snapshotOutput: snapshot.output,
    snapshotCursor: snapshot.cursor,
  });
}

export async function listTerminals() {
  return listTerminalRecords().map((terminal) => hydrateTerminal(terminal));
}

export async function getTerminal(terminalId: string) {
  return hydrateTerminal(getTerminalRecord(terminalId));
}
