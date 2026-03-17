import type { FastifyInstance } from "fastify";
import {
  getClaudeAuthStatus,
  getCodexAuthStatus,
  startCodexDeviceAuth,
  connectCodexWithApiKey,
} from "../integrations/cli-auth.js";
import {
  getCachedClaudeAuthStatus,
  getCachedCodexAuthStatus,
  refreshAuthStatus,
} from "../services/auth-status-checker.js";

export async function registerCliAuthRoutes(app: FastifyInstance) {
  // ─── Claude Code ────────────────────────────────────────────────────────

  app.get("/api/integrations/claude/status", async (req) => {
    const fresh = (req.query as Record<string, string>).fresh === "1";
    if (fresh) return getClaudeAuthStatus();
    return getCachedClaudeAuthStatus() ?? getClaudeAuthStatus();
  });

  // ─── Codex ──────────────────────────────────────────────────────────────

  app.get("/api/integrations/codex/status", async (req) => {
    const fresh = (req.query as Record<string, string>).fresh === "1";
    if (fresh) return getCodexAuthStatus();
    return getCachedCodexAuthStatus() ?? getCodexAuthStatus();
  });

  // ─── Refresh all auth status ──────────────────────────────────────────

  app.post("/api/integrations/auth/refresh", async () => {
    await refreshAuthStatus();
    return { ok: true };
  });

  app.post("/api/integrations/codex/device-auth/start", async (_req, reply) => {
    try {
      const result = await startCodexDeviceAuth();
      return result;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to start codex device auth",
      });
    }
  });

  app.post("/api/integrations/codex/connect-api-key", async (req, reply) => {
    try {
      const body = req.body as { apiKey?: string };
      if (!body.apiKey?.trim()) {
        return reply.status(400).send({ error: "API key is required" });
      }
      const status = connectCodexWithApiKey(body.apiKey.trim());
      return status;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to connect with API key",
      });
    }
  });
}
