import type { FastifyInstance } from "fastify";
import {
  getOllamaStatus,
  listOllamaModels,
  pullOllamaModel,
  getPullStatus,
  RECOMMENDED_MODELS,
} from "../services/ollama.js";

export async function registerOllamaRoutes(app: FastifyInstance) {
  // Ollama connection status
  app.get("/api/ollama/status", async () => {
    return getOllamaStatus();
  });

  // List locally available models
  app.get("/api/ollama/models", async (_req, reply) => {
    try {
      const models = await listOllamaModels();
      return { models };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Cannot reach Ollama",
      });
    }
  });

  // List recommended models for download
  app.get("/api/ollama/recommended", async () => {
    return { models: RECOMMENDED_MODELS };
  });

  // Pull (download) a model — async, returns immediately
  app.post("/api/ollama/pull", async (req, reply) => {
    const { model } = req.body as { model?: string };
    if (!model || typeof model !== "string") {
      return reply.status(400).send({ error: "model is required" });
    }
    try {
      // Fire and forget — client polls /api/ollama/pull/status
      void pullOllamaModel(model);
      return { ok: true, model };
    } catch (err) {
      return reply.status(409).send({
        error: err instanceof Error ? err.message : "Pull failed",
      });
    }
  });

  // Poll pull progress
  app.get("/api/ollama/pull/status", async () => {
    return getPullStatus() ?? { model: null, status: "idle", progress: 0, error: null, done: true };
  });
}
