import type { FastifyInstance } from "fastify";
import {
  connectGitHubToken,
  disconnectGitHubToken,
  getGitHubConnectionStatus,
  searchGitHubRepositories,
} from "../integrations/github.js";
import { getCachedGitHubConnectionStatus } from "../services/auth-status-checker.js";

export async function registerGitHubIntegrationRoutes(app: FastifyInstance) {
  app.get("/api/integrations/github", async (req) => {
    const fresh = (req.query as Record<string, string>).fresh === "1";
    if (fresh) {
      const github = await getGitHubConnectionStatus();
      return { github };
    }
    const cached = getCachedGitHubConnectionStatus();
    const github = cached ?? await getGitHubConnectionStatus();
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
    const github = await disconnectGitHubToken();
    return { ok: true, github };
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
