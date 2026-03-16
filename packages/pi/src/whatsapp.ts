import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Server as SocketServer } from "socket.io";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import type { WASocket } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as QRCode from "qrcode";
import type { WhatsAppConnectionStatus } from "@maestro/wire";

const DATA_DIR = path.join(os.homedir(), ".maestro");
const AUTH_DIR = path.join(DATA_DIR, "whatsapp-auth");

let sock: WASocket | null = null;
let io: SocketServer | null = null;
let connectionStatus: WhatsAppConnectionStatus = "disconnected";
let currentQrCode: string | null = null;
let currentQrRaw: string | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let messageCallback: ((chatJid: string, messageId: string, body: string, senderName: string) => void) | null = null;

function getAllowedJids(): string[] {
  const raw = process.env.WHATSAPP_ALLOWED_JIDS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isJidAllowed(jid: string): boolean {
  const allowed = getAllowedJids();
  if (allowed.length === 0) return true;
  return allowed.some((a) => jid.includes(a));
}

function setStatus(status: WhatsAppConnectionStatus) {
  connectionStatus = status;
  io?.emit("whatsapp:status", { status });
}

export function onWhatsAppMessage(
  cb: (chatJid: string, messageId: string, body: string, senderName: string) => void
) {
  messageCallback = cb;
}

export async function startWhatsApp(socketIo: SocketServer): Promise<void> {
  io = socketIo;

  if (sock) {
    console.log("[whatsapp] Already connected, skipping start");
    return;
  }

  setStatus("connecting");
  reconnectAttempts = 0;

  await connectBaileys();
}

async function connectBaileys(): Promise<void> {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, undefined as any),
      },
      generateHighQualityLinkPreview: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        setStatus("qr_pending");
        currentQrRaw = qr;
        QRCode.toDataURL(qr)
          .then((url: string) => {
            currentQrCode = url;
            io?.emit("whatsapp:qr", { qrCode: url });
          })
          .catch((err: unknown) => {
            console.error("[whatsapp] Failed to generate QR code:", err);
          });
        QRCode.toString(qr, { type: "terminal", small: true, margin: 1 })
          .then((ascii: string) => {
            console.log("[whatsapp] Scan this QR code with WhatsApp:\n" + ascii);
            console.log("[whatsapp] If the QR code above doesn't work, use this code manually:\n" + qr);
          })
          .catch(() => {});
      }

      if (connection === "close") {
        sock = null;
        currentQrCode = null;
        currentQrRaw = null;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log("[whatsapp] Logged out — clearing auth state");
          setStatus("disconnected");
          reconnectAttempts = 0;
          return;
        }

        // QR timeout (code 515) — reconnect immediately to show a fresh QR
        const isQrTimeout = statusCode === DisconnectReason.timedOut || statusCode === 515;
        if (isQrTimeout) {
          console.log("[whatsapp] QR expired, reconnecting immediately for a fresh code...");
          setStatus("connecting");
          reconnectTimer = setTimeout(() => connectBaileys(), 1000);
          return;
        }

        // Other disconnects — reconnect with exponential backoff
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
        console.log(`[whatsapp] Connection closed (code=${statusCode}), reconnecting in ${delay}ms...`);
        setStatus("connecting");
        reconnectTimer = setTimeout(() => connectBaileys(), delay);
      }

      if (connection === "open") {
        console.log("[whatsapp] Connected successfully");
        setStatus("connected");
        currentQrCode = null;
        currentQrRaw = null;
        reconnectAttempts = 0;
      }
    });

    sock.ev.on("messages.upsert", (m) => {
      if (m.type !== "notify") return;

      for (const msg of m.messages) {
        // Skip non-text messages
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text;
        if (!text) continue;

        const chatJid = msg.key.remoteJid;
        if (!chatJid) continue;

        if (!isJidAllowed(chatJid)) {
          console.log(`[whatsapp] Ignoring message from non-allowed JID: ${chatJid}`);
          continue;
        }

        const messageId = msg.key.id || "";
        const senderName = msg.pushName || chatJid.split("@")[0];

        console.log(`[whatsapp] Incoming message from ${senderName} (${chatJid}): ${text.slice(0, 80)}`);
        messageCallback?.(chatJid, messageId, text, senderName);
      }
    });
  } catch (error) {
    console.error("[whatsapp] Failed to connect:", error);
    setStatus("disconnected");
  }
}

export async function stopWhatsApp(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sock) {
    sock.end(undefined);
    sock = null;
  }
  currentQrCode = null;
  currentQrRaw = null;
  setStatus("disconnected");
}

export function getWhatsAppStatus(): {
  status: WhatsAppConnectionStatus;
  qrCode: string | null;
  qrRaw: string | null;
} {
  return { status: connectionStatus, qrCode: currentQrCode, qrRaw: currentQrRaw };
}

export async function sendWhatsAppMessage(
  jid: string,
  text: string
): Promise<void> {
  if (!sock) {
    throw new Error("WhatsApp is not connected");
  }
  await sock.sendMessage(jid, { text });
}
