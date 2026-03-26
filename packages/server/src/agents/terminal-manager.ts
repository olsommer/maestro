import * as fs from "fs";
import type { Server as SocketServer } from "socket.io";
import type { AgentStatus, AgentProvider, SandboxProvider } from "@maestro/wire";
import {
  spawnPty,
  writeToPty,
  writeCommandToPty,
  killPty,
  resizePty,
} from "./pty-manager.js";
import { getProvider } from "./providers.js";
import {
  buildTerminalSnapshotOutput,
  buildTerminalAttachResponse,
  type TerminalAttachResponse,
} from "./terminal-attach.js";
import {
  appendRecentTerminalInputs,
  applyTerminalInputChunk,
} from "./terminal-input-history.js";
import { createTerminalReplica, type TerminalReplica } from "./terminal-replica.js";
import { createTerminalWorktree, isGitRepo, removeTerminalWorktree } from "./worktree.js";
import { assertAutoSpawnProviderReady } from "./auto-spawn-provider.js";
import {
  appendTerminalHistoryBatch,
  readTerminalHistory,
  readTerminalSnapshot,
  createTerminalRecord,
  deleteTerminalRecord,
  deleteTerminalState,
  getTerminalRecord,
  listTerminalRecords,
  updateTerminalRecord,
  writeTerminalSnapshot,
} from "../state/terminals.js";
import { finalizeKanbanTaskAfterTerminalExit } from "../state/kanban.js";
import { getProjectRecordById } from "../state/projects.js";
import { getGitHubChildEnvVars } from "../integrations/github.js";
import { resolveAutoWorktreeStartPoint, syncProjectRepoBeforeSpawn } from "../projects/repo-sync.js";
import { getSettings } from "../state/settings.js";
import type { TerminalRecord } from "../state/types.js";

export interface TerminalRuntime {
  ptyId: string | null;
  replica: TerminalReplica;
  outputBuffer: Array<{ seq: number; data: string } | undefined>;
  outputBufferHead: number;
  outputBufferSize: number;
  nextOutputSeq: number;
  lastStartedAt: number | null;
  intentionalStop: boolean;
  deleting: boolean;
  deleted: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  pendingHistory: string[];
  historyFlushTimer: ReturnType<typeof setTimeout> | null;
  historyWritePromise: Promise<void>;
  snapshotPersistTimer: ReturnType<typeof setTimeout> | null;
  snapshotWritePromise: Promise<void>;
  exitPromise: Promise<void>;
  resolveExit: (() => void) | null;
  pendingInputLine: string;
}

export interface StartTerminalOptions {
  mcpConfigPath?: string;
  /** Override the sandbox provider for this start */
  sandboxProvider?: SandboxProvider;
}

const agentRuntimes = new Map<string, TerminalRuntime>();
const MAX_OUTPUT_LINES = 10000;
const RESTORE_CONCURRENCY = 2;
const HISTORY_FLUSH_DELAY_MS = 64;
const SNAPSHOT_PERSIST_DELAY_MS = 400;

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

export function prepareShellCommand(
  command: string,
  kind: TerminalRecord["kind"]
): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (kind === "kanban" || kind === "automation" || kind === "scheduler") {
    return `${trimmed}; exit $?`;
  }

  return trimmed;
}

