import type { FastifyInstance } from "fastify";
import {
  isSetupComplete,
  isSetupRunning,
  resetSetup,
} from "../setup/setup-manager.js";

export async function registerSetupRoutes(app: FastifyInstance) {
  app.get("/api/setup/status", async () => ({
    needsSetup: !isSetupComplete(),
    running: isSetupRunning(),
  }));

  app.post("/api/setup/reset", async () => {
    resetSetup();
    return { ok: true };
  });
}
