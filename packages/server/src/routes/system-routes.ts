import type { FastifyInstance } from "fastify";
import { getRuntimeStatus } from "../runtime/runtime-status.js";

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get("/api/system/status", async () => {
    return getRuntimeStatus();
  });
}
