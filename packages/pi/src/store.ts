import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(os.homedir(), ".maestro");
fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "pi.sqlite");
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,
    chat_jid TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    direction TEXT NOT NULL,
    sender_name TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    response_text TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_wa_status ON whatsapp_messages(status);
  CREATE INDEX IF NOT EXISTS idx_wa_chat ON whatsapp_messages(chat_jid, created_at);
`);

function nowIso(): string {
  return new Date().toISOString();
}

export interface WhatsAppMessageRow {
  id: string;
  chatJid: string;
  messageId: string;
  direction: "incoming" | "outgoing";
  senderName: string | null;
  body: string;
  status: "queued" | "processing" | "completed" | "failed";
  responseText: string | null;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

function toWhatsAppMessage(row: Record<string, unknown>): WhatsAppMessageRow {
  return {
    id: String(row.id),
    chatJid: String(row.chat_jid),
    messageId: String(row.message_id),
    direction: String(row.direction) as "incoming" | "outgoing",
    senderName: row.sender_name ? String(row.sender_name) : null,
    body: String(row.body),
    status: String(row.status) as WhatsAppMessageRow["status"],
    responseText: row.response_text ? String(row.response_text) : null,
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    processedAt: row.processed_at ? String(row.processed_at) : null,
  };
}

export function insertWhatsAppMessage(input: {
  chatJid: string;
  messageId: string;
  direction: "incoming" | "outgoing";
  senderName: string | null;
  body: string;
  status?: string;
}): WhatsAppMessageRow {
  const id = randomUUID();
  const now = nowIso();
  const status = input.status ?? "queued";

  db.prepare(`
    INSERT INTO whatsapp_messages (id, chat_jid, message_id, direction, sender_name, body, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.chatJid, input.messageId, input.direction, input.senderName, input.body, status, now);

  return {
    id,
    chatJid: input.chatJid,
    messageId: input.messageId,
    direction: input.direction,
    senderName: input.senderName,
    body: input.body,
    status: status as WhatsAppMessageRow["status"],
    responseText: null,
    error: null,
    createdAt: now,
    processedAt: null,
  };
}

export function getNextQueuedMessage(): WhatsAppMessageRow | null {
  const row = db
    .prepare("SELECT * FROM whatsapp_messages WHERE status = 'queued' AND direction = 'incoming' ORDER BY created_at ASC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return row ? toWhatsAppMessage(row) : null;
}

export function updateWhatsAppMessage(
  id: string,
  patch: Partial<Pick<WhatsAppMessageRow, "status" | "responseText" | "error" | "processedAt">>
): void {
  const sets: string[] = [];
  const values: (string | null)[] = [];

  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status ?? null); }
  if (patch.responseText !== undefined) { sets.push("response_text = ?"); values.push(patch.responseText ?? null); }
  if (patch.error !== undefined) { sets.push("error = ?"); values.push(patch.error ?? null); }
  if (patch.processedAt !== undefined) { sets.push("processed_at = ?"); values.push(patch.processedAt ?? null); }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE whatsapp_messages SET ${sets.join(", ")} WHERE id = ?`).run(...(values as string[]));
}

export function getWhatsAppMessageHistory(chatJid: string, limit = 20): WhatsAppMessageRow[] {
  const rows = db
    .prepare("SELECT * FROM whatsapp_messages WHERE chat_jid = ? ORDER BY created_at DESC LIMIT ?")
    .all(chatJid, limit) as Record<string, unknown>[];
  return rows.map(toWhatsAppMessage).reverse();
}

export function listWhatsAppMessages(chatJid?: string, limit = 50): WhatsAppMessageRow[] {
  if (chatJid) {
    const rows = db
      .prepare("SELECT * FROM whatsapp_messages WHERE chat_jid = ? ORDER BY created_at DESC LIMIT ?")
      .all(chatJid, limit) as Record<string, unknown>[];
    return rows.map(toWhatsAppMessage);
  }
  const rows = db
    .prepare("SELECT * FROM whatsapp_messages ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return rows.map(toWhatsAppMessage);
}

export function whatsAppMessageExists(messageId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM whatsapp_messages WHERE message_id = ?")
    .get(messageId);
  return !!row;
}