function createExitWaiter(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function getRuntime(terminalId: string): TerminalRuntime {
  let rt = agentRuntimes.get(terminalId);
  if (!rt) {
    const persistedSnapshot = readTerminalSnapshot(terminalId);
    rt = {
      ptyId: null,
      replica: createTerminalReplica({
        cols: persistedSnapshot?.cols,
        rows: persistedSnapshot?.rows,
        scrollback: MAX_OUTPUT_LINES,
        snapshot: persistedSnapshot
          ? {
              data: persistedSnapshot.data,
              cols: persistedSnapshot.cols ?? 120,
              rows: persistedSnapshot.rows ?? 30,
            }
          : null,
      }),
      outputBuffer: new Array(MAX_OUTPUT_LINES),
      outputBufferHead: 0,
      outputBufferSize: 0,
      nextOutputSeq: persistedSnapshot ? persistedSnapshot.cursor + 1 : 1,
      lastStartedAt: null,
      intentionalStop: false,
      deleting: false,
      deleted: false,
      restartTimer: null,
      pendingHistory: [],
      historyFlushTimer: null,
      historyWritePromise: Promise.resolve(),
      snapshotPersistTimer: null,
      snapshotWritePromise: Promise.resolve(),
      exitPromise: Promise.resolve(),
      resolveExit: null,
      pendingInputLine: "",
    };
    agentRuntimes.set(terminalId, rt);
  }
  return rt;
}

function terminalCanUseRuntime(terminalId: string, rt: TerminalRuntime): boolean {
  return !rt.deleting && !rt.deleted && getTerminalRecord(terminalId) != null;
}

function resetOutputBuffer(rt: TerminalRuntime) {
  rt.outputBufferHead = 0;
  rt.outputBufferSize = 0;
  rt.outputBuffer.fill(undefined);
}

function appendOutputChunk(
  rt: TerminalRuntime,
  chunk: { seq: number; data: string }
) {
  if (rt.outputBufferSize < MAX_OUTPUT_LINES) {
    const index = (rt.outputBufferHead + rt.outputBufferSize) % MAX_OUTPUT_LINES;
    rt.outputBuffer[index] = chunk;
    rt.outputBufferSize += 1;
    return;
  }

  rt.outputBuffer[rt.outputBufferHead] = chunk;
  rt.outputBufferHead = (rt.outputBufferHead + 1) % MAX_OUTPUT_LINES;
}

function getOutputBufferChunks(
  rt: TerminalRuntime
): Array<{ seq: number; data: string }> {
  const chunks: Array<{ seq: number; data: string }> = [];
  for (let index = 0; index < rt.outputBufferSize; index += 1) {
    const chunk = rt.outputBuffer[(rt.outputBufferHead + index) % MAX_OUTPUT_LINES];
    if (chunk) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

function clearRuntimeTimers(rt: TerminalRuntime) {
  if (rt.restartTimer) {
    clearTimeout(rt.restartTimer);
    rt.restartTimer = null;
  }
  if (rt.historyFlushTimer) {
    clearTimeout(rt.historyFlushTimer);
    rt.historyFlushTimer = null;
  }
  if (rt.snapshotPersistTimer) {
    clearTimeout(rt.snapshotPersistTimer);
    rt.snapshotPersistTimer = null;
  }
}

function prepareExitWaiter(rt: TerminalRuntime) {
  const waiter = createExitWaiter();
  rt.exitPromise = waiter.promise;
  rt.resolveExit = waiter.resolve;
}

function resolveExitWaiter(rt: TerminalRuntime) {
  const resolve = rt.resolveExit;
  rt.resolveExit = null;
  resolve?.();
}

function scheduleHistoryFlush(terminalId: string, rt: TerminalRuntime) {
  if (rt.historyFlushTimer || !terminalCanUseRuntime(terminalId, rt)) {
    return;
  }

  rt.historyFlushTimer = setTimeout(() => {
    rt.historyFlushTimer = null;
    void flushBufferedHistory(terminalId, rt);
  }, HISTORY_FLUSH_DELAY_MS);
}

async function flushBufferedHistory(terminalId: string, rt: TerminalRuntime) {
  if (rt.pendingHistory.length === 0 || !terminalCanUseRuntime(terminalId, rt)) {
    rt.pendingHistory = [];
    return;
  }

  const batch = rt.pendingHistory.join("");
  rt.pendingHistory = [];
  rt.historyWritePromise = rt.historyWritePromise
    .catch(() => undefined)
    .then(() => appendTerminalHistoryBatch(terminalId, batch))
    .catch((error) => {
      console.error(`Failed to append history for terminal ${terminalId}:`, error);
    });

  await rt.historyWritePromise;
}

function scheduleSnapshotPersist(terminalId: string, rt: TerminalRuntime) {
  if (rt.snapshotPersistTimer || !terminalCanUseRuntime(terminalId, rt)) {
    return;
  }

  rt.snapshotPersistTimer = setTimeout(() => {
    rt.snapshotPersistTimer = null;
    void persistRuntimeSnapshot(terminalId, rt);
  }, SNAPSHOT_PERSIST_DELAY_MS);
}

async function persistRuntimeSnapshot(terminalId: string, rt: TerminalRuntime) {
  if (!terminalCanUseRuntime(terminalId, rt)) {
    return;
  }

  rt.snapshotWritePromise = rt.snapshotWritePromise
    .catch(() => undefined)
    .then(async () => {
      if (!terminalCanUseRuntime(terminalId, rt)) {
        return;
      }
      const snapshot = await rt.replica.snapshot();
      if (!terminalCanUseRuntime(terminalId, rt)) {
        return;
      }
      writeTerminalSnapshot(terminalId, snapshot);
    })
    .catch((error) => {
      console.error(`Failed to persist snapshot for terminal ${terminalId}:`, error);
    });

  await rt.snapshotWritePromise;
}

async function flushRuntimePersistence(terminalId: string, rt: TerminalRuntime) {
  clearRuntimeTimers(rt);

  await flushBufferedHistory(terminalId, rt);
  await persistRuntimeSnapshot(terminalId, rt);
}

async function waitForRuntimeWritesToSettle(rt: TerminalRuntime) {
  await Promise.all([
    rt.historyWritePromise.catch(() => undefined),
    rt.snapshotWritePromise.catch(() => undefined),
  ]);
}

type TerminalWithProject = TerminalRecord & {
  project: { id: string; name: string } | null;
};

function getRecentInputs(terminal: TerminalRecord): string[] {
  const recentInputs = (terminal as { recentInputs?: unknown }).recentInputs;
  if (!Array.isArray(recentInputs)) {
    return [];
  }

  return recentInputs
    .filter((input): input is string => typeof input === "string")
    .slice(-10);
}

function hydrateTerminal(terminal: TerminalRecord | null): TerminalWithProject | null {
  if (!terminal) {
    return null;
  }

  const project = terminal.projectId ? getProjectRecordById(terminal.projectId) : null;
  return {
    ...terminal,
    recentInputs: getRecentInputs(terminal),
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
    recentInputs: [],
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
  let cwd = agent.worktreePath || agent.projectPath;
  if (agent.autoWorktree && !agent.worktreePath) {
    if (!isGitRepo(agent.projectPath)) {
      throw new Error("Auto-worktree requires the project to be a git repository");
    }

    const project = agent.projectId ? getProjectRecordById(agent.projectId) : null;
    const startPoint = (
      await resolveAutoWorktreeStartPoint({
        projectId: agent.projectId,
        projectPath: agent.projectPath,
        preferredBranch: project?.defaultBranch ?? null,
      })
    ).ref;
    const worktreePath = createTerminalWorktree(agent.projectPath, terminalId, startPoint);
    updateTerminalRecord(terminalId, {
      worktreePath,
      lastActivity: new Date().toISOString(),
    });
    cwd = worktreePath;
  } else {
    await syncProjectRepoBeforeSpawn({
      projectId: agent.projectId,
      projectPath: cwd,
    });
  }

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
  const sandboxProvider =
    agent.disableSandbox ? "none" : (options?.sandboxProvider ?? settings.sandboxProvider);
  const sandboxEnabled = sandboxProvider !== "none";

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

  clearRuntimeTimers(rt);
  const persistedSnapshot = readTerminalSnapshot(terminalId);
  if (persistedSnapshot && rt.nextOutputSeq <= persistedSnapshot.cursor) {
    rt.nextOutputSeq = persistedSnapshot.cursor + 1;
  }
  rt.deleting = false;
  rt.deleted = false;
  rt.intentionalStop = false;
  rt.lastStartedAt = Date.now();
<<<<<<< HEAD
  resetOutputBuffer(rt);
  prepareExitWaiter(rt);
=======
  rt.pendingInputLine = "";
  rt.outputBuffer = [];
>>>>>>> 66f3ea0 (Add terminal command history popover)

  const ptyInstance = spawnPty({
    terminalId,
    cwd,
    env: childEnv,
    sandboxProvider,
    readonlyMounts: agent.secondaryProjectPaths,
    onData: (data) => {
      if (!terminalCanUseRuntime(terminalId, rt)) {
        return;
      }

      const seq = rt.nextOutputSeq++;
      appendOutputChunk(rt, { seq, data });

      deps.io.to(`terminal:${terminalId}`).emit("terminal:output", {
        terminalId,
        data,
        seq,
      });

      void rt.replica.write(data, seq);
      scheduleSnapshotPersist(terminalId, rt);
      rt.pendingHistory.push(data);
      scheduleHistoryFlush(terminalId, rt);
    },
    onExit: async (exitCode) => {
      const newStatus: AgentStatus = exitCode === 0 ? "completed" : "error";
      rt.ptyId = null;
      const agent = getTerminalRecord(terminalId);
      const ranForMs = rt.lastStartedAt ? Date.now() - rt.lastStartedAt : null;
      const intentionalStop = rt.intentionalStop;
      rt.lastStartedAt = null;
      try {
        if (rt.deleting || rt.deleted) {
          return;
        }

        await flushRuntimePersistence(terminalId, rt);

        if (!agent) {
          return;
        }

        if (intentionalStop) {
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
        } else {
          updateTerminalRecord(terminalId, {
            status: newStatus,
            currentTask: null,
            error: exitCode !== 0 ? `Exited with code ${exitCode}` : null,
            lastActivity: new Date().toISOString(),
          });

          deps.io.emit("terminal:status", {
            terminalId,
            status: newStatus,
            error: exitCode !== 0 ? `Exited with code ${exitCode}` : null,
          });
        }

        const shouldAutoRestart =
          !isShuttingDown &&
          agent.kind !== "kanban" &&
          agent.kind !== "automation" &&
          agent.kind !== "scheduler" &&
          !intentionalStop &&
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
      } finally {
        resolveExitWaiter(rt);
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

  const shellCommand = prepareShellCommand(command, agent.kind);
  if (shellCommand) {
    writeCommandToPty(ptyInstance.id, shellCommand);
  }
  return { ptyId: ptyInstance.id };
}

export async function stopTerminal(terminalId: string) {
  const agent = getTerminalRecord(terminalId);
  const rt = agentRuntimes.get(terminalId);
  if (!agent && !rt) {
    return;
  }

  if (rt?.ptyId) {
    rt.intentionalStop = true;
    const exitPromise = rt.exitPromise;
    killPty(rt.ptyId);
    rt.ptyId = null;
    await exitPromise;
    return;
  }

  if (rt && agent) {
    await flushRuntimePersistence(terminalId, rt);
  }

  if (!agent) {
    return;
  }

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
}

export async function deleteTerminal(terminalId: string) {
  const agent = getTerminalRecord(terminalId);
  const rt = agentRuntimes.get(terminalId);
  if (!agent && !rt) {
    return;
  }

  if (agent?.kanbanTaskId) {
    updateTerminalRecord(terminalId, {
      kanbanTaskId: null,
      currentTask: null,
      lastActivity: new Date().toISOString(),
    });
  }
  if (rt) {
    clearRuntimeTimers(rt);
    rt.intentionalStop = true;
    rt.deleting = true;
    rt.pendingHistory = [];
  }
  if (rt?.ptyId) {
    const exitPromise = rt.exitPromise;
    killPty(rt.ptyId);
    rt.ptyId = null;
    await exitPromise;
  }
  if (rt) {
    await waitForRuntimeWritesToSettle(rt);
    rt.deleted = true;
    rt.replica.dispose();
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
  deleteTerminalState(terminalId);

  deps.io.emit("terminal:status", {
    terminalId,
    status: "idle" as AgentStatus,
    error: null,
  });
}

export function sendTerminalInput(terminalId: string, data: string): boolean {
  const terminal = getTerminalRecord(terminalId);
  if (!terminal) return false;
  const rt = agentRuntimes.get(terminalId);
  if (!rt?.ptyId) return false;

  const { currentLine, committedInputs } = applyTerminalInputChunk(
    rt.pendingInputLine,
    data
  );
  const ok = writeToPty(rt.ptyId, data);
  if (!ok) return false;

  rt.pendingInputLine = currentLine;
  if (committedInputs.length > 0) {
    const recentInputs = appendRecentTerminalInputs(getRecentInputs(terminal), committedInputs);
    updateTerminalRecord(terminalId, {
      recentInputs,
      lastActivity: new Date().toISOString(),
    });
    deps.io.emit("terminal:status", {
      terminalId,
      status: terminal.status,
      error: terminal.error,
      recentInputs,
    });
  }

  return true;
}

export function hasTerminal(terminalId: string): boolean {
  return getTerminalRecord(terminalId) != null;
}

export function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number
): boolean {
  if (!getTerminalRecord(terminalId)) {
    return false;
  }

  const rt = getRuntime(terminalId);
  if (rt.deleting || rt.deleted) {
    return false;
  }
  void rt.replica.resize(cols, rows, rt.nextOutputSeq - 1);
  scheduleSnapshotPersist(terminalId, rt);
  if (!rt.ptyId) return false;
  return resizePty(rt.ptyId, cols, rows);
}

export async function restorePersistentTerminals() {
  const terminals = listTerminalRecords().filter(
    (agent) =>
      agent.kind !== "kanban" &&
      agent.kind !== "automation" &&
      agent.kind !== "scheduler"
  );

  let nextIndex = 0;
  const workerCount = Math.min(RESTORE_CONCURRENCY, terminals.length);

  const restoreNext = async () => {
    while (nextIndex < terminals.length) {
      const terminal = terminals[nextIndex++];

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
  };

  await Promise.all(Array.from({ length: workerCount }, () => restoreNext()));
}

export async function getTerminalOutput(terminalId: string): Promise<string[]> {
  return (await getTerminalOutputSnapshot(terminalId)).output;
}

export async function getTerminalOutputSnapshot(
  terminalId: string
): Promise<{ output: string[]; cursor: number }> {
  if (!getTerminalRecord(terminalId)) {
    throw new Error("Terminal not found");
  }

  const rt = getRuntime(terminalId);
  const persistedSnapshot = await rt.replica.snapshot();
  const history = readTerminalHistory(terminalId);

  return buildTerminalSnapshotOutput({
    outputBuffer: getOutputBufferChunks(rt),
    persistedSnapshot,
    history,
  });
}

export function getBufferedTerminalOutputSince(
  terminalId: string,
  sinceSeq: number
): Array<{ seq: number; data: string }> {
  if (!getTerminalRecord(terminalId)) {
    return [];
  }

  const rt = getRuntime(terminalId);
  return getOutputBufferChunks(rt).filter((chunk) => chunk.seq >= sinceSeq);
}

export async function getTerminalAttachment(
  terminalId: string,
  cursor?: number
): Promise<TerminalAttachResponse> {
  if (!getTerminalRecord(terminalId)) {
    throw new Error("Terminal not found");
  }

  const rt = getRuntime(terminalId);
  const snapshot = await getTerminalOutputSnapshot(terminalId);

  return buildTerminalAttachResponse({
    terminalId,
    requestedCursor: cursor,
    outputBuffer: getOutputBufferChunks(rt),
    snapshotOutput: snapshot.output,
    snapshotCursor: snapshot.cursor,
  });
}

let isShuttingDown = false;

export async function shutdownTerminalManager() {
  isShuttingDown = true;

  const activeExitPromises: Promise<void>[] = [];
  const idleFlushes: Promise<void>[] = [];

  for (const [terminalId, rt] of agentRuntimes) {
    clearRuntimeTimers(rt);
    if (rt.deleting || rt.deleted) {
      continue;
    }

    if (rt.ptyId) {
      rt.intentionalStop = true;
      const exitPromise = rt.exitPromise;
      killPty(rt.ptyId);
      rt.ptyId = null;
      activeExitPromises.push(exitPromise);
      continue;
    }

    if (getTerminalRecord(terminalId)) {
      idleFlushes.push(flushRuntimePersistence(terminalId, rt));
    }
  }

  await Promise.all(activeExitPromises);
  await Promise.all(idleFlushes);
}

export async function listTerminals() {
  return listTerminalRecords().map((terminal) => hydrateTerminal(terminal));
}

export async function getTerminal(terminalId: string) {
  return hydrateTerminal(getTerminalRecord(terminalId));
}
