import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server as SocketServer } from "socket.io";
import { initTerminalManager, restorePersistentTerminals } from "./agents/terminal-manager.js";
import { killAllPty } from "./agents/pty-manager.js";
import { registerTerminalRoutes } from "./routes/terminal-routes.js";
import { registerProjectRoutes } from "./routes/project-routes.js";
import { registerKanbanRoutes } from "./routes/kanban-routes.js";
import { registerSocketHandlers } from "./socket/handlers.js";
import { startKanbanAssigner, stopKanbanAssigner } from "./agents/kanban-assigner.js";
import { registerSchedulerRoutes } from "./routes/scheduler-routes.js";
import { registerAutomationRoutes } from "./routes/automation-routes.js";
import { startScheduler, stopScheduler } from "./scheduler/scheduler.js";
import { startAutomationRunner, stopAutomationRunner } from "./scheduler/automation-runner.js";
import { initAuth, registerAuthHook, registerAuthRoutes, verifySessionToken } from "./auth/auth.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { registerCliAuthRoutes } from "./routes/cli-auth-routes.js";
import { registerGitHubIntegrationRoutes } from "./routes/github-integration-routes.js";
import { registerWebhookRoutes } from "./routes/webhook-routes.js";
import { registerSettingsRoutes } from "./routes/settings-routes.js";
import { registerDeploymentRoutes } from "./routes/deployment-routes.js";
import { getRuntimeStatus } from "./runtime/runtime-status.js";
import { startAutoUpdater, stopAutoUpdater } from "./services/auto-updater.js";
import { startAuthStatusChecker, stopAuthStatusChecker } from "./services/auth-status-checker.js";
import { registerSetupRoutes } from "./routes/setup-routes.js";
import { registerOllamaRoutes } from "./routes/ollama-routes.js";
import { registerWhatsAppRoutes, startWhatsApp, stopWhatsApp, startWhatsAppQueue, stopWhatsAppQueue } from "@maestro/pi";
import { registerTelegramRoutes, startTelegram, stopTelegram, startTelegramQueue, stopTelegramQueue } from "@maestro/pi";
import { getSettings as getSettingsState } from "./state/settings.js";
import { writePiModelsConfig } from "./services/ollama.js";

const PORT = parseInt(process.env.PORT || "4800", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  console.log("Starting Maestro server...");

  // 2. Initialize auth
  const { apiToken } = initAuth();
  console.log(`API token: ${apiToken}`);

  // 3. Create Fastify app
  const app = Fastify({ logger: false });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    req.rawBody = rawBody;

    try {
      const text = rawBody.length > 0 ? rawBody.toString("utf8") : "";
      done(null, text ? JSON.parse(text) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  await app.register(cors, { origin: true });

  // 4. Register auth hook and routes
  registerAuthHook(app);
  await registerAuthRoutes(app);

  // 5. Create Socket.io server attached to Fastify's underlying HTTP server
  const io = new SocketServer(app.server, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
  });

  // Socket.io auth middleware
  io.use((socket, next) => {
    if (process.env.AUTH_DISABLED === "1") return next();
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Missing auth token"));
    if (token === apiToken) return next();
    const payload = verifySessionToken(token);
    if (payload) return next();
    return next(new Error("Invalid auth token"));
  });

  // 6. Initialize terminal manager with dependencies
  initTerminalManager({ io });

  // 7. Register routes
  await registerProjectRoutes(app);
  await registerTerminalRoutes(app);
  await registerKanbanRoutes(app, io);

  await registerSchedulerRoutes(app);
  await registerAutomationRoutes(app);
  await registerSystemRoutes(app);
  await registerCliAuthRoutes(app);
  await registerGitHubIntegrationRoutes(app);
  await registerWebhookRoutes(app, io);
  await registerSettingsRoutes(app);
  await registerDeploymentRoutes(app);
  await registerSetupRoutes(app);
  await registerWhatsAppRoutes(app, io);
  await registerTelegramRoutes(app, io, () => getSettingsState().telegramBotToken);
  await registerOllamaRoutes(app);

  // 8. Register socket handlers
  registerSocketHandlers(io);

  // 9. Start background services
  startKanbanAssigner(io);
  await restorePersistentTerminals();
  await startScheduler();
  startAutomationRunner();
  startAutoUpdater();
  startAuthStatusChecker();

  // Ensure Pi models.json is written if a model is configured
  const savedPiModel = getSettingsState().piOllamaModel;
  if (savedPiModel) {
    writePiModelsConfig(savedPiModel);
    console.log(`[startup] Pi models.json written for model: ${savedPiModel}`);
  }

  // Start WhatsApp if enabled
  if (process.env.WHATSAPP_ENABLED === "1") {
    await startWhatsApp(io);
    startWhatsAppQueue();
    console.log("[startup] WhatsApp integration enabled");
  }

  // Start Telegram if enabled (via env var or saved token in settings)
  const savedTelegramToken = getSettingsState().telegramBotToken;
  if (process.env.TELEGRAM_ENABLED === "1" || savedTelegramToken) {
    await startTelegram(io, savedTelegramToken || undefined);
    startTelegramQueue();
    console.log("[startup] Telegram integration enabled");
  }

  // 10. Health check
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  const runtimeStatus = getRuntimeStatus();
  if (runtimeStatus.github.needsAuthWarning) {
    console.warn(
      "[startup] GitHub-backed features are configured, but GITHUB_TOKEN/GH_TOKEN is missing."
    );
  }

  // 11. Start server
  await app.listen({ port: PORT, host: HOST });
  console.log(`Maestro server listening on http://${HOST}:${PORT}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    stopKanbanAssigner();
    stopScheduler();
    stopAutomationRunner();
    stopAutoUpdater();
    stopAuthStatusChecker();
    stopWhatsAppQueue();
    await stopWhatsApp();
    stopTelegramQueue();
    await stopTelegram();
    killAllPty();
    io.close();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start Maestro:", err);
  process.exit(1);
});
