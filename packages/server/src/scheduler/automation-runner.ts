import crypto from "crypto";
import { createAgent, startAgent } from "../agents/agent-manager.js";
import type { AgentProvider } from "@maestro/wire";
import {
  createAutomationRunRecord,
  listAutomationRecords,
  updateAutomationRecord,
  updateAutomationRunRecord,
} from "../state/sqlite.js";
import { runGitHubApi } from "../integrations/github.js";
import type { AutomationRecord } from "../state/types.js";

let timer: ReturnType<typeof setInterval> | null = null;

export function startAutomationRunner() {
  timer = setInterval(tick, 60_000);
  console.log("Automation runner started (checking every 60s)");
}

export function stopAutomationRunner() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick() {
  try {
    const automations = listAutomationRecords().filter((automation) => automation.enabled);
    const now = new Date();

    for (const auto of automations) {
      if (auto.lastPollAt) {
        const elapsed =
          (now.getTime() - new Date(auto.lastPollAt).getTime()) / 60_000;
        if (elapsed < auto.pollIntervalMinutes) continue;
      }

      await runAutomation(auto);
    }
  } catch (err) {
    console.error("Automation runner tick error:", err);
  }
}

async function runAutomation(auto: AutomationRecord) {
  const run = createAutomationRunRecord({
    automationId: auto.id,
    status: "running",
    itemsFound: 0,
    itemsProcessed: 0,
    error: null,
    agentId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
  });

  try {
    const items = await fetchItems(auto.sourceType, auto.sourceConfig);

    updateAutomationRunRecord(run.id, { itemsFound: items.length });

    let processed = 0;
    let processedHashes = [...auto.processedHashes];

    for (const item of items) {
      const hash = hashItem(item);
      if (processedHashes.includes(hash)) continue;

      const prompt = renderTemplate(auto.agentPromptTemplate, item);
      const agent = await createAgent({
        name: `auto-${auto.name}-${Date.now()}`,
        provider: auto.agentProvider as AgentProvider,
        projectId: auto.agentProjectId || undefined,
        projectPath: auto.agentProjectPath,
        customDisplayName: auto.agentCustomDisplayName || undefined,
        customCommandTemplate: auto.agentCustomCommandTemplate || undefined,
        customEnv: auto.agentCustomEnv || undefined,
        skipPermissions: auto.agentSkipPermissions,
      });

      await startAgent(agent.id, prompt);

      processedHashes = [...processedHashes, hash];
      updateAutomationRecord(auto.id, {
        processedHashes,
      });

      processed += 1;
      updateAutomationRunRecord(run.id, {
        itemsProcessed: processed,
        agentId: agent.id,
      });
    }

    updateAutomationRecord(auto.id, {
      lastPollAt: new Date().toISOString(),
      processedHashes,
    });

    updateAutomationRunRecord(run.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
    });

    if (processed > 0) {
      console.log(`Automation "${auto.name}": processed ${processed}/${items.length} items`);
    }
  } catch (err) {
    console.error(`Automation "${auto.name}" error:`, err);
    updateAutomationRunRecord(run.id, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      completedAt: new Date().toISOString(),
    });
  }
}

interface SourceItem {
  id: string;
  title: string;
  body: string;
  url: string;
  author?: string;
  labels?: string[];
  [key: string]: unknown;
}

async function fetchItems(
  sourceType: string,
  config: Record<string, string>
): Promise<SourceItem[]> {
  switch (sourceType) {
    case "github_issues":
      return fetchGitHubIssues(config);
    case "github_prs":
      return fetchGitHubPRs(config);
    case "webhook":
      return [];
    case "rss":
      return fetchRSS(config);
    default:
      console.warn(`Unknown source type: ${sourceType}`);
      return [];
  }
}

async function fetchGitHubIssues(
  config: Record<string, string>
): Promise<SourceItem[]> {
  const { owner, repo, token, state = "open", labels } = config;
  if (!owner || !repo) return [];

  const params = new URLSearchParams({ state, per_page: "20" });
  if (labels) params.set("labels", labels);

  const data = runGitHubApi<
    Array<{
      number: number;
      title: string;
      body: string;
      html_url: string;
      user: { login: string };
      labels: Array<{ name: string }>;
      pull_request?: unknown;
    }>
  >(`repos/${owner}/${repo}/issues?${params.toString()}`, { token });

  return data
    .filter((item) => !item.pull_request)
    .map((item) => ({
      id: String(item.number),
      title: item.title,
      body: item.body || "",
      url: item.html_url,
      author: item.user.login,
      labels: item.labels.map((label) => label.name),
    }));
}

async function fetchGitHubPRs(
  config: Record<string, string>
): Promise<SourceItem[]> {
  const { owner, repo, token, state = "open" } = config;
  if (!owner || !repo) return [];

  const data = runGitHubApi<
    Array<{
      number: number;
      title: string;
      body: string;
      html_url: string;
      user: { login: string };
      labels: Array<{ name: string }>;
    }>
  >(`repos/${owner}/${repo}/pulls?state=${state}&per_page=20`, { token });

  return data.map((item) => ({
    id: String(item.number),
    title: item.title,
    body: item.body || "",
    url: item.html_url,
    author: item.user.login,
    labels: item.labels.map((label) => label.name),
  }));
}

async function fetchRSS(
  config: Record<string, string>
): Promise<SourceItem[]> {
  const { url } = config;
  if (!url) return [];

  const res = await fetch(url);
  if (!res.ok) return [];

  const xml = await res.text();
  const items: SourceItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];
    const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "";
    const link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    const desc =
      content.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "";

    items.push({
      id: link || title,
      title: title.replace(/<!\[CDATA\[(.*?)\]\]>/, "$1"),
      body: desc.replace(/<!\[CDATA\[(.*?)\]\]>/, "$1"),
      url: link,
    });
  }

  return items;
}

function hashItem(item: SourceItem): string {
  return crypto
    .createHash("sha256")
    .update(`${item.id}:${item.title}`)
    .digest("hex")
    .slice(0, 16);
}

function renderTemplate(template: string, item: SourceItem): string {
  return template.replace(/\{\{\s*item\.(\w+)\s*\}\}/g, (_, key: string) => {
    const val = item[key];
    if (val == null) return "";
    if (Array.isArray(val)) return val.join(", ");
    return String(val);
  });
}
