import type { FastifyInstance } from "fastify";
import {
  startTelegram,
  stopTelegram,
  getTelegramStatus,
  sendTelegramMessage,
} from "./telegram.js";
import { startTelegramQueue } from "./queue.js";
import { listTelegramMessages } from "./store.js";
import type { Server as SocketServer } from "socket.io";

export async function registerTelegramRoutes(
  app: FastifyInstance,
  io: SocketServer,
  getToken?: () => string
) {
  app.get("/api/integrations/telegram", async () => {
    return getTelegramStatus();
  });

  app.post("/api/integrations/telegram/connect", async (_req, reply) => {
    try {
      const token = getToken?.() || undefined;
      await startTelegram(io, token);
      startTelegramQueue();
      return getTelegramStatus();
    } catch (error) {
      return reply.status(500).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to start Telegram bot",
      });
    }
  });

  app.delete("/api/integrations/telegram/connect", async () => {
    await stopTelegram();
    return { ok: true };
  });

  app.get("/api/integrations/telegram/messages", async (req) => {
    const query = req.query as { chatId?: string; limit?: string };
    const chatId = query.chatId || undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    return listTelegramMessages(chatId, limit);
  });

  app.post("/api/integrations/telegram/send", async (req, reply) => {
    try {
      const body = req.body as { chatId: string; text: string };
      if (!body.chatId || !body.text) {
        return reply
          .status(400)
          .send({ error: "chatId and text are required" });
      }
      await sendTelegramMessage(body.chatId, body.text);
      return { ok: true };
    } catch (error) {
      return reply.status(500).send({
        error:
          error instanceof Error ? error.message : "Failed to send message",
      });
    }
  });
}
