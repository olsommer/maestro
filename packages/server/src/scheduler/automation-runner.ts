import crypto from "crypto";
import { nowIso } from "../state/files.js";
import {
  createAutoSpawnTerminal,
  createTerminal,
  startTerminal,
} from "../agents/terminal-manager.js";
import type { AgentProvider } from "@maestro/wire";
import {
  createAutomationRunRecord,
  getAutomationRecord,
  getAutomationRunRecordByAgentId,
  listAutomationRecords,
  listAutomationRunRecordsByStatus,
  updateAutomationRecord,
  updateAutomationRunRecord,
} from "../state/sqlite.js";
import { runGitHubApi } from "../integrations/github.js";
import type { AutomationRecord, AutomationRunRecord } from "../state/types.js";
import { extractTerminalTailForComment } from "../state/kanban.js";
import { readTerminalHistory } from "../state/terminals.js";

let timer: ReturnType<typeof setInterval> | null = null;

const MAESTRO_INVOKE_REGEX = /^\s{0,2}@maestro:\s*/i;
const MAESTRO_MENTION_TEXT_REGEX = /@maestro\b/gi;
const LEADING_MAESTRO_MENTION_REGEX = /^\s{0,2}@maestro:\s*/i;
const LEGACY_GITHUB_MENTION_PROMPT_TEMPLATE = [
  "Review this GitHub thread where @maestro was mentioned and carry out the requested work.",
  "",
  "Repository: {{ item.repoFullName }}",
  "Type: {{ item.issueKind }}",
  "Title: {{ item.title }}",
  "URL: {{ item.url }}",
  "Triggered by: {{ item.triggerType }} from {{ item.triggerAuthor }}",
  "Trigger URL: {{ item.triggerUrl }}",
  "",
  "Trigger text:",
  "{{ item.triggerBody }}",
  "",
  "Full thread:",
  "{{ item.thread }}",
].join("\n");
const DEFAULT_GITHUB_MENTION_PROMPT_TEMPLATE = [
  "{{ item.promptBody }}",
  "",
  "{{ item.promptContextBlock }}",
].join("\n");

interface SourceItem {
  id: string;
  title: string;
  body: string;
  url: string;
  author?: string;
  labels?: string[];
  repoFullName?: string;
  issueNumber?: string;
  issueKind?: string;
  thread?: string;
  triggerType?: string;
  triggerBody?: string;
  triggerUrl?: string;
  triggerAuthor?: string;
  promptBody?: string;
  promptContextBlock?: string;
  [key: string]: unknown;
}

interface GitHubMentionRunContext {
  owner: string;
  repo: string;
  issueNumber: number;
  issueKind: "issue" | "pull_request";
  triggerType: "issue_body" | "pr_body" | "comment";
  triggerBody: string;
  triggerUrl: string;
  triggerAuthor: string;
}

interface GitHubIssueListItem {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  updated_at: string;
  user: { login: string };
  labels?: Array<{ name: string }>;
  pull_request?: unknown;
}

interface GitHubIssueComment {
  id: number;
  body: string | null;
  html_url: string;
  issue_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string };
}

interface GitHubIssueDetail {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string };
  pull_request?: unknown;
}

interface GitHubIssueThreadComment {
  id: number;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  user: { login: string };
}

export function startAutomationRunner() {
  timer = setInterval(() => {
    void tick();
  }, 60_000);
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
        if (elapsed < auto.pollIntervalMinutes) {
          continue;
        }
      }

      await runAutomation(auto);
    }
  } catch (err) {
    console.error("Automation runner tick error:", err);
  }
}

async function runAutomation(auto: AutomationRecord) {
  if (auto.sourceType === "github_mentions") {
    await pollGitHubMentions(auto);
    await startNextQueuedAutomationRun(auto.id);
    return;
  }

  const run = createAutomationRunRecord({
    automationId: auto.id,
    status: "running",
    itemsFound: 0,
    itemsProcessed: 0,
    error: null,
    agentId: null,
    itemContext: null,
    startedAt: nowIso(),
    completedAt: null,
  });

  try {
    const items = await fetchItems(auto.sourceType, auto.sourceConfig, auto.lastPollAt);

    updateAutomationRunRecord(run.id, { itemsFound: items.length });

    let processed = 0;
    let processedHashes = [...auto.processedHashes];

    for (const item of items) {
      const hash = hashItem(item);
      if (processedHashes.includes(hash)) {
        continue;
      }

      const prompt = renderTemplate(auto.agentPromptTemplate, item);
      const agent = await createAutomationTerminal(auto);

      await startTerminal(agent.id, prompt);

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
      lastPollAt: nowIso(),
      processedHashes,
    });

    updateAutomationRunRecord(run.id, {
      status: "completed",
      completedAt: nowIso(),
    });

    if (processed > 0) {
      console.log(`Automation "${auto.name}": processed ${processed}/${items.length} items`);
    }
  } catch (err) {
    console.error(`Automation "${auto.name}" error:`, err);
    updateAutomationRunRecord(run.id, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      completedAt: nowIso(),
    });
  }
}

