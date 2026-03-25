import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { ensureDataDir, ensureDir, nowIso, readJsonFile, writeJsonFile } from "./files.js";
import type { TerminalRecord } from "./types.js";

// Keep the legacy on-disk filenames so existing installs do not need data migration.
const TERMINALS_PATH = path.join(ensureDataDir(), "agents.json");
const TERMINAL_HISTORY_DIR = path.join(ensureDataDir(), "agents");

function readTerminals(): TerminalRecord[] {
  return readJsonFile<TerminalRecord[]>(TERMINALS_PATH, []);
}

function writeTerminals(terminals: TerminalRecord[]): void {
  writeJsonFile(TERMINALS_PATH, terminals);
}

function terminalDir(terminalId: string): string {
  return ensureDir(path.join(TERMINAL_HISTORY_DIR, terminalId));
}

function terminalSnapshotPath(terminalId: string): string {
  return path.join(terminalDir(terminalId), "snapshot.json");
}

function syncTerminalMeta(terminal: TerminalRecord): void {
  writeJsonFile(path.join(terminalDir(terminal.id), "meta.json"), terminal);
}

export function listTerminalRecords(): TerminalRecord[] {
  return readTerminals().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTerminalRecord(terminalId: string): TerminalRecord | null {
  return readTerminals().find((terminal) => terminal.id === terminalId) ?? null;
}

export function findTerminalRecords(
  predicate: (terminal: TerminalRecord) => boolean
): TerminalRecord[] {
  return listTerminalRecords().filter(predicate);
}

export function createTerminalRecord(
  data: Omit<TerminalRecord, "id" | "createdAt" | "updatedAt">
): TerminalRecord {
  const timestamp = nowIso();
  const terminal: TerminalRecord = {
    id: randomUUID(),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const terminals = readTerminals();
  terminals.push(terminal);
  writeTerminals(terminals);
  syncTerminalMeta(terminal);
  return terminal;
}

export function updateTerminalRecord(
  terminalId: string,
  patch: Partial<Omit<TerminalRecord, "id" | "createdAt">>
): TerminalRecord {
  const terminals = readTerminals();
  const index = terminals.findIndex((terminal) => terminal.id === terminalId);
  if (index === -1) {
    throw new Error("Terminal not found");
  }

  const next: TerminalRecord = {
    ...terminals[index],
    ...patch,
    updatedAt: nowIso(),
  };
  terminals[index] = next;
  writeTerminals(terminals);
  syncTerminalMeta(next);
  return next;
}

export function deleteTerminalRecord(terminalId: string): void {
  writeTerminals(readTerminals().filter((terminal) => terminal.id !== terminalId));
}

export function appendTerminalHistory(terminalId: string, data: string): void {
  const historyPath = path.join(terminalDir(terminalId), "transcript.log");
  fs.appendFileSync(historyPath, data);
}

export async function appendTerminalHistoryBatch(
  terminalId: string,
  data: string
): Promise<void> {
  const historyPath = path.join(terminalDir(terminalId), "transcript.log");
  await fs.promises.appendFile(historyPath, data);
}

export interface PersistedTerminalSnapshot {
  cursor: number;
  data: string;
  savedAt: number;
}

export function readTerminalSnapshot(terminalId: string): PersistedTerminalSnapshot | null {
  const snapshot = readJsonFile<Partial<PersistedTerminalSnapshot> | null>(
    terminalSnapshotPath(terminalId),
    null
  );
  if (
    snapshot == null ||
    typeof snapshot.cursor !== "number" ||
    typeof snapshot.data !== "string" ||
    typeof snapshot.savedAt !== "number"
  ) {
    return null;
  }
  return snapshot as PersistedTerminalSnapshot;
}

export function writeTerminalSnapshot(
  terminalId: string,
  snapshot: PersistedTerminalSnapshot
): void {
  writeJsonFile(terminalSnapshotPath(terminalId), snapshot);
}

function trimPartialTerminalTail(content: string): string {
  if (!content) return content;

  const firstNewline = content.indexOf("\n");
  if (firstNewline === -1 || firstNewline === content.length - 1) {
    return content;
  }

  return content.slice(firstNewline + 1);
}

/**
 * Read the transcript log for a terminal.
 * Returns the raw content (up to `maxBytes` from the tail) or an empty string.
 */
export function readTerminalHistory(
  terminalId: string,
  maxBytes = 512 * 1024
): string {
  const historyPath = path.join(terminalDir(terminalId), "transcript.log");
  if (!fs.existsSync(historyPath)) return "";

  const stat = fs.statSync(historyPath);
  if (stat.size === 0) return "";

  if (stat.size <= maxBytes) {
    return fs.readFileSync(historyPath, "utf-8");
  }

  // Read only the tail
  const fd = fs.openSync(historyPath, "r");
  const buffer = Buffer.alloc(maxBytes);
  fs.readSync(fd, buffer, 0, maxBytes, stat.size - maxBytes);
  fs.closeSync(fd);
  return trimPartialTerminalTail(buffer.toString("utf-8"));
}
