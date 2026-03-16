import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import {
  insertTelegramMessage,
  getNextQueuedTelegramMessage,
  updateTelegramMessage,
  telegramMessageExists,
} from "./telegram-store.js";
import {
  onTelegramMessage,
  sendTelegramMessage,
} from "./telegram.js";

let session: AgentSession | null = null;
let isProcessing = false;

const PI_PROJECT_PATH = process.env.PI_PROJECT_PATH || "/tmp/maestro-telegram";
const PI_TIMEOUT_MS = parseInt(process.env.PI_TIMEOUT_MS || "300000", 10);

function nowIso(): string {
  return new Date().toISOString();
}

// ── Pi SDK Session ─────────────────────────────────────────────────

async function ensureSession(): Promise<AgentSession> {
  if (session) return session;

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  // Pick the first available model from the registry (populated from ~/.pi/agent/models.json)
  const available = await modelRegistry.getAvailable();
  const model = available[0];
  if (!model) {
    throw new Error(
      "No model available. Configure an Ollama model in Settings > Pi Agent."
    );
  }
  console.log(`[telegram-queue] Using model: ${model.id} (provider: ${model.provider})`);

  const { session: s } = await createAgentSession({
    cwd: PI_PROJECT_PATH,
    tools: createCodingTools(PI_PROJECT_PATH),
    sessionManager: SessionManager.continueRecent(PI_PROJECT_PATH),
    authStorage,
    modelRegistry,
    model,
  });

  session = s;
  console.log("[telegram-queue] Pi agent session created");
  return s;
}

function sendPrompt(s: AgentSession, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let responseText = "";
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        unsubscribe();
        reject(new Error("Pi agent timed out"));
      }
    }, PI_TIMEOUT_MS);

    const unsubscribe = s.subscribe((event: any) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        responseText += event.assistantMessageEvent.delta;
      }

      if (event.type === "agent_end") {
        done = true;
        clearTimeout(timer);
        unsubscribe();

        const messages = event.messages || [];
        const lastAssistant = messages.findLast((m: any) => m.role === "assistant");
        if (lastAssistant?.stopReason === "error" && lastAssistant?.errorMessage) {
          reject(new Error(lastAssistant.errorMessage));
          return;
        }

        resolve(responseText.trim() || "Agent completed without text output.");
      }
    });

    s.prompt(message).catch((err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        unsubscribe();
        reject(err);
      }
    });
  });
}

// ── Queue Processor ────────────────────────────────────────────────

export function startTelegramQueue(): void {
  onTelegramMessage((chatId, messageId, body, senderName) => {
    onMessage(chatId, messageId, body, senderName);
  });

  console.log("[telegram-queue] Queue processor started");
}

export function stopTelegramQueue(): void {
  session = null;
  console.log("[telegram-queue] Queue processor stopped");
}

function onMessage(
  chatId: string,
  messageId: string,
  body: string,
  senderName: string
): void {
  if (telegramMessageExists(messageId)) {
    console.log(`[telegram-queue] Duplicate message ${messageId}, skipping`);
    return;
  }

  insertTelegramMessage({
    chatId,
    messageId,
    direction: "incoming",
    senderName,
    body,
    status: "queued",
  });

  console.log(`[telegram-queue] Queued message from ${senderName}`);
  processNext();
}

async function processNext(): Promise<void> {
  if (isProcessing) return;

  const msg = getNextQueuedTelegramMessage();
  if (!msg) return;

  isProcessing = true;

  try {
    updateTelegramMessage(msg.id, { status: "processing" });

    const s = await ensureSession();

    // Reset session on "reset" command
    if (msg.body.trim().toLowerCase() === "reset") {
      await s.newSession();
      await sendTelegramMessage(msg.chatId, "Session reset.");
      updateTelegramMessage(msg.id, { status: "completed", responseText: "Session reset.", processedAt: nowIso() });
      console.log("[telegram-queue] Session reset by user");
      return;
    }

    const responseText = await sendPrompt(s, msg.body);

    await sendTelegramMessage(msg.chatId, responseText);

    insertTelegramMessage({
      chatId: msg.chatId,
      messageId: `out_${msg.id}`,
      direction: "outgoing",
      senderName: null,
      body: responseText,
      status: "completed",
    });

    updateTelegramMessage(msg.id, {
      status: "completed",
      responseText,
      processedAt: nowIso(),
    });

    console.log(`[telegram-queue] Completed message ${msg.id}`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[telegram-queue] Failed to process message ${msg.id}:`, errMsg);

    updateTelegramMessage(msg.id, {
      status: "failed",
      error: errMsg,
      processedAt: nowIso(),
    });
  } finally {
    isProcessing = false;
    processNext();
  }
}
