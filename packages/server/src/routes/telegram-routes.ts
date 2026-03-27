import type { FastifyInstance } from "fastify";
import { getSettings } from "../state/settings.js";
import {
  getTelegramStatus,
  startTelegram,
  stopTelegram,
} from "../services/telegram.js";

export async function registerTelegramRoutes(app: FastifyInstance) {
  app.get("/api/integrations/telegram", async () => {
    return getTelegramStatus();
  });

  app.post("/api/integrations/telegram/connect", async (_req, reply) => {
    try {
      const token = getSettings().telegramBotToken || undefined;
      await startTelegram(token);
      return getTelegramStatus();
    } catch (error) {
      return reply.status(500).send({
        error:
          error instanceof Error ? error.message : "Failed to start Telegram bot",
      });
    }
  });

  app.delete("/api/integrations/telegram/connect", async () => {
    await stopTelegram();
    return { ok: true };
  });
}
