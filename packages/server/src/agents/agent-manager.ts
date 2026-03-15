import * as fs from "fs";
import type { Server as SocketServer } from "socket.io";
import type { AgentStatus, AgentProvider, AgentModel } from "@maestro/wire";
import {
  spawnPty,
  writeToPty,
  writeCommandToPty,
  killPty,
  resizePty,
} from "./pty-manager.js";
import { getProvider } from "./providers.js";
import {
  appendAgentHistory,
  readAgentHistory,
  createAgentRecord,
  deleteAgentRecord,
  getAgentRecord,
  listAgentRecords,
  updateAgentRecord,
} from "../state/agents.js";
import { finalizeKanbanTaskAfterAgentExit } from "../state/kanban.js";
import { getProjectRecordById } from "../state/projects.js";
import { getGitHubChildEnvVars } from "../integrations/github.js";
import type { AgentRecord } from "../state/types.js";

export interface AgentRuntime {
  ptyId: string | null;
  outputBuffer: string[];
}

export interface StartAgentOptions {
  mcpConfigPath?: string;
}

const agentRuntimes = new Map<string, AgentRuntime>();
const MAX_OUTPUT_LINES = 1000;

export interface AgentManagerDeps {
  io: SocketServer;
}

let deps: AgentManagerDeps;

export function initAgentManager(d: AgentManagerDeps) {
  deps = d;
}

function getRuntime(agentId: string): AgentRuntime {
  let rt = agentRuntimes.get(agentId);
  if (!rt) {
    rt = { ptyId: null, outputBuffer: [] };
    agentRuntimes.set(agentId, rt);
  }
  return rt;
}

type AgentWithProject = AgentRecord & {
  project: { id: string; name: string } | null;
};

