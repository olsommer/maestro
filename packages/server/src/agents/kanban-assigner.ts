import type { Server as SocketServer } from "socket.io";
import { startAgent } from "./agent-manager.js";
import { listKanbanTasks, updateKanbanTaskRecord } from "../state/kanban.js";
import { listAgentRecords, updateAgentRecord } from "../state/agents.js";

const POLL_INTERVAL = 10_000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startKanbanAssigner(io: SocketServer) {
  console.log("Kanban assigner started (polling every 10s)");
  timer = setInterval(() => tick(io), POLL_INTERVAL);
  void tick(io);
}

export function stopKanbanAssigner() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(io: SocketServer) {
  try {
    const allTasks = await listKanbanTasks();
    const doneTaskIds = new Set(
      allTasks.filter((t) => t.column === "done").map((t) => t.id)
    );
    const plannedTasks = allTasks.filter((t) => t.column === "planned");
    const assignableTasks = plannedTasks.filter(
      (task) =>
        !task.assignedAgentId &&
        task.blockedBy.every((id) => doneTaskIds.has(id))
    );
    if (assignableTasks.length === 0) return;

    const idleAgents = listAgentRecords().filter(
      (agent) => agent.status === "idle" && !agent.kanbanTaskId
    );
    if (idleAgents.length === 0) return;

    for (const task of assignableTasks) {
      const match = findBestAgent(idleAgents, task);
      if (!match) continue;

      await assignTaskToAgent(io, task, match);

      const idx = idleAgents.findIndex((agent) => agent.id === match.id);
      if (idx !== -1) idleAgents.splice(idx, 1);
      if (idleAgents.length === 0) break;
    }
  } catch (err) {
    console.error("Kanban assigner error:", err);
  }
}

interface TaskLike {
  id: string;
  title: string;
  description: string;
  projectId?: string | null;
  projectPath: string;
}

interface AgentLike {
  id: string;
  projectId?: string | null;
  projectPath: string;
}

function findBestAgent(agents: AgentLike[], task: TaskLike): AgentLike | null {
  const sameProject = agents.find(
    (agent) =>
      (task.projectId && agent.projectId === task.projectId) ||
      agent.projectPath === task.projectPath
  );
  if (sameProject) return sameProject;

  return agents[0] ?? null;
}

async function assignTaskToAgent(
  io: SocketServer,
  task: TaskLike,
  agent: { id: string }
) {
  try {
    await updateKanbanTaskRecord(task.id, {
      column: "ongoing",
      assignedAgentId: agent.id,
    });

    updateAgentRecord(agent.id, {
      kanbanTaskId: task.id,
    });

    const prompt = `Task: ${task.title}\n\n${task.description}`;
    await startAgent(agent.id, prompt);

    io.emit("kanban:updated", {
      taskId: task.id,
      column: "ongoing",
      assignedAgentId: agent.id,
    });

    console.log(`Kanban: assigned task "${task.title}" to agent ${agent.id}`);
  } catch (err) {
    console.error(`Failed to assign task ${task.id} to agent ${agent.id}:`, err);
  }
}
