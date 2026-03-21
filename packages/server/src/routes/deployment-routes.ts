import type { FastifyInstance } from "fastify";
import {
  checkDeploymentUpdateStatus,
  getDeploymentUpdateStatus,
  triggerDeploymentRedeploy,
} from "../services/deployment-updater.js";

export async function registerDeploymentRoutes(app: FastifyInstance) {
  app.get("/api/deployment/update-status", async () => {
    return getDeploymentUpdateStatus();
  });

  app.post("/api/deployment/check", async () => {
    return checkDeploymentUpdateStatus();
  });

  app.post("/api/deployment/redeploy", async (req, reply) => {
    try {
      const body = req.body as { tag?: string } | undefined;
      return await triggerDeploymentRedeploy(body?.tag);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to trigger redeploy";
      const status =
        /not configured/i.test(message) || /missing/i.test(message) ? 400 : 502;
      return reply.status(status).send({ error: message });
    }
  });
}