async function pollGitHubMentions(auto: AutomationRecord) {
  const items = await fetchGitHubMentions(auto.sourceConfig, auto.lastPollAt);
  let processedHashes = [...auto.processedHashes];
  let queuedCount = 0;

  for (const item of items) {
    const hash = hashItem(item);
    if (processedHashes.includes(hash)) {
      continue;
    }

    const context = toMentionRunContext(item);
    if (!context) {
      processedHashes.push(hash);
      continue;
    }

    createAutomationRunRecord({
      automationId: auto.id,
      status: "queued",
      itemsFound: 1,
      itemsProcessed: 0,
      error: null,
      agentId: null,
      itemContext: {
        owner: context.owner,
        repo: context.repo,
        issueNumber: context.issueNumber,
        issueKind: context.issueKind,
        triggerType: context.triggerType,
        triggerBody: context.triggerBody,
        triggerUrl: context.triggerUrl,
        triggerAuthor: context.triggerAuthor,
      },
      startedAt: nowIso(),
      completedAt: null,
    });
    processedHashes.push(hash);
    queuedCount += 1;
  }

  updateAutomationRecord(auto.id, {
    lastPollAt: nowIso(),
    processedHashes,
  });

  if (queuedCount > 0) {
    console.log(`Automation "${auto.name}": queued ${queuedCount} mention run(s)`);
  }
}

function hasRunningAutomationRun(automationId: string): boolean {
  return listAutomationRunRecordsByStatus(automationId, "running", 1).length > 0;
}

async function startNextQueuedAutomationRun(automationId: string) {
  const automation = getAutomationRecord(automationId);
  if (!automation || !automation.enabled || hasRunningAutomationRun(automationId)) {
    return;
  }

  const nextRun = listAutomationRunRecordsByStatus(automationId, "queued", 1)[0];
  if (!nextRun) {
    return;
  }

  try {
    const promptItem =
      automation.sourceType === "github_mentions"
        ? await buildGitHubMentionPromptItem(nextRun.itemContext)
        : null;

    if (!promptItem) {
      throw new Error("Missing automation run context");
    }

    const prompt = renderTemplate(resolveAutomationPromptTemplate(automation), promptItem);
    const agent = await createAutomationTerminal(automation);

    updateAutomationRunRecord(nextRun.id, {
      status: "running",
      agentId: agent.id,
      itemsProcessed: 1,
    });

    await startTerminal(agent.id, prompt);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start automation run";
    console.error(`Failed to start queued automation run ${nextRun.id}:`, error);

    updateAutomationRunRecord(nextRun.id, {
      status: "error",
      error: message,
      completedAt: nowIso(),
    });

    await postAutomationRunResult(nextRun, false, message);
    await startNextQueuedAutomationRun(automationId);
  }
}

async function createAutomationTerminal(automation: AutomationRecord) {
  const commonOptions = {
    name: `auto-${automation.name}-${Date.now()}`,
    kind: "automation" as const,
    projectId: automation.agentProjectId || undefined,
    projectPath: automation.agentProjectPath,
  };

  if (
    automation.agentProvider === "custom" ||
    automation.agentCustomCommandTemplate ||
    automation.agentCustomDisplayName ||
    automation.agentCustomEnv
  ) {
    return createTerminal({
      ...commonOptions,
      provider: automation.agentProvider as AgentProvider,
      customDisplayName: automation.agentCustomDisplayName || undefined,
      customCommandTemplate: automation.agentCustomCommandTemplate || undefined,
      customEnv: automation.agentCustomEnv || undefined,
      skipPermissions: automation.agentSkipPermissions,
    });
  }

  return createAutoSpawnTerminal(commonOptions);
}

