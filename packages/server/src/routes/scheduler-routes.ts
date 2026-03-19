import type { FastifyInstance } from "fastify";
import { registerJob, unregisterJob, cronToHuman } from "../scheduler/scheduler.js";
import { resolveProjectContext } from "../projects/project-service.js";
import {
  createScheduledTaskRecord,
  deleteScheduledTaskRecord,
  getScheduledTaskRecord,
  listScheduledTaskRecords,
  updateScheduledTaskRecord,
} from "../state/sqlite.js";
import { getProjectRecordById } from "../state/projects.js";

function withProject(task: ReturnType<typeof getScheduledTaskRecord>) {
  if (!task) return null;
  const project = task.projectId ? getProjectRecordById(task.projectId) : null;
  return {
    ...task,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

export async function registerSchedulerRoutes(app: FastifyInstance) {
  app.get("/api/scheduler/tasks", async () => {
    const tasks = listScheduledTaskRecords().map((task) => ({
      ...withProject(task),
      scheduleHuman: cronToHuman(task.schedule),
    }));
    return { tasks };
  });

  app.get<{ Params: { id: string } }>(
    "/api/scheduler/tasks/:id",
    async (req, reply) => {
      const task = getScheduledTaskRecord(req.params.id);
      if (!task) return reply.status(404).send({ error: "Task not found" });
      return {
        task: {
          ...withProject(task),
          scheduleHuman: cronToHuman(task.schedule),
        },
      };
    }
  );

  app.post("/api/scheduler/tasks", async (req, reply) => {
    try {
      const body = req.body as {
        name: string;
        prompt: string;
        schedule: string;
        projectId?: string;
        projectPath?: string;
        provider?: string;
        customDisplayName?: string;
        customCommandTemplate?: string;
        customEnv?: Record<string, string>;
        skipPermissions?: boolean;
        enabled?: boolean;
      };

      if (!body.name || !body.prompt || !body.schedule) {
        return reply
          .status(400)
          .send({ error: "name, prompt, schedule, and projectId/projectPath are required" });
      }

      const projectContext = await resolveProjectContext({
        projectId: body.projectId,
        projectPath: body.projectPath,
      });

      const task = createScheduledTaskRecord({
        name: body.name,
        prompt: body.prompt,
        schedule: body.schedule,
        projectId: projectContext.projectId,
        projectPath: projectContext.projectPath,
        provider: body.provider || "claude",
        customDisplayName: body.customDisplayName || null,
        customCommandTemplate: body.customCommandTemplate || null,
        customEnv: body.customEnv || null,
        skipPermissions: body.skipPermissions ?? true,
        enabled: body.enabled ?? true,
        lastRunAt: null,
        nextRunAt: null,
      });

      if (task.enabled) {
        registerJob(task);
      }

      return reply.status(201).send({ task: withProject(task) });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to create task",
      });
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/api/scheduler/tasks/:id",
    async (req, reply) => {
      try {
        const body = req.body as Partial<{
          name: string;
          prompt: string;
          schedule: string;
          projectId: string;
          projectPath: string;
          provider: string;
          customDisplayName: string;
          customCommandTemplate: string;
          customEnv: Record<string, string>;
          skipPermissions: boolean;
          enabled: boolean;
        }>;

        const projectContext =
          body.projectId || body.projectPath
            ? await resolveProjectContext({
                projectId: body.projectId,
                projectPath: body.projectPath,
              })
            : null;

        const task = updateScheduledTaskRecord(req.params.id, {
          ...body,
          ...(projectContext
            ? {
                projectId: projectContext.projectId,
                projectPath: projectContext.projectPath,
              }
            : {}),
        });

        if (task.enabled) {
          registerJob(task);
        } else {
          unregisterJob(task.id);
        }

        return { task: withProject(task) };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to update task",
        });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/scheduler/tasks/:id",
    async (req, reply) => {
      try {
        unregisterJob(req.params.id);
        deleteScheduledTaskRecord(req.params.id);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to delete task",
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/scheduler/tasks/:id/run",
    async (req, reply) => {
      try {
        const task = getScheduledTaskRecord(req.params.id);
        if (!task) return reply.status(404).send({ error: "Task not found" });

        const { createTerminal, createAutoSpawnTerminal, startTerminal } = await import("../agents/terminal-manager.js");

        const name = `manual-${task.name}-${Date.now()}`;
        const agent = task.provider === "custom"
          ? await createTerminal({
              name,
              kind: "scheduler",
              provider: task.provider as "custom",
              projectId: task.projectId || undefined,
              projectPath: task.projectPath,
              customDisplayName: task.customDisplayName || undefined,
              customCommandTemplate: task.customCommandTemplate || undefined,
              customEnv: task.customEnv || undefined,
              skipPermissions: task.skipPermissions,
            })
          : await createAutoSpawnTerminal({
              name,
              kind: "scheduler",
              projectId: task.projectId || undefined,
              projectPath: task.projectPath,
            });

        await startTerminal(agent.id, task.prompt);
        updateScheduledTaskRecord(task.id, {
          lastRunAt: new Date().toISOString(),
        });

        return { ok: true, terminalId: agent.id };
      } catch (err) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : "Failed to run task",
        });
      }
    }
  );
}
