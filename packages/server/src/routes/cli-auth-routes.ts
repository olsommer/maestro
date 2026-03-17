import type { FastifyInstance } from "fastify";
import {
  getClaudeAuthStatus,
  startClaudeSetupToken,
  completeClaudeSetupToken,
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
    try {
      const result = await startClaudeSetupToken();
      return result;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to start claude setup-token",
      });
    }
  });

  app.post("/api/integrations/claude/setup-token/complete", async (req, reply) => {
    try {
      const body = req.body as { token?: string };
      if (!body.token?.trim()) {
        return reply.status(400).send({ error: "Token is required" });
      }
      const status = await completeClaudeSetupToken(body.token.trim());
      return status;
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Failed to complete setup",
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
