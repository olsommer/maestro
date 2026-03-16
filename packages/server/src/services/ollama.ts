import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { OllamaModelInfo } from "@maestro/wire";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const PI_MODELS_PATH = join(homedir(), ".pi", "agent", "models.json");

export async function getOllamaStatus(): Promise<{ running: boolean; host: string }> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/version`);
    return { running: res.ok, host: OLLAMA_HOST };
  } catch {
    return { running: false, host: OLLAMA_HOST };
  }
}

export async function listOllamaModels(): Promise<OllamaModelInfo[]> {
  const res = await fetch(`${OLLAMA_HOST}/api/tags`);
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = (await res.json()) as { models: Array<{ name: string; size: number; digest: string; modified_at: string }> };
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    digest: m.digest,
    modifiedAt: m.modified_at,
  }));
}

// Available models to offer for download
export const RECOMMENDED_MODELS = [
  "llama3.2",
  "llama3.2:1b",
  "llama3.1",
  "llama3.1:70b",
  "mistral",
  "gemma2",
  "gemma2:2b",
  "phi3",
  "qwen2.5",
  "qwen2.5:0.5b",
];

// Pull state tracking
interface PullState {
  model: string;
  status: string;
  progress: number; // 0-100
  error: string | null;
  done: boolean;
}

let activePull: PullState | null = null;

export function getPullStatus(): PullState | null {
  return activePull;
}

export async function pullOllamaModel(modelName: string): Promise<void> {
  if (activePull && !activePull.done) {
    throw new Error(`Already pulling model: ${activePull.model}`);
  }

  activePull = { model: modelName, status: "starting", progress: 0, error: null, done: false };

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama pull failed: ${res.status} ${body}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as {
            status: string;
            digest?: string;
            total?: number;
            completed?: number;
            error?: string;
          };

          if (msg.error) {
            activePull!.error = msg.error;
            activePull!.status = "error";
            activePull!.done = true;
            return;
          }

          activePull!.status = msg.status;
          if (msg.total && msg.completed) {
            activePull!.progress = Math.round((msg.completed / msg.total) * 100);
          }
          if (msg.status === "success") {
            activePull!.progress = 100;
            activePull!.done = true;
          }
        } catch {
          // ignore parse errors on partial lines
        }
      }
    }

    // If we didn't get a success message, mark as done anyway
    if (!activePull!.done) {
      activePull!.done = true;
      activePull!.progress = 100;
      activePull!.status = "success";
    }
  } catch (err) {
    activePull!.error = err instanceof Error ? err.message : String(err);
    activePull!.status = "error";
    activePull!.done = true;
  }
}

/**
 * Write/update ~/.pi/agent/models.json so Pi knows about the selected Ollama model.
 * Preserves any existing non-ollama providers in the config.
 */
export function writePiModelsConfig(modelId: string): void {
  const dir = join(homedir(), ".pi", "agent");
  mkdirSync(dir, { recursive: true });

  // Read existing config to preserve other providers
  let existing: Record<string, unknown> = {};
  if (existsSync(PI_MODELS_PATH)) {
    try {
      existing = JSON.parse(readFileSync(PI_MODELS_PATH, "utf-8"));
    } catch {
      // Corrupted file, start fresh
    }
  }

  const providers = (existing.providers ?? {}) as Record<string, unknown>;

  // Set/overwrite the ollama provider with the selected model
  providers.ollama = {
    baseUrl: `${OLLAMA_HOST}/v1`,
    api: "openai-completions",
    apiKey: "ollama",
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
    models: [{ id: modelId }],
  };

  const config = { ...existing, providers };
  writeFileSync(PI_MODELS_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
