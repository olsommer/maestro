import type { FastifyInstance } from "fastify";
import { ProjectCreateInput } from "@maestro/wire";
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  syncGitHubIssues,
} from "../projects/project-service.js";

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async () => {
    const projects = await listProjects();
    return { projects };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const project = await getProjectById(req.params.id);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }
    return { project };
  });

  app.post("/api/projects", async (req, reply) => {
    try {
      const input = ProjectCreateInput.parse(req.body);
      const project = await createProject(input);
      return reply.status(201).send({ project });
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "Failed to create project",
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    try {
      await deleteProject(req.params.id);
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete project";
      return reply.status(message === "Project not found" ? 404 : 400).send({
        error: message,
      });
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/sync/github-issues",
    async (req, reply) => {
      try {
        const result = await syncGitHubIssues(req.params.id);
        const project = await getProjectById(req.params.id);
        return { ok: true, ...result, project };
      } catch (err) {
        return reply.status(400).send({
          error:
            err instanceof Error ? err.message : "Failed to sync GitHub issues",
        });
      }
    }
  );
}
