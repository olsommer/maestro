import * as fs from "fs";
import * as path from "path";
import { execFileSync, spawn } from "node:child_process";
import { ensureDataDir, nowIso, readJsonFile, writeJsonFile } from "../state/files.js";

const GITHUB_CONNECTION_PATH = path.join(ensureDataDir(), "github-connection.json");

interface StoredGitHubConnectionRecord {
  token: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: string;
  verifiedAt: string;
}

export interface GitHubConnectionStatus {
  connected: boolean;
  source: "stored" | "env" | null;
  canDisconnect: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: string | null;
  verifiedAt: string | null;
}

export interface GitHubRepoSuggestion {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
}

export interface ResolvedGitHubToken {
  token: string | null;
  source: "stored" | "env" | null;
}

interface GhRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  input?: unknown;
  token?: string | null;
}

function readStoredGitHubConnection(): StoredGitHubConnectionRecord | null {
  const record = readJsonFile<StoredGitHubConnectionRecord | null>(
    GITHUB_CONNECTION_PATH,
    null
  );
  if (!record?.token || !record.login) {
    return null;
  }
  return record;
}

function toConnectionStatus(
  record: StoredGitHubConnectionRecord | null,
  source: "stored" | "env" | null
): GitHubConnectionStatus {
  return {
    connected: Boolean(source),
    source,
    canDisconnect: source === "stored",
    login: record?.login ?? null,
    name: record?.name ?? null,
    avatarUrl: record?.avatarUrl ?? null,
    scopes: record?.scopes ?? [],
    connectedAt: record?.connectedAt ?? null,
    verifiedAt: record?.verifiedAt ?? null,
  };
}

function getEnvGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

function getGhEnv(token?: string | null): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const resolved = token ?? resolveGitHubToken().token;
  if (resolved) {
    env.GH_TOKEN = resolved;
    env.GITHUB_TOKEN = resolved;
  }
  return env;
}

export function runGhCommand(
  args: string[],
  options?: { token?: string | null; input?: string; cwd?: string }
): string {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      env: getGhEnv(options?.token),
      cwd: options?.cwd,
      input: options?.input,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new Error(stderr || `gh ${args.join(" ")} failed`);
  }
}

function parseHeaderBlock(raw: string): Record<string, string> {
  const lines = raw.split(/\r?\n/).slice(1);
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function runGhApiWithHeaders<T>(
  endpoint: string,
  options?: GhRequestOptions
): { data: T; headers: Record<string, string> } {
  const args = ["api", "-i"];
  if (options?.method && options.method !== "GET") {
    args.push("-X", options.method);
  }
  args.push(endpoint.replace(/^\//, ""));
  const raw = runGhCommand(args, {
    token: options?.token,
    input: options?.input == null ? undefined : JSON.stringify(options.input),
  });
  const parts = raw.split(/\r?\n\r?\n/);
  if (parts.length < 2) {
    throw new Error("Unexpected gh api response");
  }

  const body = parts[parts.length - 1];
  const headerBlock = parts
    .slice(0, -1)
    .reverse()
    .find((part) => /^HTTP\/\d/i.test(part.trim()));

  return {
    data: JSON.parse(body) as T,
    headers: parseHeaderBlock(headerBlock ?? ""),
  };
}

export function runGitHubApi<T>(endpoint: string, options?: GhRequestOptions): T {
  return runGhApiWithHeaders<T>(endpoint, options).data;
}

async function fetchViewer(token: string): Promise<StoredGitHubConnectionRecord> {
  const { data, headers } = runGhApiWithHeaders<{
    login: string;
    name: string | null;
    avatar_url: string | null;
  }>("user", { token });

  const now = nowIso();
  const current = readStoredGitHubConnection();

  return {
    token,
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
    scopes: headers["x-oauth-scopes"]
      ? headers["x-oauth-scopes"]
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean)
      : [],
    connectedAt: current?.token === token ? current.connectedAt : now,
    verifiedAt: now,
  };
}

export function resolveGitHubToken(): ResolvedGitHubToken {
  const stored = readStoredGitHubConnection();
  if (stored?.token) {
    return {
      token: stored.token,
      source: "stored",
    };
  }

  const envToken = getEnvGitHubToken();
  if (envToken) {
    return {
      token: envToken,
      source: "env",
    };
  }

  return {
    token: null,
    source: null,
  };
}

export function getGitHubChildEnvVars(): Record<string, string> {
  const resolved = resolveGitHubToken();
  if (!resolved.token) {
    return {};
  }

  return {
    GITHUB_TOKEN: resolved.token,
    GH_TOKEN: resolved.token,
  };
}

export async function connectGitHubToken(token: string): Promise<GitHubConnectionStatus> {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error("GitHub token is required");
  }

  const record = await fetchViewer(normalized);
  writeJsonFile(GITHUB_CONNECTION_PATH, record, { mode: 0o600 });
  return toConnectionStatus(record, "stored");
}

export function disconnectGitHubToken(): GitHubConnectionStatus {
  if (fs.existsSync(GITHUB_CONNECTION_PATH)) {
    fs.unlinkSync(GITHUB_CONNECTION_PATH);
  }
  return toConnectionStatus(null, getEnvGitHubToken() ? "env" : null);
}

export async function getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  const stored = readStoredGitHubConnection();
  if (stored?.token) {
    return toConnectionStatus(stored, "stored");
  }

  const envToken = getEnvGitHubToken();
  if (!envToken) {
    return toConnectionStatus(null, null);
  }

  try {
    const record = await fetchViewer(envToken);
    return toConnectionStatus(record, "env");
  } catch {
    return toConnectionStatus(null, "env");
  }
}

