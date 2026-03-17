import type { FastifyInstance } from "fastify";
import {
  getClaudeAuthStatus,
  startClaudeLogin,
  completeClaudeLogin,
  getCodexAuthStatus,
  startCodexDeviceAuth,
  connectCodexWithApiKey,
} from "../integrations/cli-auth.js";

export async function registerCliAuthRoutes(app: FastifyInstance) {
  // ─── Claude Code ────────────────────────────────────────────────────────

  app.get("/api/integrations/claude/status", async () => {
    return getClaudeAuthStatus();
  });

  app.post("/api/integrations/claude/setup-token/start", async (_req, reply) => {
    console.log("[claude-route] POST /setup-token/start hit");
    try {
      const result = await startClaudeLogin();
      console.log("[claude-route] startClaudeLogin resolved:", JSON.stringify(result));
      return result;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to start Claude login",
      });
    }
  });

  app.post("/api/integrations/claude/setup-token/complete", async (req, reply) => {
    try {
      const body = req.body as { token?: string };
      if (!body.token?.trim()) {
        return reply.status(400).send({ error: "Code is required" });
      }
      const status = await completeClaudeLogin(body.token.trim());
      return status;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to complete login",
      });
    }
  });

  // ─── Codex ──────────────────────────────────────────────────────────────

  app.get("/api/integrations/codex/status", async () => {
    return getCodexAuthStatus();
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
