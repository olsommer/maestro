import type { Server as SocketServer } from "socket.io";
import { createAutoSpawnAgent, startAgent, deleteAgent } from "./agent-manager.js";
import { listKanbanTasks, updateKanbanTaskRecord } from "../state/kanban.js";
import { updateAgentRecord } from "../state/agents.js";

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

    for (const task of assignableTasks) {
      await assignTaskToAgent(io, task);
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

async function assignTaskToAgent(
  io: SocketServer,
  task: TaskLike
) {
  let agentId: string | null = null;
  try {
    const agent = await createAutoSpawnAgent({
      name: `kanban-${task.title}-${Date.now()}`,
      projectId: task.projectId ?? undefined,
      projectPath: task.projectPath,
    });
    agentId = agent.id;

    await updateKanbanTaskRecord(task.id, {
      column: "ongoing",
      assignedAgentId: agentId,
    });

    updateAgentRecord(agentId, {
      kanbanTaskId: task.id,
    });

    const prompt = `Task: ${task.title}\n\n${task.description}`;
    await startAgent(agentId, prompt);

    io.emit("kanban:updated", {
      taskId: task.id,
      column: "ongoing",
      assignedAgentId: agentId,
    });

    console.log(`Kanban: assigned task "${task.title}" to agent ${agentId}`);
  } catch (err) {
    if (agentId) {
      try {
        await deleteAgent(agentId);
      } catch {
        // Best effort cleanup for partially created agents.
      }
    }
    await updateKanbanTaskRecord(task.id, {
      column: "planned",
      assignedAgentId: null,
    });
    io.emit("kanban:updated", {
      taskId: task.id,
      column: "planned",
      assignedAgentId: null,
    });
    console.error(`Failed to assign task ${task.id} to an auto-spawned agent:`, err);
  }
}
