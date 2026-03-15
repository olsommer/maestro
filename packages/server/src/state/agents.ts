import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { ensureDataDir, ensureDir, nowIso, readJsonFile, writeJsonFile } from "./files.js";
import type { AgentRecord } from "./types.js";

const AGENTS_PATH = path.join(ensureDataDir(), "agents.json");
const AGENT_HISTORY_DIR = path.join(ensureDataDir(), "agents");

function readAgents(): AgentRecord[] {
  return readJsonFile<AgentRecord[]>(AGENTS_PATH, []);
}

function writeAgents(agents: AgentRecord[]): void {
  writeJsonFile(AGENTS_PATH, agents);
}

function agentDir(agentId: string): string {
  return ensureDir(path.join(AGENT_HISTORY_DIR, agentId));
}

function syncAgentMeta(agent: AgentRecord): void {
  writeJsonFile(path.join(agentDir(agent.id), "meta.json"), agent);
}

export function listAgentRecords(): AgentRecord[] {
  return readAgents().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getAgentRecord(agentId: string): AgentRecord | null {
  return readAgents().find((agent) => agent.id === agentId) ?? null;
}

export function findAgentRecords(
  predicate: (agent: AgentRecord) => boolean
): AgentRecord[] {
  return listAgentRecords().filter(predicate);
}

export function createAgentRecord(
  data: Omit<AgentRecord, "id" | "createdAt" | "updatedAt">
): AgentRecord {
  const timestamp = nowIso();
  const agent: AgentRecord = {
    id: randomUUID(),
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const agents = readAgents();
  agents.push(agent);
  writeAgents(agents);
  syncAgentMeta(agent);
  return agent;
}

export function updateAgentRecord(
  agentId: string,
  patch: Partial<Omit<AgentRecord, "id" | "createdAt">>
): AgentRecord {
  const agents = readAgents();
  const index = agents.findIndex((agent) => agent.id === agentId);
  if (index === -1) {
    throw new Error("Agent not found");
  }

  const next: AgentRecord = {
    ...agents[index],
    ...patch,
    updatedAt: nowIso(),
  };
  agents[index] = next;
  writeAgents(agents);
  syncAgentMeta(next);
  return next;
}

export function deleteAgentRecord(agentId: string): void {
  writeAgents(readAgents().filter((agent) => agent.id !== agentId));
}

export function appendAgentHistory(agentId: string, data: string): void {
  const historyPath = path.join(agentDir(agentId), "transcript.log");
  fs.appendFileSync(historyPath, data);
}

/**
 * Read the transcript log for an agent.
 * Returns the raw content (up to `maxBytes` from the tail) or an empty string.
 */
export function readAgentHistory(
  agentId: string,
  maxBytes = 512 * 1024
): string {
  const historyPath = path.join(agentDir(agentId), "transcript.log");
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
  return buffer.toString("utf-8");
}
