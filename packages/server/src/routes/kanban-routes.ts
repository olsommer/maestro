import type { FastifyInstance } from "fastify";
import type { Server as SocketServer } from "socket.io";
import { KanbanTaskCreate, KanbanTaskUpdate, KanbanColumn } from "@maestro/wire";
import {
  createKanbanTask,
  deleteKanbanTaskRecord,
  getKanbanTask,
  listKanbanTasks,
  moveKanbanTaskRecord,
  updateKanbanTaskRecord,
} from "../state/kanban.js";

export async function registerKanbanRoutes(
  app: FastifyInstance,
  io: SocketServer
) {
  app.get<{ Querystring: { column?: string; projectId?: string } }>(
    "/api/kanban/tasks",
    async (req) => {
      const tasks = await listKanbanTasks({
        column: req.query.column,
        projectId: req.query.projectId,
      });
      return { tasks };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/kanban/tasks/:id",
    async (req, reply) => {
      const task = await getKanbanTask(req.params.id);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return { task };
    }
  );

  app.post("/api/kanban/tasks", async (req, reply) => {
    try {
      const input = KanbanTaskCreate.parse(req.body);
      const task = await createKanbanTask(input);
      io.emit("kanban:updated", { taskId: task.id, column: task.column });
      return reply.status(201).send({ task });
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : "Invalid input" });
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/api/kanban/tasks/:id",
    async (req, reply) => {
      try {
        const input = KanbanTaskUpdate.parse(req.body);
        const task = await updateKanbanTaskRecord(req.params.id, input);
        io.emit("kanban:updated", {
          taskId: task.id,
          column: task.column,
          assignedTerminalId: task.assignedTerminalId,
        });
        return { task };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to update task",
        });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { column: string } }>(
    "/api/kanban/tasks/:id/move",
    async (req, reply) => {
      try {
        const column = KanbanColumn.parse((req.body as { column: string }).column);
        const task = await moveKanbanTaskRecord(req.params.id, column);
        io.emit("kanban:updated", {
          taskId: task.id,
          column: task.column,
          assignedTerminalId: task.assignedTerminalId,
        });
        return { task };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to move task",
        });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/kanban/tasks/:id",
    async (req, reply) => {
      try {
        await deleteKanbanTaskRecord(req.params.id);
        io.emit("kanban:updated", { taskId: req.params.id });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to delete task",
        });
      }
    }
  );
}
