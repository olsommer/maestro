import type { FastifyInstance } from "fastify";
import {
  checkForMaestroUpdates,
  getMaestroUpdateStatus,
  triggerMaestroUpdate,
} from "../services/maestro-updater.js";

export async function registerMaestroUpdateRoutes(app: FastifyInstance) {
  app.get("/api/maestro/update-status", async () => {
    return getMaestroUpdateStatus();
  });

  app.post("/api/maestro/check", async () => {
    return checkForMaestroUpdates();
  });

  app.post("/api/maestro/update", async () => {
    return triggerMaestroUpdate();
  });
}
