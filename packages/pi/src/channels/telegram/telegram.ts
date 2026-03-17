import type { Server as SocketServer } from "socket.io";
import type { TelegramConnectionStatus } from "@maestro/wire";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

let io: SocketServer | null = null;
let connectionStatus: TelegramConnectionStatus = "disconnected";
let botToken: string | null = null;
let botUsername: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let lastUpdateId = 0;
let messageCallback: ((chatId: string, messageId: string, body: string, senderName: string) => void) | null = null;

function getAllowedChatIds(): string[] {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isChatAllowed(chatId: string): boolean {
  const allowed = getAllowedChatIds();
  if (allowed.length === 0) return true;
  return allowed.includes(chatId);
}

function setStatus(status: TelegramConnectionStatus) {
  connectionStatus = status;
  io?.emit("telegram:status", { status });
}

async function telegramApi(method: string, body?: Record<string, unknown>): Promise<any> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as { ok: boolean; description?: string; result?: any };
  if (!json.ok) {
    throw new Error(`Telegram API error: ${json.description || "unknown error"}`);
  }
  return json.result;
}

export function onTelegramMessage(
  cb: (chatId: string, messageId: string, body: string, senderName: string) => void
) {
  messageCallback = cb;
}

export async function startTelegram(socketIo: SocketServer, token?: string): Promise<void> {
  io = socketIo;
  const resolvedToken = token || process.env.TELEGRAM_BOT_TOKEN;

  if (!resolvedToken) {
    console.error("[telegram] No bot token provided");
    setStatus("error");
    return;
  }

  botToken = resolvedToken;
  setStatus("connecting");

  try {
    const me = await telegramApi("getMe");
    botUsername = me.username || null;
    console.log(`[telegram] Connected as @${botUsername}`);
    setStatus("connected");
    lastUpdateId = 0;
    pollUpdates();
  } catch (error) {
    console.error("[telegram] Failed to connect:", error);
    setStatus("error");
  }
}

async function pollUpdates(): Promise<void> {
  if (connectionStatus !== "connected" || !botToken) return;

  try {
    const updates: TelegramUpdate[] = await telegramApi("getUpdates", {
      offset: lastUpdateId + 1,
      timeout: 30,
    });

    for (const update of updates) {
      lastUpdateId = update.update_id;

      if (!update.message?.text) continue;

      const chatId = String(update.message.chat.id);
      if (!isChatAllowed(chatId)) {
        console.log(`[telegram] Ignoring message from non-allowed chat: ${chatId}`);
        continue;
      }

      const messageId = String(update.message.message_id);
      const from = update.message.from;
      const senderName = from
        ? [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || chatId
        : chatId;

      console.log(`[telegram] Incoming message from ${senderName} (${chatId}): ${update.message.text.slice(0, 80)}`);
      messageCallback?.(chatId, messageId, update.message.text, senderName);
    }
  } catch (error) {
    console.error("[telegram] Polling error:", error);
  }

  // Schedule next poll
  pollTimer = setTimeout(() => pollUpdates(), 500);
}

export async function stopTelegram(): Promise<void> {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  botToken = null;
  botUsername = null;
  lastUpdateId = 0;
  setStatus("disconnected");
}

export function getTelegramStatus(): {
  status: TelegramConnectionStatus;
  botUsername: string | null;
} {
  return { status: connectionStatus, botUsername };
}

export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<void> {
  if (!botToken) {
    throw new Error("Telegram bot is not connected");
  }

  // Telegram messages have a 4096 character limit
  if (text.length <= 4096) {
    await telegramApi("sendMessage", { chat_id: chatId, text });
    return;
  }

  // Split long messages
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, 4096));
    remaining = remaining.slice(4096);
  }
  for (const chunk of chunks) {
    await telegramApi("sendMessage", { chat_id: chatId, text: chunk });
  }
}
