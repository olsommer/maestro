import type { FastifyInstance } from "fastify";
import { resolveProjectContext } from "../projects/project-service.js";
import {
  createAutomationRecord,
  deleteAutomationRecord,
  getAutomationRecord,
  listAutomationRecords,
  listAutomationRunRecords,
  updateAutomationRecord,
} from "../state/sqlite.js";
import { getProjectRecordById } from "../state/projects.js";

function withProject(automation: ReturnType<typeof getAutomationRecord>) {
  if (!automation) return null;
  const project = automation.agentProjectId
    ? getProjectRecordById(automation.agentProjectId)
    : null;
  return {
    ...automation,
    project: project ? { id: project.id, name: project.name } : null,
    runs: listAutomationRunRecords(automation.id, 5),
  };
}

export async function registerAutomationRoutes(app: FastifyInstance) {
  app.get("/api/automations", async () => {
    const automations = listAutomationRecords().map((automation) => withProject(automation));
    return { automations };
  });

  app.get<{ Params: { id: string } }>(
    "/api/automations/:id",
    async (req, reply) => {
      const auto = getAutomationRecord(req.params.id);
      if (!auto) return reply.status(404).send({ error: "Automation not found" });
      return {
        automation: {
          ...withProject(auto),
          runs: listAutomationRunRecords(auto.id, 20),
        },
      };
    }
  );

  app.post("/api/automations", async (req, reply) => {
    try {
      const body = req.body as {
        name: string;
        description?: string;
        sourceType: string;
        sourceConfig: Record<string, string>;
        triggerType?: string;
        agentProjectId?: string;
        agentProjectPath?: string;
        agentPromptTemplate: string;
        agentProvider?: string;
        agentCustomDisplayName?: string;
        agentCustomCommandTemplate?: string;
        agentCustomEnv?: Record<string, string>;
        agentSkipPermissions?: boolean;
        pollIntervalMinutes?: number;
      };

      if (
        !body.name ||
        !body.sourceType ||
        !body.sourceConfig ||
        !body.agentPromptTemplate
      ) {
        return reply.status(400).send({
          error:
            "name, sourceType, sourceConfig, agentProjectId/agentProjectPath, and agentPromptTemplate are required",
        });
      }

      const projectContext = await resolveProjectContext({
        projectId: body.agentProjectId,
        projectPath: body.agentProjectPath,
      });

      const automation = createAutomationRecord({
        name: body.name,
        description: body.description || null,
        enabled: true,
        sourceType: body.sourceType,
        sourceConfig: body.sourceConfig,
        triggerType: body.triggerType || "on_new",
        agentProjectId: projectContext.projectId,
        agentProjectPath: projectContext.projectPath,
        agentPromptTemplate: body.agentPromptTemplate,
        agentProvider: body.agentProvider || "claude",
        agentCustomDisplayName: body.agentCustomDisplayName || null,
        agentCustomCommandTemplate: body.agentCustomCommandTemplate || null,
        agentCustomEnv: body.agentCustomEnv || null,
        agentSkipPermissions: body.agentSkipPermissions ?? true,
        pollIntervalMinutes: body.pollIntervalMinutes || 5,
        lastPollAt: null,
        processedHashes: [],
      });

      return reply.status(201).send({ automation: withProject(automation) });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to create automation",
      });
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/api/automations/:id",
    async (req, reply) => {
      try {
        const body = req.body as Record<string, unknown> & {
          agentProjectId?: string;
          agentProjectPath?: string;
        };
        const projectContext =
          body.agentProjectId || body.agentProjectPath
            ? await resolveProjectContext({
                projectId: body.agentProjectId,
                projectPath: body.agentProjectPath,
              })
            : null;

        const automation = updateAutomationRecord(req.params.id, {
          ...body,
          ...(projectContext
            ? {
                agentProjectId: projectContext.projectId,
                agentProjectPath: projectContext.projectPath,
              }
            : {}),
        });

        return { automation: withProject(automation) };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to update automation",
        });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/automations/:id",
    async (req, reply) => {
      try {
        deleteAutomationRecord(req.params.id);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to delete automation",
        });
      }
    }
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/automations/:id/runs",
    async (req) => {
      const limit = parseInt(req.query.limit || "20", 10);
      return { runs: listAutomationRunRecords(req.params.id, limit) };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/automations/:id/reset",
    async (req, reply) => {
      try {
        updateAutomationRecord(req.params.id, {
          processedHashes: [],
          lastPollAt: null,
        });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to reset",
        });
      }
    }
  );
}
