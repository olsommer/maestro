import * as fs from "fs";
import type { Server as SocketServer } from "socket.io";
import type {
  AgentStatus,
  AgentProvider,
  SandboxProvider,
  TerminalStartupPhase,
  TerminalStartupStatus,
} from "@maestro/wire";
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
import {
  createTerminalWorktree,
  getWorktreeGitMountPaths,
  isGitRepo,
  removeTerminalWorktree,
} from "./worktree.js";
import {
  ensureTerminalIsolationHome,
  removeTerminalIsolationState,
} from "./terminal-isolation.js";
import {
  cleanupTerminalDockerRuntime,
  ensureTerminalDockerRuntime,
} from "./dind.js";
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
import {
  resolveAutoWorktreeStartPoint,
  syncProjectRepoBeforeSpawn,
} from "../projects/repo-sync.js";
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
  syncRepo?: boolean;
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

export function shouldDeleteTerminalDuringRestore(terminal: TerminalRecord): boolean {
  return Boolean(
    terminal.autoWorktree && terminal.worktreePath && !fs.existsSync(terminal.worktreePath)
  );
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

  return recentInputs.filter((input): input is string => typeof input === "string").slice(-10);
}

interface StartupStepDefinition {
  phase: TerminalStartupPhase;
  label: string;
}

function buildStartupStatus(
  steps: StartupStepDefinition[],
  index: number
): TerminalStartupStatus {
  const step = steps[index];
  const totalSteps = steps.length;
  return {
    phase: step.phase,
    label: step.label,
    step: index + 1,
    totalSteps,
    progress: Math.round(((index + 1) / totalSteps) * 100),
  };
}

function buildStartupSteps(options: {
  autoWorktree: boolean;
  hasExistingWorktree: boolean;
  syncRepo: boolean;
  sandboxProvider: SandboxProvider;
}): StartupStepDefinition[] {
  const steps: StartupStepDefinition[] = [];

  if (options.autoWorktree && !options.hasExistingWorktree) {
    steps.push(
      { phase: "resolving_worktree", label: "Resolving worktree base" },
      { phase: "creating_worktree", label: "Creating worktree" }
    );
  } else if (options.syncRepo) {
    steps.push({ phase: "syncing_repository", label: "Syncing repository" });
  } else {
    steps.push({ phase: "preparing_workspace", label: "Preparing workspace" });
  }

  if (options.sandboxProvider === "docker") {
    steps.push(
      { phase: "preparing_sandbox", label: "Preparing sandbox" },
      { phase: "starting_docker", label: "Starting Docker runtime" }
    );
  } else if (options.sandboxProvider === "gvisor") {
    steps.push(
      { phase: "preparing_sandbox", label: "Preparing sandbox" },
      { phase: "starting_gvisor", label: "Starting gVisor runtime" },
      { phase: "starting_docker", label: "Starting Docker runtime" }
    );
  } else if (options.sandboxProvider !== "none") {
    steps.push({ phase: "preparing_sandbox", label: "Preparing sandbox" });
  }

  steps.push({ phase: "launching_terminal", label: "Launching terminal" });
  return steps;
}

function setTerminalStartupStatus(
  terminalId: string,
  status: AgentStatus,
  startupStatus: TerminalStartupStatus | null,
  error: string | null,
  currentTask?: string | null
) {
  updateTerminalRecord(terminalId, {
    status,
    startupStatus,
    error,
    ...(currentTask !== undefined ? { currentTask } : {}),
    lastActivity: new Date().toISOString(),
  });
  emitTerminalStatus(terminalId, status, error, startupStatus);
}

function emitTerminalStatus(
  terminalId: string,
  status: AgentStatus,
  error: string | null,
  startupStatus?: TerminalStartupStatus | null
) {
  const terminal = getTerminalRecord(terminalId);
  deps.io.emit("terminal:status", {
    terminalId,
    status,
    error,
    startupStatus: startupStatus ?? terminal?.startupStatus ?? null,
    recentInputs: terminal ? getRecentInputs(terminal) : [],
  });
}

