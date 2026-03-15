import * as path from "path";
import { randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";
import { ensureDataDir, nowIso } from "./files.js";
import type {
  AutomationRecord,
  AutomationRunRecord,
  ScheduledTaskRecord,
} from "./types.js";

const dbPath = path.join(ensureDataDir(), "state.sqlite");
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule TEXT NOT NULL,
    project_id TEXT,
    project_path TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    custom_display_name TEXT,
    custom_command_template TEXT,
    custom_env_json TEXT,
    skip_permissions INTEGER NOT NULL,
    enabled INTEGER NOT NULL,
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    enabled INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_config_json TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    agent_project_id TEXT,
    agent_project_path TEXT NOT NULL,
    agent_prompt_template TEXT NOT NULL,
    agent_provider TEXT NOT NULL,
    agent_model TEXT,
    agent_custom_display_name TEXT,
    agent_custom_command_template TEXT,
    agent_custom_env_json TEXT,
    agent_skip_permissions INTEGER NOT NULL,
    poll_interval_minutes INTEGER NOT NULL,
    last_poll_at TEXT,
    processed_hashes_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    items_found INTEGER NOT NULL,
    items_processed INTEGER NOT NULL,
    error TEXT,
    agent_id TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

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

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toScheduledTask(row: Record<string, unknown>): ScheduledTaskRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    prompt: String(row.prompt),
    schedule: String(row.schedule),
    projectId: row.project_id ? String(row.project_id) : null,
    projectPath: String(row.project_path),
    provider: String(row.provider),
    model: row.model ? String(row.model) : null,
    customDisplayName: row.custom_display_name ? String(row.custom_display_name) : null,
    customCommandTemplate: row.custom_command_template
      ? String(row.custom_command_template)
      : null,
    customEnv: parseJson<Record<string, string> | null>(
      row.custom_env_json as string | null,
      null
    ),
    skipPermissions: Boolean(row.skip_permissions),
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    nextRunAt: row.next_run_at ? String(row.next_run_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toAutomation(row: Record<string, unknown>): AutomationRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    enabled: Boolean(row.enabled),
    sourceType: String(row.source_type),
    sourceConfig: parseJson<Record<string, string>>(String(row.source_config_json), {}),
    triggerType: String(row.trigger_type),
    agentProjectId: row.agent_project_id ? String(row.agent_project_id) : null,
    agentProjectPath: String(row.agent_project_path),
    agentPromptTemplate: String(row.agent_prompt_template),
    agentProvider: String(row.agent_provider),
    agentModel: row.agent_model ? String(row.agent_model) : null,
    agentCustomDisplayName: row.agent_custom_display_name
      ? String(row.agent_custom_display_name)
      : null,
    agentCustomCommandTemplate: row.agent_custom_command_template
      ? String(row.agent_custom_command_template)
      : null,
    agentCustomEnv: parseJson<Record<string, string> | null>(
      row.agent_custom_env_json as string | null,
      null
    ),
    agentSkipPermissions: Boolean(row.agent_skip_permissions),
    pollIntervalMinutes: Number(row.poll_interval_minutes),
    lastPollAt: row.last_poll_at ? String(row.last_poll_at) : null,
    processedHashes: parseJson<string[]>(String(row.processed_hashes_json), []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toAutomationRun(row: Record<string, unknown>): AutomationRunRecord {
  return {
    id: String(row.id),
    automationId: String(row.automation_id),
    status: String(row.status),
    itemsFound: Number(row.items_found),
    itemsProcessed: Number(row.items_processed),
    error: row.error ? String(row.error) : null,
    agentId: row.agent_id ? String(row.agent_id) : null,
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export function listScheduledTaskRecords(): ScheduledTaskRecord[] {
  const rows = db
    .prepare("SELECT * FROM scheduled_tasks ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(toScheduledTask);
}

export function getScheduledTaskRecord(id: string): ScheduledTaskRecord | null {
  const row = db
    .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? toScheduledTask(row) : null;
}

export function createScheduledTaskRecord(
  input: Omit<ScheduledTaskRecord, "id" | "createdAt" | "updatedAt">
): ScheduledTaskRecord {
  const task: ScheduledTaskRecord = {
    id: randomUUID(),
    ...input,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  db.prepare(`
    INSERT INTO scheduled_tasks (
      id, name, prompt, schedule, project_id, project_path, provider, model,
      custom_display_name, custom_command_template, custom_env_json,
      skip_permissions, enabled, last_run_at, next_run_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.name,
    task.prompt,
    task.schedule,
    task.projectId,
    task.projectPath,
    task.provider,
    task.model,
    task.customDisplayName,
    task.customCommandTemplate,
    JSON.stringify(task.customEnv),
    task.skipPermissions ? 1 : 0,
    task.enabled ? 1 : 0,
    task.lastRunAt,
    task.nextRunAt,
    task.createdAt,
    task.updatedAt
  );

  return task;
}

export function updateScheduledTaskRecord(
  id: string,
  patch: Partial<Omit<ScheduledTaskRecord, "id" | "createdAt">>
): ScheduledTaskRecord {
  const current = getScheduledTaskRecord(id);
  if (!current) {
    throw new Error("Task not found");
  }

  const next: ScheduledTaskRecord = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };

  db.prepare(`
    UPDATE scheduled_tasks SET
      name = ?, prompt = ?, schedule = ?, project_id = ?, project_path = ?,
      provider = ?, model = ?, custom_display_name = ?, custom_command_template = ?,
      custom_env_json = ?, skip_permissions = ?, enabled = ?, last_run_at = ?,
      next_run_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.name,
    next.prompt,
    next.schedule,
    next.projectId,
    next.projectPath,
    next.provider,
    next.model,
    next.customDisplayName,
    next.customCommandTemplate,
    JSON.stringify(next.customEnv),
    next.skipPermissions ? 1 : 0,
    next.enabled ? 1 : 0,
    next.lastRunAt,
    next.nextRunAt,
    next.updatedAt,
    id
  );

  return next;
}

export function deleteScheduledTaskRecord(id: string): void {
  db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
}

export function listAutomationRecords(): AutomationRecord[] {
  const rows = db
    .prepare("SELECT * FROM automations ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(toAutomation);
}

export function getAutomationRecord(id: string): AutomationRecord | null {
  const row = db
    .prepare("SELECT * FROM automations WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? toAutomation(row) : null;
}

export function createAutomationRecord(
  input: Omit<AutomationRecord, "id" | "createdAt" | "updatedAt">
): AutomationRecord {
  const automation: AutomationRecord = {
    id: randomUUID(),
    ...input,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  db.prepare(`
    INSERT INTO automations (
      id, name, description, enabled, source_type, source_config_json,
      trigger_type, agent_project_id, agent_project_path, agent_prompt_template,
      agent_provider, agent_model, agent_custom_display_name,
      agent_custom_command_template, agent_custom_env_json,
      agent_skip_permissions, poll_interval_minutes, last_poll_at,
      processed_hashes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    automation.id,
    automation.name,
    automation.description,
    automation.enabled ? 1 : 0,
    automation.sourceType,
    JSON.stringify(automation.sourceConfig),
    automation.triggerType,
    automation.agentProjectId,
    automation.agentProjectPath,
    automation.agentPromptTemplate,
    automation.agentProvider,
    automation.agentModel,
    automation.agentCustomDisplayName,
    automation.agentCustomCommandTemplate,
    JSON.stringify(automation.agentCustomEnv),
    automation.agentSkipPermissions ? 1 : 0,
    automation.pollIntervalMinutes,
    automation.lastPollAt,
    JSON.stringify(automation.processedHashes),
    automation.createdAt,
    automation.updatedAt
  );

  return automation;
}

export function updateAutomationRecord(
  id: string,
  patch: Partial<Omit<AutomationRecord, "id" | "createdAt">>
): AutomationRecord {
  const current = getAutomationRecord(id);
  if (!current) {
    throw new Error("Automation not found");
  }

  const next: AutomationRecord = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };

  db.prepare(`
    UPDATE automations SET
      name = ?, description = ?, enabled = ?, source_type = ?, source_config_json = ?,
      trigger_type = ?, agent_project_id = ?, agent_project_path = ?,
      agent_prompt_template = ?, agent_provider = ?, agent_model = ?,
      agent_custom_display_name = ?, agent_custom_command_template = ?,
      agent_custom_env_json = ?, agent_skip_permissions = ?,
      poll_interval_minutes = ?, last_poll_at = ?, processed_hashes_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    next.name,
    next.description,
    next.enabled ? 1 : 0,
    next.sourceType,
    JSON.stringify(next.sourceConfig),
    next.triggerType,
    next.agentProjectId,
    next.agentProjectPath,
    next.agentPromptTemplate,
    next.agentProvider,
    next.agentModel,
    next.agentCustomDisplayName,
    next.agentCustomCommandTemplate,
    JSON.stringify(next.agentCustomEnv),
    next.agentSkipPermissions ? 1 : 0,
    next.pollIntervalMinutes,
    next.lastPollAt,
    JSON.stringify(next.processedHashes),
    next.updatedAt,
    id
  );

  return next;
}

export function deleteAutomationRecord(id: string): void {
  db.prepare("DELETE FROM automation_runs WHERE automation_id = ?").run(id);
  db.prepare("DELETE FROM automations WHERE id = ?").run(id);
}

export function listAutomationRunRecords(
  automationId: string,
  limit = 20
): AutomationRunRecord[] {
  const rows = db
    .prepare(`
      SELECT * FROM automation_runs
      WHERE automation_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `)
    .all(automationId, limit) as Record<string, unknown>[];
  return rows.map(toAutomationRun);
}

export function createAutomationRunRecord(
  input: Omit<AutomationRunRecord, "id">
): AutomationRunRecord {
  const run: AutomationRunRecord = {
    id: randomUUID(),
    ...input,
  };

  db.prepare(`
    INSERT INTO automation_runs (
      id, automation_id, status, items_found, items_processed, error,
      agent_id, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    run.automationId,
    run.status,
    run.itemsFound,
    run.itemsProcessed,
    run.error,
    run.agentId,
    run.startedAt,
    run.completedAt
  );

  return run;
}

// ── Settings ──────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, nowIso());
}

export function getAllSettings(): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as Array<{ key: string; value: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ── WhatsApp Messages ────────────────────────────────────

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

export function updateAutomationRunRecord(
  id: string,
  patch: Partial<Omit<AutomationRunRecord, "id" | "automationId" | "startedAt">>
): AutomationRunRecord {
  const row = db
    .prepare("SELECT * FROM automation_runs WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Automation run not found");
  }

  const current = toAutomationRun(row);
  const next: AutomationRunRecord = {
    ...current,
    ...patch,
  };

  db.prepare(`
    UPDATE automation_runs SET
      status = ?, items_found = ?, items_processed = ?, error = ?, agent_id = ?, completed_at = ?
    WHERE id = ?
  `).run(
    next.status,
    next.itemsFound,
    next.itemsProcessed,
    next.error,
    next.agentId,
    next.completedAt,
    id
  );

  return next;
}
