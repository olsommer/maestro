import type { FastifyInstance } from "fastify";

export async function registerSetupRoutes(app: FastifyInstance) {
  // Setup flow is currently disabled — always report setup as complete.
  app.get("/api/setup/status", async () => ({
    needsSetup: false,
    running: false,
  }));

  app.post("/api/setup/reset", async () => {
    return { ok: true };
  });
}
