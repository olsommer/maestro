import type { Server as SocketServer } from "socket.io";
import { createAutoSpawnTerminal, startTerminal, deleteTerminal } from "./terminal-manager.js";
import { listKanbanTasks, updateKanbanTaskRecord } from "../state/kanban.js";
import { updateTerminalRecord } from "../state/terminals.js";

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
        !task.assignedTerminalId &&
        task.blockedBy.every((id) => doneTaskIds.has(id))
    );
    if (assignableTasks.length === 0) return;

    for (const task of assignableTasks) {
      await assignTaskToTerminal(io, task);
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

async function assignTaskToTerminal(
  io: SocketServer,
  task: TaskLike
) {
  let terminalId: string | null = null;
  try {
    const terminal = await createAutoSpawnTerminal({
      kind: "kanban",
      projectId: task.projectId ?? undefined,
      projectPath: task.projectPath,
    });
    terminalId = terminal.id;

    await updateKanbanTaskRecord(task.id, {
      column: "ongoing",
      assignedTerminalId: terminalId,
    });

    updateTerminalRecord(terminalId, {
      kanbanTaskId: task.id,
    });

    const prompt = `Task: ${task.title}\n\n${task.description}`;
    await startTerminal(terminalId, prompt);

    io.emit("kanban:updated", {
      taskId: task.id,
      column: "ongoing",
      assignedTerminalId: terminalId,
    });

    console.log(`Kanban: assigned task "${task.title}" to terminal ${terminalId}`);
  } catch (err) {
    if (terminalId) {
      try {
        await deleteTerminal(terminalId);
      } catch {
        // Best effort cleanup for partially created terminals.
      }
    }
    await updateKanbanTaskRecord(task.id, {
      column: "planned",
      assignedTerminalId: null,
    });
    io.emit("kanban:updated", {
      taskId: task.id,
      column: "planned",
      assignedTerminalId: null,
    });
    console.error(`Failed to assign task ${task.id} to an auto-spawned terminal:`, err);
  }
}
