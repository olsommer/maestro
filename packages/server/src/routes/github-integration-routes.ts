import type { FastifyInstance } from "fastify";
import {
  completeGhDeviceAuth,
  connectGitHubToken,
  disconnectGitHubToken,
  getGitHubConnectionStatus,
  searchGitHubRepositories,
  startGhDeviceAuth,
} from "../integrations/github.js";

export async function registerGitHubIntegrationRoutes(app: FastifyInstance) {
  app.get("/api/integrations/github", async () => {
    const github = await getGitHubConnectionStatus();
    return { github };
  });

  app.post("/api/integrations/github/connect", async (req, reply) => {
    try {
      const body = req.body as { token?: string };
      const github = await connectGitHubToken(body.token ?? "");
      return { github };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to connect GitHub",
      });
    }
  });

  app.delete("/api/integrations/github/connect", async () => {
    const github = disconnectGitHubToken();
    return { ok: true, github };
  });

  app.post("/api/integrations/github/device-auth/start", async (_req, reply) => {
    try {
      const result = await startGhDeviceAuth();
      return result;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to start device auth",
      });
    }
  });

  app.post("/api/integrations/github/device-auth/complete", async (_req, reply) => {
    try {
      const github = await completeGhDeviceAuth();
      return { github };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to complete device auth",
      });
    }
  });

  app.get<{ Querystring: { q?: string } }>(
    "/api/integrations/github/repos",
    async (req, reply) => {
      try {
        const repos = await searchGitHubRepositories(req.query.q ?? "");
        return { repos };
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to load repositories",
        });
      }
    }
  );
}
