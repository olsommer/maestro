type TelegramConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

let connectionStatus: TelegramConnectionStatus = "disconnected";
let botToken: string | null = null;
let botUsername: string | null = null;

async function telegramApi(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
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

export async function startTelegram(token?: string): Promise<void> {
  const resolvedToken = token || process.env.TELEGRAM_BOT_TOKEN;
  if (!resolvedToken) {
    connectionStatus = "error";
    throw new Error("No Telegram bot token configured");
  }

  botToken = resolvedToken;
  connectionStatus = "connecting";

  try {
    const me = await telegramApi(resolvedToken, "getMe");
    botUsername = me.username || null;
    connectionStatus = "connected";
  } catch (error) {
    botToken = null;
    botUsername = null;
    connectionStatus = "error";
    throw error;
  }
}

export async function stopTelegram(): Promise<void> {
  botToken = null;
  botUsername = null;
  connectionStatus = "disconnected";
}

export function getTelegramStatus(): {
  status: TelegramConnectionStatus;
  botUsername: string | null;
} {
  return { status: connectionStatus, botUsername };
}