export async function finalizeAutomationRunAfterTerminalExit(
  terminalId: string,
  successful: boolean
) {
  const run = getAutomationRunRecordByAgentId(terminalId);
  if (!run) {
    return;
  }

  const terminalTail = extractTerminalTailForComment(readTerminalHistory(terminalId));
  const error = successful ? null : "Terminal run failed.";

  updateAutomationRunRecord(run.id, {
    status: successful ? "completed" : "error",
    error,
    completedAt: nowIso(),
  });

  await postAutomationRunResult(run, successful, terminalTail || error || "");
  await startNextQueuedAutomationRun(run.automationId);
}

async function postAutomationRunResult(
  run: AutomationRunRecord,
  successful: boolean,
  resultText: string
) {
  const automation = getAutomationRecord(run.automationId);
  if (!automation || automation.sourceType !== "github_mentions") {
    return;
  }

  const context = parseMentionRunContext(run.itemContext);
  if (!context) {
    return;
  }

  try {
    runGitHubApi(
      `repos/${context.owner}/${context.repo}/issues/${context.issueNumber}/comments`,
      {
        method: "POST",
        input: {
          body: buildGitHubMentionCompletionComment({
            successful,
            triggerType: context.triggerType,
            triggerAuthor: context.triggerAuthor,
            triggerUrl: context.triggerUrl,
            resultText,
          }),
        },
      }
    );
  } catch (error) {
    console.warn(
      `Failed to post automation completion comment for ${context.owner}/${context.repo}#${context.issueNumber}:`,
      error
    );
  }
}

