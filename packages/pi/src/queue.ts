import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import {
  insertWhatsAppMessage,
  getNextQueuedMessage,
  updateWhatsAppMessage,
  whatsAppMessageExists,
} from "./store.js";
import {
  onWhatsAppMessage,
  sendWhatsAppMessage,
} from "./whatsapp.js";

let session: AgentSession | null = null;
let isProcessing = false;

const PI_PROJECT_PATH = process.env.PI_PROJECT_PATH || "/tmp/maestro-whatsapp";
const PI_TIMEOUT_MS = parseInt(process.env.PI_TIMEOUT_MS || "300000", 10);

function nowIso(): string {
  return new Date().toISOString();
}

// ── Pi SDK Session ─────────────────────────────────────────────────

async function ensureSession(): Promise<AgentSession> {
  if (session) return session;

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  const { session: s } = await createAgentSession({
    cwd: PI_PROJECT_PATH,
    tools: createCodingTools(PI_PROJECT_PATH),
    sessionManager: SessionManager.continueRecent(PI_PROJECT_PATH),
    authStorage,
    modelRegistry,
  });

  session = s;
  console.log("[whatsapp-queue] Pi agent session created");
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

        // Check for errors in the last assistant message
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

export function startWhatsAppQueue(): void {
  onWhatsAppMessage((chatJid, messageId, body, senderName) => {
    onMessage(chatJid, messageId, body, senderName);
  });

  console.log("[whatsapp-queue] Queue processor started");
}

export function stopWhatsAppQueue(): void {
  session = null;
  console.log("[whatsapp-queue] Queue processor stopped");
}

function onMessage(
  chatJid: string,
  messageId: string,
  body: string,
  senderName: string
): void {
  if (whatsAppMessageExists(messageId)) {
    console.log(`[whatsapp-queue] Duplicate message ${messageId}, skipping`);
    return;
  }

  insertWhatsAppMessage({
    chatJid,
    messageId,
    direction: "incoming",
    senderName,
    body,
    status: "queued",
  });

  console.log(`[whatsapp-queue] Queued message from ${senderName}`);
  processNext();
}

async function processNext(): Promise<void> {
  if (isProcessing) return;

  const msg = getNextQueuedMessage();
  if (!msg) return;

  isProcessing = true;

  try {
    updateWhatsAppMessage(msg.id, { status: "processing" });

    const s = await ensureSession();

    // Reset session on "reset" command
    if (msg.body.trim().toLowerCase() === "reset") {
      await s.newSession();
      await sendWhatsAppMessage(msg.chatJid, "Session reset.");
      updateWhatsAppMessage(msg.id, { status: "completed", responseText: "Session reset.", processedAt: nowIso() });
      console.log("[whatsapp-queue] Session reset by user");
      return;
    }

    const responseText = await sendPrompt(s, msg.body);

    await sendWhatsAppMessage(msg.chatJid, responseText);

    insertWhatsAppMessage({
      chatJid: msg.chatJid,
      messageId: `out_${msg.id}`,
      direction: "outgoing",
      senderName: null,
      body: responseText,
      status: "completed",
    });

    updateWhatsAppMessage(msg.id, {
      status: "completed",
      responseText,
      processedAt: nowIso(),
    });

    console.log(`[whatsapp-queue] Completed message ${msg.id}`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[whatsapp-queue] Failed to process message ${msg.id}:`, errMsg);

    updateWhatsAppMessage(msg.id, {
      status: "failed",
      error: errMsg,
      processedAt: nowIso(),
    });
  } finally {
    isProcessing = false;
    processNext();
  }
}