export async function searchGitHubRepositories(
  query: string
): Promise<GitHubRepoSuggestion[]> {
  const resolved = resolveGitHubToken();
  if (!resolved.token) {
    throw new Error("GitHub is not connected");
  }

  const data = runGitHubApi<
    Array<{
      id: number;
      name: string;
      full_name: string;
      private: boolean;
      default_branch: string;
      clone_url: string;
      html_url: string;
      owner: { login: string };
    }>
  >(
    "user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member",
    { token: resolved.token }
  );

  const normalized = query.trim().toLowerCase();
  return data
    .filter((repo) => {
      if (!normalized) return true;
      return (
        repo.full_name.toLowerCase().includes(normalized) ||
        repo.name.toLowerCase().includes(normalized) ||
        repo.owner.login.toLowerCase().includes(normalized)
      );
    })
    .slice(0, 20)
    .map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      private: repo.private,
      defaultBranch: repo.default_branch,
      cloneUrl: repo.clone_url,
      htmlUrl: repo.html_url,
    }));
}

export interface DeviceAuthResult {
  code: string;
  url: string;
}

let activeDeviceAuth: { abort: () => void } | null = null;

export function startGhDeviceAuth(): Promise<DeviceAuthResult> {
  if (activeDeviceAuth) {
    activeDeviceAuth.abort();
    activeDeviceAuth = null;
  }

  return new Promise((resolve, reject) => {
    const child = spawn("gh", ["auth", "login", "-w"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stderr = "";
    let resolved = false;

    const cleanup = () => {
      activeDeviceAuth = null;
    };

    activeDeviceAuth = {
      abort: () => {
        child.kill();
        cleanup();
      },
    };

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();

      // gh outputs the code and URL to stderr
      const codeMatch = stderr.match(/one-time code:\s*([A-Z0-9-]+)/i);
      const urlMatch = stderr.match(/(https:\/\/github\.com\/login\/device)/);

      if (codeMatch && urlMatch && !resolved) {
        resolved = true;
        resolve({ code: codeMatch[1], url: urlMatch[1] });
      }
    });

    child.on("close", (exitCode) => {
      cleanup();
      if (!resolved) {
        reject(new Error(stderr || `gh auth login exited with code ${exitCode}`));
      }
    });

    child.on("error", (err) => {
      cleanup();
      if (!resolved) {
        reject(err);
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!resolved) {
        child.kill();
        cleanup();
        reject(new Error("Device auth timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

export async function completeGhDeviceAuth(): Promise<GitHubConnectionStatus> {
  // After the user completes auth in the browser, gh writes the token.
  // Extract it via `gh auth token` and store it in our connection file.
  try {
    const token = runGhCommand(["auth", "token"]);
    if (!token) {
      throw new Error("No token returned from gh auth");
    }
    return connectGitHubToken(token);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to retrieve token after device auth"
    );
  }
}