function hydrateAgent(agent: AgentRecord | null): AgentWithProject | null {
  if (!agent) {
    return null;
  }

  const project = agent.projectId ? getProjectRecordById(agent.projectId) : null;
  return {
    ...agent,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

export async function createAgent(options: {
  name?: string;
  provider?: AgentProvider;
  model?: AgentModel | null;
  projectId?: string;
  projectPath: string;
  worktreePath?: string | null;
  customDisplayName?: string;
  customCommandTemplate?: string;
  customEnv?: Record<string, string>;
  secondaryProjectPaths?: string[];
  skills?: string[];
  skipPermissions?: boolean;
}) {
  const agent = createAgentRecord({
    name: options.name ?? null,
    provider: options.provider ?? "claude",
    model: options.model ?? null,
    projectId: options.projectId ?? null,
    projectPath: options.projectPath,
    worktreePath: options.worktreePath ?? null,
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
    kanbanTaskId: null,
  });

  deps.io.emit("agent:status", {
    agentId: agent.id,
    status: agent.status,
    error: null,
  });

  return agent;
}

export async function startAgent(
  agentId: string,
  prompt: string,
  model?: string,
  options?: StartAgentOptions
) {
  const agent = getAgentRecord(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (agent.status === "running") {
    throw new Error(`Agent ${agentId} is already running`);
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

  const command = provider.buildInteractiveCommand({
    binaryPath,
    prompt,
    model: model || agent.model || undefined,
    projectPath: cwd,
    skipPermissions: agent.skipPermissions,
    mcpConfigPath: options?.mcpConfigPath,
    secondaryProjectPaths: agent.secondaryProjectPaths,
    skills: agent.skills,
  });

  const rt = getRuntime(agentId);
  rt.outputBuffer = [];

  const ptyInstance = spawnPty({
    agentId,
    cwd,
    env: {
      ...envVars,
      ...githubEnvVars,
    },
    onData: (data) => {
      if (!getAgentRecord(agentId)) {
        return;
      }

      rt.outputBuffer.push(data);
      if (rt.outputBuffer.length > MAX_OUTPUT_LINES) {
        rt.outputBuffer = rt.outputBuffer.slice(-MAX_OUTPUT_LINES);
      }

      appendAgentHistory(agentId, data);

      deps.io.to(`agent:${agentId}`).emit("agent:output", {
        agentId,
        data,
      });

      updateAgentRecord(agentId, {
        lastActivity: new Date().toISOString(),
      });
    },
    onExit: async (exitCode) => {
      const newStatus: AgentStatus = exitCode === 0 ? "completed" : "error";
      rt.ptyId = null;

      const agent = getAgentRecord(agentId);
      if (!agent) {
        return;
      }

      updateAgentRecord(agentId, {
        status: newStatus,
        error: exitCode !== 0 ? `Exited with code ${exitCode}` : null,
        lastActivity: new Date().toISOString(),
      });

      deps.io.emit("agent:status", {
        agentId,
        status: newStatus,
        error: exitCode !== 0 ? `Exited with code ${exitCode}` : null,
      });

      if (agent.kanbanTaskId) {
        try {
          const taskResult = await finalizeKanbanTaskAfterAgentExit(
            agentId,
            agent.kanbanTaskId,
            exitCode === 0
          );

          updateAgentRecord(agentId, {
            status: exitCode === 0 ? "idle" : newStatus,
            currentTask: null,
            error: exitCode === 0 ? null : `Exited with code ${exitCode}`,
            kanbanTaskId: null,
            lastActivity: new Date().toISOString(),
          });

          deps.io.emit("agent:status", {
            agentId,
            status: exitCode === 0 ? "idle" : newStatus,
            error: exitCode === 0 ? null : `Exited with code ${exitCode}`,
          });
          deps.io.emit("kanban:updated", {
            taskId: taskResult.taskId,
            column: taskResult.column,
            assignedAgentId: agentId,
          });
        } catch (error) {
          console.error(`Failed to finalize kanban task for agent ${agentId}:`, error);
          updateAgentRecord(agentId, {
            kanbanTaskId: null,
            lastActivity: new Date().toISOString(),
          });
        }
      }
    },
  });

  rt.ptyId = ptyInstance.id;

  updateAgentRecord(agentId, {
    status: "running",
    currentTask: prompt.trim() ? prompt.slice(0, 200) : null,
    error: null,
    lastActivity: new Date().toISOString(),
  });

  deps.io.emit("agent:status", {
    agentId,
    status: "running" as AgentStatus,
    error: null,
  });

  writeCommandToPty(ptyInstance.id, command);
  return { ptyId: ptyInstance.id };
}

export async function stopAgent(agentId: string) {
  const rt = agentRuntimes.get(agentId);
  if (rt?.ptyId) {
    killPty(rt.ptyId);
    rt.ptyId = null;
  }

  updateAgentRecord(agentId, {
    status: "idle",
    lastActivity: new Date().toISOString(),
  });

  deps.io.emit("agent:status", {
    agentId,
    status: "idle" as AgentStatus,
    error: null,
  });
}

export async function deleteAgent(agentId: string) {
  const rt = agentRuntimes.get(agentId);
  if (rt?.ptyId) {
    killPty(rt.ptyId);
  }
  agentRuntimes.delete(agentId);
  deleteAgentRecord(agentId);

  deps.io.emit("agent:status", {
    agentId,
    status: "idle" as AgentStatus,
    error: null,
  });
}

export function sendInput(agentId: string, data: string): boolean {
  const rt = agentRuntimes.get(agentId);
  if (!rt?.ptyId) return false;
  return writeToPty(rt.ptyId, data);
}

export function resizeAgent(
  agentId: string,
  cols: number,
  rows: number
): boolean {
  const rt = agentRuntimes.get(agentId);
  if (!rt?.ptyId) return false;
  return resizePty(rt.ptyId, cols, rows);
}

export function getAgentOutput(agentId: string): string[] {
  const rt = getRuntime(agentId);

  // If in-memory buffer has content, return it
  if (rt.outputBuffer.length > 0) {
    return rt.outputBuffer;
  }

  // Fallback: read from transcript.log on disk (e.g. after server restart)
  const history = readAgentHistory(agentId);
  if (history) {
    return [history];
  }

  return [];
}

export async function listAgents() {
  return listAgentRecords().map((agent) => hydrateAgent(agent));
}

export async function getAgent(agentId: string) {
  return hydrateAgent(getAgentRecord(agentId));
}
