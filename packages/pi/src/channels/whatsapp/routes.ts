import type { FastifyInstance } from "fastify";
import {
  startWhatsApp,
  stopWhatsApp,
  getWhatsAppStatus,
  sendWhatsAppMessage,
} from "./whatsapp.js";
import { listWhatsAppMessages } from "./store.js";
import type { Server as SocketServer } from "socket.io";

export async function registerWhatsAppRoutes(
  app: FastifyInstance,
  io: SocketServer
) {
  app.get("/api/integrations/whatsapp", async () => {
    return getWhatsAppStatus();
  });

  app.post("/api/integrations/whatsapp/connect", async (_req, reply) => {
    try {
      await startWhatsApp(io);
      return getWhatsAppStatus();
    } catch (error) {
      return reply.status(500).send({
        error:
          error instanceof Error
            ? error.message
            : "Failed to start WhatsApp",
      });
    }
  });

  app.delete("/api/integrations/whatsapp/connect", async () => {
    await stopWhatsApp();
    return { ok: true };
  });

  app.get("/api/integrations/whatsapp/messages", async (req) => {
    const query = req.query as { chatJid?: string; limit?: string };
    const chatJid = query.chatJid || undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    return listWhatsAppMessages(chatJid, limit);
  });

  app.post("/api/integrations/whatsapp/send", async (req, reply) => {
    try {
      const body = req.body as { jid: string; text: string };
      if (!body.jid || !body.text) {
        return reply
          .status(400)
          .send({ error: "jid and text are required" });
      }
      await sendWhatsAppMessage(body.jid, body.text);
      return { ok: true };
    } catch (error) {
      return reply.status(500).send({
        error:
          error instanceof Error ? error.message : "Failed to send message",
      });
    }
  });
}