async function fetchItems(
  sourceType: string,
  config: Record<string, string>,
  lastPollAt: string | null
): Promise<SourceItem[]> {
  switch (sourceType) {
    case "github_issues":
      return fetchGitHubIssues(config);
    case "github_prs":
      return fetchGitHubPRs(config);
    case "github_mentions":
      return fetchGitHubMentions(config, lastPollAt);
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
  if (!owner || !repo) {
    return [];
  }

  const params = new URLSearchParams({ state, per_page: "20" });
  if (labels) {
    params.set("labels", labels);
  }

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
  if (!owner || !repo) {
    return [];
  }

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

async function fetchGitHubMentions(
  config: Record<string, string>,
  lastPollAt: string | null
): Promise<SourceItem[]> {
  const { owner, repo } = config;
  if (!owner || !repo) {
    return [];
  }

  const since = lastPollAt ? new URLSearchParams({ since: lastPollAt }).toString() : "";
  const suffix = since ? `&${since}` : "";
  const repoFullName = `${owner}/${repo}`;

  const issues = runGitHubApi<GitHubIssueListItem[]>(
    `repos/${owner}/${repo}/issues?state=all&sort=updated&direction=asc&per_page=100${suffix}`
  );
  const comments = runGitHubApi<GitHubIssueComment[]>(
    `repos/${owner}/${repo}/issues/comments?sort=updated&direction=asc&per_page=100${suffix}`
  );

  return collectGitHubMentionSourceItems({
    issues,
    comments,
    repoFullName,
  });
}

export function collectGitHubMentionSourceItems(input: {
  issues: GitHubIssueListItem[];
  comments: GitHubIssueComment[];
  repoFullName: string;
}): SourceItem[] {
  const bodyMentions = input.issues.flatMap((issue) => {
    const body = issue.body || "";
    if (!isMaestroInvocation(body)) {
      return [];
    }

    const kind = issue.pull_request ? "pull_request" : "issue";
    const triggerType = issue.pull_request ? "pr_body" : "issue_body";
    return [
      {
        id: `${kind}:${issue.number}:body:${hashText(body)}`,
        title: issue.title,
        body,
        url: issue.html_url,
        author: issue.user.login,
        labels: issue.labels?.map((label) => label.name) ?? [],
        repoFullName: input.repoFullName,
        issueNumber: String(issue.number),
        issueKind: kind,
        triggerType,
        triggerBody: body,
        triggerUrl: issue.html_url,
        triggerAuthor: issue.user.login,
        createdAt: issue.updated_at,
      } satisfies SourceItem,
    ];
  });

  const commentMentions = input.comments.flatMap((comment) => {
    const body = comment.body || "";
    if (!isMaestroInvocation(body)) {
      return [];
    }

    const issueNumber = Number(comment.issue_url.split("/").pop());
    if (!Number.isFinite(issueNumber)) {
      return [];
    }

    return [
      {
        id: `comment:${comment.id}`,
        title: `GitHub mention in ${input.repoFullName}#${issueNumber}`,
        body,
        url: comment.html_url,
        author: comment.user.login,
        repoFullName: input.repoFullName,
        issueNumber: String(issueNumber),
        issueKind: "issue",
        triggerType: "comment",
        triggerBody: body,
        triggerUrl: comment.html_url,
        triggerAuthor: comment.user.login,
        createdAt: comment.created_at || comment.updated_at,
      } satisfies SourceItem,
    ];
  });

  return [...bodyMentions, ...commentMentions].sort((a, b) =>
    String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
  );
}

async function buildGitHubMentionPromptItem(
  rawContext: Record<string, unknown> | null
): Promise<SourceItem | null> {
  const context = parseMentionRunContext(rawContext);
  if (!context) {
    return null;
  }

  const issue = runGitHubApi<GitHubIssueDetail>(
    `repos/${context.owner}/${context.repo}/issues/${context.issueNumber}`
  );
  const comments = runGitHubApi<GitHubIssueThreadComment[]>(
    `repos/${context.owner}/${context.repo}/issues/${context.issueNumber}/comments?per_page=100`
  );

  return {
    id: `${context.owner}/${context.repo}#${context.issueNumber}`,
    title: issue.title,
    body: issue.body || "",
    url: issue.html_url,
    author: issue.user.login,
    repoFullName: `${context.owner}/${context.repo}`,
    issueNumber: String(context.issueNumber),
    issueKind: issue.pull_request ? "pull_request" : "issue",
    triggerType: context.triggerType,
    triggerBody: context.triggerBody,
    triggerUrl: context.triggerUrl,
    triggerAuthor: context.triggerAuthor,
    thread: buildGitHubThread(issue, comments),
    ...buildGitHubMentionPromptFields({
      repoFullName: `${context.owner}/${context.repo}`,
      issue,
      comments,
      triggerType: context.triggerType,
      triggerBody: context.triggerBody,
      triggerUrl: context.triggerUrl,
      triggerAuthor: context.triggerAuthor,
    }),
  };
}

function resolveAutomationPromptTemplate(automation: AutomationRecord): string {
  if (automation.sourceType !== "github_mentions") {
    return automation.agentPromptTemplate;
  }

  const template = automation.agentPromptTemplate.trim();
  if (
    !template ||
    template === LEGACY_GITHUB_MENTION_PROMPT_TEMPLATE ||
    template === DEFAULT_GITHUB_MENTION_PROMPT_TEMPLATE
  ) {
    return DEFAULT_GITHUB_MENTION_PROMPT_TEMPLATE;
  }

  return automation.agentPromptTemplate;
}

function buildGitHubThread(
  issue: GitHubIssueDetail,
  comments: GitHubIssueThreadComment[]
): string {
  const lines = [
    `${issue.pull_request ? "Pull request" : "Issue"} #${issue.number}`,
    `Title: ${issue.title}`,
    `Author: ${issue.user.login}`,
    `URL: ${issue.html_url}`,
    "",
    "Body:",
    issue.body?.trim() || "(empty)",
  ];

  for (const comment of comments) {
    lines.push(
      "",
      `Comment by ${comment.user.login} at ${comment.created_at}:`,
      comment.body?.trim() || "(empty)"
    );
  }

  return lines.join("\n").trim();
}

export function buildGitHubMentionPromptFields(input: {
  repoFullName: string;
  issue: GitHubIssueDetail;
  comments: GitHubIssueThreadComment[];
  triggerType: GitHubMentionRunContext["triggerType"];
  triggerBody: string;
  triggerUrl: string;
  triggerAuthor: string;
}): Pick<SourceItem, "promptBody" | "promptContextBlock"> {
  const promptBody = stripLeadingMaestroMention(input.triggerBody) || input.triggerBody.trim();
  const contextComments = commentsForPromptContext(
    input.comments,
    input.triggerType,
    input.triggerUrl
  );

  const lines = [
    `<context>`,
    `Repository: ${input.repoFullName}`,
    `Type: ${input.issue.pull_request ? "pull_request" : "issue"}`,
    `Title: ${input.issue.title}`,
    `URL: ${input.issue.html_url}`,
    `Triggered by: ${input.triggerType} from ${input.triggerAuthor}`,
  ];

  const issueBody = (input.issue.body || "").trim();
  if (issueBody) {
    lines.push("", "Issue body:", issueBody);
  }

  if (contextComments.length > 0) {
    lines.push("", "Previous comments:");
    for (const comment of contextComments) {
      lines.push(
        "",
        `Comment by ${comment.user.login} at ${comment.created_at}:`,
        comment.body?.trim() || "(empty)"
      );
    }
  }

  lines.push(`</context>`);

  return {
    promptBody,
    promptContextBlock: lines.join("\n"),
  };
}

function stripLeadingMaestroMention(text: string): string {
  return text.replace(LEADING_MAESTRO_MENTION_REGEX, "").trim();
}

function isMaestroInvocation(text: string): boolean {
  return MAESTRO_INVOKE_REGEX.test(text);
}

function commentsForPromptContext(
  comments: GitHubIssueThreadComment[],
  triggerType: GitHubMentionRunContext["triggerType"],
  triggerUrl: string
): GitHubIssueThreadComment[] {
  if (triggerType !== "comment") {
    return comments;
  }

  const triggerIndex = comments.findIndex((comment) => comment.html_url === triggerUrl);
  if (triggerIndex === -1) {
    return comments;
  }

  return comments.slice(0, triggerIndex);
}

async function fetchRSS(
  config: Record<string, string>
): Promise<SourceItem[]> {
  const { url } = config;
  if (!url) {
    return [];
  }

  const res = await fetch(url);
  if (!res.ok) {
    return [];
  }

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

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
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
    if (val == null) {
      return "";
    }
    if (Array.isArray(val)) {
      return val.join(", ");
    }
    return String(val);
  });
}

