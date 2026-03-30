import type { FastifyInstance } from "fastify";
import { resolveProjectContext } from "../projects/project-service.js";
import { getSettings } from "../state/settings.js";
import {
  createAutomationRecord,
  deleteAutomationRecord,
  getAutomationRecord,
  listAutomationRecords,
  listAutomationRunRecords,
  updateAutomationRecord,
} from "../state/sqlite.js";
import { getProjectRecordById } from "../state/projects.js";

function defaultAutomationPromptTemplate(sourceType: string): string {
  if (sourceType === "github_mentions") {
    return [
      "Review this GitHub thread where @maestro was mentioned and carry out the requested work.",
      "",
      "Repository: {{ item.repoFullName }}",
      "Type: {{ item.issueKind }}",
      "Title: {{ item.title }}",
      "URL: {{ item.url }}",
      "Triggered by: {{ item.triggerType }} from {{ item.triggerAuthor }}",
      "Trigger URL: {{ item.triggerUrl }}",
      "",
      "Trigger text:",
      "{{ item.triggerBody }}",
      "",
      "Full thread:",
      "{{ item.thread }}",
    ].join("\n");
  }

  return "";
}

function withProject(automation: ReturnType<typeof getAutomationRecord>) {
  if (!automation) return null;
  const project = automation.agentProjectId
    ? getProjectRecordById(automation.agentProjectId)
    : null;
  return {
    ...automation,
    project: project
      ? {
          id: project.id,
          name: project.name,
          githubOwner: project.githubOwner,
          githubRepo: project.githubRepo,
        }
      : null,
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
        agentProjectId?: string;
        pollIntervalMinutes?: number;
      };

      if (!body.name || !body.agentProjectId) {
        return reply.status(400).send({
          error: "name and agentProjectId are required",
        });
      }

      const projectContext = await resolveProjectContext({ projectId: body.agentProjectId });
      const project = projectContext.project;

      if (!project) {
        return reply.status(400).send({ error: "Project not found" });
      }
      if (!project.githubOwner || !project.githubRepo) {
        return reply.status(400).send({
          error: "Automations currently require a GitHub-linked project",
        });
      }

      const settings = getSettings();
      const sourceType = "github_mentions";

      const automation = createAutomationRecord({
        name: body.name,
        description: null,
        enabled: true,
        sourceType,
        sourceConfig: {
          owner: project.githubOwner,
          repo: project.githubRepo,
        },
        triggerType: "on_new",
        agentProjectId: projectContext.projectId,
        agentProjectPath: projectContext.projectPath,
        agentPromptTemplate: defaultAutomationPromptTemplate(sourceType),
        agentProvider: settings.agentDefaultProvider,
        agentCustomDisplayName: null,
        agentCustomCommandTemplate: null,
        agentCustomEnv: null,
        agentSkipPermissions: settings.agentDefaultSkipPermissions,
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