function hydrateTerminal(terminal: TerminalRecord | null): TerminalWithProject | null {
  if (!terminal) {
    return null;
  }

  const project = terminal.projectId ? getProjectRecordById(terminal.projectId) : null;
  return {
    ...terminal,
    startupStatus: terminal.startupStatus ?? null,
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
  sandboxProvider?: SandboxProvider | null;
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
    sandboxProvider: options.sandboxProvider ?? null,
    secondaryProjectPaths: options.secondaryProjectPaths ?? [],
    skills: options.skills ?? [],
    status: "idle",
    startupStatus: null,
    currentTask: null,
    error: null,
    recentInputs: [],
    lastActivity: null,
    skipPermissions: options.skipPermissions ?? false,
    disableSandbox: options.disableSandbox ?? false,
    kanbanTaskId: null,
  });

  emitTerminalStatus(agent.id, agent.status, null);

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

  const settings = getSettings();
  const sandboxProvider =
    agent.disableSandbox
      ? "none"
      : (options?.sandboxProvider ?? agent.sandboxProvider ?? settings.sandboxProvider);
  const startupSteps = buildStartupSteps({
    autoWorktree: agent.autoWorktree,
    hasExistingWorktree: Boolean(agent.worktreePath),
    syncRepo: options?.syncRepo !== false,
    sandboxProvider,
  });
  const currentTask = prompt.trim() ? prompt.slice(0, 200) : null;

  clearRuntimeTimers(rt);
  const persistedSnapshot = readTerminalSnapshot(terminalId);
  if (persistedSnapshot && rt.nextOutputSeq <= persistedSnapshot.cursor) {
    rt.nextOutputSeq = persistedSnapshot.cursor + 1;
  }
  rt.deleting = false;
  rt.deleted = false;
  rt.intentionalStop = false;
  rt.lastStartedAt = Date.now();
  rt.pendingInputLine = "";
  resetOutputBuffer(rt);
  prepareExitWaiter(rt);

  try {
    let startupStepIndex = 0;
    setTerminalStartupStatus(
      terminalId,
      "waiting" as AgentStatus,
      buildStartupStatus(startupSteps, startupStepIndex),
      null,
      currentTask
    );

    let cwd = agent.worktreePath || agent.projectPath;
    if (agent.autoWorktree && !agent.worktreePath) {
      if (!isGitRepo(agent.projectPath)) {
        throw new Error("Auto-worktree requires the project to be a git repository");
      }

      const project = agent.projectId ? getProjectRecordById(agent.projectId) : null;
      const startPoint =
        options?.syncRepo === false
          ? "HEAD"
          : (
              await resolveAutoWorktreeStartPoint({
                projectId: agent.projectId,
                projectPath: agent.projectPath,
                preferredBranch: project?.defaultBranch ?? null,
              })
            ).ref;

      startupStepIndex += 1;
      setTerminalStartupStatus(
        terminalId,
        "waiting" as AgentStatus,
        buildStartupStatus(startupSteps, startupStepIndex),
        null,
        currentTask
      );

      const worktreePath = createTerminalWorktree(agent.projectPath, terminalId, startPoint);
      updateTerminalRecord(terminalId, {
        worktreePath,
        lastActivity: new Date().toISOString(),
      });
      cwd = worktreePath;
    } else if (options?.syncRepo !== false) {
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

    const sandboxEnabled = sandboxProvider !== "none";
    let isolatedHome: ReturnType<typeof ensureTerminalIsolationHome> | null = null;
    let dockerRuntime: ReturnType<typeof ensureTerminalDockerRuntime> | null = null;
    if (sandboxProvider === "docker" || sandboxProvider === "gvisor") {
      startupStepIndex += 1;
      setTerminalStartupStatus(
        terminalId,
        "waiting" as AgentStatus,
        buildStartupStatus(startupSteps, startupStepIndex),
        null,
        currentTask
      );
      isolatedHome = ensureTerminalIsolationHome(terminalId);
    }

    if (sandboxProvider === "docker") {
      startupStepIndex += 1;
      setTerminalStartupStatus(
        terminalId,
        "waiting" as AgentStatus,
        buildStartupStatus(startupSteps, startupStepIndex),
        null,
        currentTask
      );
      dockerRuntime = ensureTerminalDockerRuntime(terminalId);
    } else if (sandboxProvider === "gvisor") {
      startupStepIndex += 1;
      setTerminalStartupStatus(
        terminalId,
        "waiting" as AgentStatus,
        buildStartupStatus(startupSteps, startupStepIndex),
        null,
        currentTask
      );
      startupStepIndex += 1;
      setTerminalStartupStatus(
        terminalId,
        "waiting" as AgentStatus,
        buildStartupStatus(startupSteps, startupStepIndex),
        null,
        currentTask
      );
      dockerRuntime = ensureTerminalDockerRuntime(terminalId);
    }
    const runtimeEnv = dockerRuntime
      ? {
          DOCKER_HOST: dockerRuntime.dockerHost,
          DOCKER_BUILDKIT: "1",
          COMPOSE_DOCKER_CLI_BUILD: "1",
          COMPOSE_PROJECT_NAME: dockerRuntime.composeProjectName,
        }
      : {};
    Object.assign(childEnv, runtimeEnv);

    const writableMounts = sandboxEnabled ? getWorktreeGitMountPaths(cwd) : undefined;

    startupStepIndex = startupSteps.length - 1;
    setTerminalStartupStatus(
      terminalId,
      "waiting" as AgentStatus,
      buildStartupStatus(startupSteps, startupStepIndex),
      null,
      currentTask
    );

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

    const ptyInstance = spawnPty({
      terminalId,
      cwd,
      env: childEnv,
      homeDir: isolatedHome?.homeDir,
      sandboxProvider,
      readonlyMounts: agent.secondaryProjectPaths,
      writableMounts,
      dockerExtraMounts: dockerRuntime ? [dockerRuntime.socketMount] : undefined,
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
              startupStatus: null,
              currentTask: null,
              error: null,
              lastActivity: new Date().toISOString(),
            });

            emitTerminalStatus(terminalId, "idle" as AgentStatus, null, null);
          } else {
            updateTerminalRecord(terminalId, {
              status: newStatus,
              startupStatus: null,
              currentTask: null,
              error: exitCode !== 0 ? `Exited with code ${exitCode}` : null,
              lastActivity: new Date().toISOString(),
            });

            emitTerminalStatus(
              terminalId,
              newStatus,
              exitCode !== 0 ? `Exited with code ${exitCode}` : null,
              null
            );
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
                startupStatus: null,
                currentTask: null,
                error: exitCode === 0 ? null : `Exited with code ${exitCode}`,
                kanbanTaskId: null,
                lastActivity: new Date().toISOString(),
              });

              emitTerminalStatus(
                terminalId,
                exitCode === 0 ? "idle" : newStatus,
                exitCode === 0 ? null : `Exited with code ${exitCode}`,
                null
              );
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
              startupStatus: null,
              currentTask: null,
              error: null,
              lastActivity: new Date().toISOString(),
            });
            emitTerminalStatus(terminalId, "idle" as AgentStatus, null, null);

            rt.restartTimer = setTimeout(() => {
              rt.restartTimer = null;
              void startTerminal(terminalId, "", { syncRepo: false }).catch((error) => {
                console.error(`Failed to auto-restart terminal ${terminalId}:`, error);
                if (!getTerminalRecord(terminalId)) {
                  return;
                }
                updateTerminalRecord(terminalId, {
                  status: "error",
                  startupStatus: null,
                  error:
                    error instanceof Error ? error.message : "Failed to auto-restart terminal",
                  lastActivity: new Date().toISOString(),
                });
                emitTerminalStatus(
                  terminalId,
                  "error" as AgentStatus,
                  error instanceof Error ? error.message : "Failed to auto-restart terminal",
                  null
                );
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
      startupStatus: null,
      currentTask,
      error: null,
      lastActivity: new Date().toISOString(),
    });

    emitTerminalStatus(terminalId, "running" as AgentStatus, null, null);

    const shellCommand = prepareShellCommand(command, agent.kind);
    if (shellCommand) {
      writeCommandToPty(ptyInstance.id, shellCommand);
    }
    return { ptyId: ptyInstance.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start terminal session";
    if (getTerminalRecord(terminalId)) {
      updateTerminalRecord(terminalId, {
        status: "error",
        startupStatus: null,
        currentTask: null,
        error: message,
        lastActivity: new Date().toISOString(),
      });
      emitTerminalStatus(terminalId, "error" as AgentStatus, message, null);
    }
    resolveExitWaiter(rt);
    throw error;
  }
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
    startupStatus: null,
    currentTask: null,
    error: null,
    lastActivity: new Date().toISOString(),
  });

  emitTerminalStatus(terminalId, "idle" as AgentStatus, null);
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
      startupStatus: null,
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

  try {
    cleanupTerminalDockerRuntime(terminalId);
  } catch (err) {
    console.warn(`Failed to clean up Docker runtime for terminal ${terminalId}:`, err);
  }

  try {
    removeTerminalIsolationState(terminalId);
  } catch (err) {
    console.warn(`Failed to remove isolated home for terminal ${terminalId}:`, err);
  }

  deleteTerminalRecord(terminalId);
  deleteTerminalState(terminalId);

  emitTerminalStatus(terminalId, "idle" as AgentStatus, null);
}

