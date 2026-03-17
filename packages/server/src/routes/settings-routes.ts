import type { FastifyInstance } from "fastify";
import { SettingsUpdateSchema } from "@maestro/wire";
import { getSettings, updateSettings } from "../state/settings.js";
import {
  getUpdateStatus,
  checkForUpdates,
  performUpdate,
  restartAutoUpdater,
} from "../services/auto-updater.js";
import { writePiModelsConfig } from "../services/ollama.js";

export async function registerSettingsRoutes(app: FastifyInstance) {
  // Get current settings
  app.get("/api/settings", async () => {
    return getSettings();
  });

  // Update settings
  app.patch("/api/settings", async (req, reply) => {
    const parsed = SettingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const settings = updateSettings(parsed.data);

    // Restart the auto-updater timer if settings changed
    restartAutoUpdater();

    // Write Pi's models.json when Ollama model is configured
    if (parsed.data.piOllamaModel) {
      writePiModelsConfig(parsed.data.piOllamaModel);
    }

    return settings;
  });

  // Get Deepgram API key for client-side voice input
  app.get("/api/settings/deepgram-key", async (_req, reply) => {
    const settings = getSettings();
    if (!settings.deepgramApiKey) {
      return reply.status(404).send({ error: "Deepgram API key not configured" });
    }
    return { apiKey: settings.deepgramApiKey };
  });

  // Get update status (installed versions, available updates)
  app.get("/api/settings/update-status", async () => {
    return getUpdateStatus();
  });

  // Manually check for updates (does not install)
  app.post("/api/settings/check-updates", async () => {
    await checkForUpdates();
    return getUpdateStatus();
  });

  // Manually trigger update now
  app.post("/api/settings/update-now", async () => {
    const result = await performUpdate();
    return {
      ...result,
      status: getUpdateStatus(),
    };
  });
}