function toMentionRunContext(item: SourceItem): GitHubMentionRunContext | null {
  const ownerRepo = String(item.repoFullName || "").split("/");
  const issueNumber = Number(item.issueNumber);
  if (ownerRepo.length !== 2 || !Number.isFinite(issueNumber)) {
    return null;
  }

  const triggerType = item.triggerType;
  if (
    triggerType !== "issue_body" &&
    triggerType !== "pr_body" &&
    triggerType !== "comment"
  ) {
    return null;
  }

  const issueKind = item.issueKind === "pull_request" ? "pull_request" : "issue";

  return {
    owner: ownerRepo[0],
    repo: ownerRepo[1],
    issueNumber,
    issueKind,
    triggerType,
    triggerBody: String(item.triggerBody || item.body || ""),
    triggerUrl: String(item.triggerUrl || item.url || ""),
    triggerAuthor: String(item.triggerAuthor || item.author || ""),
  };
}

function parseMentionRunContext(
  rawContext: Record<string, unknown> | null
): GitHubMentionRunContext | null {
  if (!rawContext) {
    return null;
  }

  const owner = typeof rawContext.owner === "string" ? rawContext.owner : "";
  const repo = typeof rawContext.repo === "string" ? rawContext.repo : "";
  const issueNumber = Number(rawContext.issueNumber);
  const issueKind =
    rawContext.issueKind === "pull_request" ? "pull_request" : "issue";
  const triggerType = rawContext.triggerType;
  const triggerBody =
    typeof rawContext.triggerBody === "string" ? rawContext.triggerBody : "";
  const triggerUrl =
    typeof rawContext.triggerUrl === "string" ? rawContext.triggerUrl : "";
  const triggerAuthor =
    typeof rawContext.triggerAuthor === "string" ? rawContext.triggerAuthor : "";

  if (
    !owner ||
    !repo ||
    !Number.isFinite(issueNumber) ||
    (triggerType !== "issue_body" &&
      triggerType !== "pr_body" &&
      triggerType !== "comment")
  ) {
    return null;
  }

  return {
    owner,
    repo,
    issueNumber,
    issueKind,
    triggerType,
    triggerBody,
    triggerUrl,
    triggerAuthor,
  };
}

export function buildGitHubMentionCompletionComment(input: {
  successful: boolean;
  triggerType: GitHubMentionRunContext["triggerType"];
  triggerAuthor: string;
  triggerUrl: string;
  resultText: string;
}): string {
  const lines = [
    `Maestro ${input.successful ? "finished" : "stopped"} work for this mention.`,
    "",
    `Triggered by: ${input.triggerType} from ${input.triggerAuthor}`,
  ];

  if (input.triggerUrl) {
    lines.push(`Trigger URL: ${input.triggerUrl}`);
  }

  const resultText = input.resultText.trim();
  if (resultText) {
    lines.push("", "Last terminal output:", "", "```text");
    lines.push(sanitizeAutomationCommentText(resultText).replace(/```/g, "'''"));
    lines.push("```");
  }

  return lines.join("\n").trim();
}

function sanitizeAutomationCommentText(text: string): string {
  return text.replace(MAESTRO_MENTION_TEXT_REGEX, "@\u200Bmaestro");
}