export function sendTerminalInput(terminalId: string, data: string): boolean {
  if (!getTerminalRecord(terminalId)) return false;
  const rt = agentRuntimes.get(terminalId);
  if (!rt?.ptyId) return false;

  const { currentLine, committedInputs } = applyTerminalInputChunk(
    rt.pendingInputLine,
    data
  );
  const ok = writeToPty(rt.ptyId, data);
  if (!ok) {
    return false;
  }

  rt.pendingInputLine = currentLine;
  if (committedInputs.length > 0) {
    const terminal = getTerminalRecord(terminalId);
    if (terminal) {
      const nextRecentInputs = appendRecentTerminalInputs(
        getRecentInputs(terminal),
        committedInputs
      );
      updateTerminalRecord(terminalId, {
        recentInputs: nextRecentInputs,
        lastActivity: new Date().toISOString(),
      });
      emitTerminalStatus(terminalId, terminal.status, terminal.error);
    }
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
        if (shouldDeleteTerminalDuringRestore(terminal)) {
          console.warn(
            `Deleting terminal ${terminal.id} during restore because its auto-worktree path is missing: ${terminal.worktreePath}`
          );
          await deleteTerminal(terminal.id);
          continue;
        }

        await startTerminal(terminal.id, "", { syncRepo: false });
      } catch (error) {
        console.error(`Failed to restore terminal ${terminal.id}:`, error);
        updateTerminalRecord(terminal.id, {
          status: "error",
          startupStatus: null,
          error:
            error instanceof Error ? error.message : "Failed to restore terminal session",
          lastActivity: new Date().toISOString(),
        });
        emitTerminalStatus(
          terminal.id,
          "error" as AgentStatus,
          error instanceof Error ? error.message : "Failed to restore terminal session"
        );
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
