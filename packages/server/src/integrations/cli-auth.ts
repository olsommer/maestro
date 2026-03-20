import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as pty from "node-pty";

const ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)?|\[[0-9;]*[A-Za-z])/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function getCredentialHomes(): string[] {
  const candidates = [
    process.env.HOME,
    os.homedir(),
    "/root",
    "/home/sandbox",
  ];

  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))));
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function commandExists(binary: string): boolean {
  try {
    execFileSync("which", [binary], { stdio: "pipe", encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

// ─── Claude Code ────────────────────────────────────────────────────────────

export interface ClaudeAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  email: string | null;
  orgName: string | null;
  authMethod: string | null;
}

interface ClaudeCliStatusPayload {
  loggedIn?: boolean;
  email?: string;
  orgName?: string;
  authMethod?: string;
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    subscriptionType?: string;
  };
}

function parseClaudeCliStatus(raw: string): ClaudeAuthStatus | null {
  try {
    const data = JSON.parse(raw) as ClaudeCliStatusPayload;
    return {
      installed: true,
      loggedIn: Boolean(data.loggedIn),
      email: data.email ?? null,
      orgName: data.orgName ?? null,
      authMethod: data.authMethod ?? null,
    };
  } catch {
    return null;
  }
}

function getClaudeCredentialHomes(): string[] {
  return getCredentialHomes();
}

function getClaudeAuthStatusFromCredentials(): ClaudeAuthStatus | null {
  let bestStatus: ClaudeAuthStatus | null = null;
  let bestExpiresAt = -Infinity;

  for (const home of getClaudeCredentialHomes()) {
    const credentialsPath = path.join(home, ".claude", ".credentials.json");
    if (!fs.existsSync(credentialsPath)) continue;

    try {
      const raw = fs.readFileSync(credentialsPath, "utf8");
      const data = JSON.parse(raw) as ClaudeCredentialsFile;
      const oauth = data.claudeAiOauth;
      if (!oauth?.accessToken) continue;

      const expiresAt =
        typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt)
          ? oauth.expiresAt
          : null;
      const loggedIn = expiresAt === null || expiresAt > Date.now();

      if (loggedIn && (expiresAt ?? Number.MAX_SAFE_INTEGER) > bestExpiresAt) {
        bestExpiresAt = expiresAt ?? Number.MAX_SAFE_INTEGER;
        bestStatus = {
          installed: true,
          loggedIn: true,
          email: null,
          orgName: null,
          authMethod: "oauth-credentials",
        };
      }
    } catch {
      // Ignore malformed credentials and continue checking other homes.
    }
  }

  return bestStatus;
}

function getClaudeAuthStatusFromCli(): ClaudeAuthStatus | null {
  try {
    const raw = execFileSync("claude", ["auth", "status"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return parseClaudeCliStatus(raw);
  } catch (err) {
    const stdout =
      err instanceof Error && "stdout" in err && typeof err.stdout === "string"
        ? err.stdout.trim()
        : "";
    return stdout ? parseClaudeCliStatus(stdout) : null;
  }
}

export function getClaudeAuthStatus(): ClaudeAuthStatus {
  if (!commandExists("claude")) {
    return { installed: false, loggedIn: false, email: null, orgName: null, authMethod: null };
  }

  const credentialStatus = getClaudeAuthStatusFromCredentials();
  if (credentialStatus?.loggedIn) {
    return credentialStatus;
  }

  return getClaudeAuthStatusFromCli() ?? {
    installed: true,
    loggedIn: false,
    email: null,
    orgName: null,
    authMethod: null,
  };
}

// ─── Codex ──────────────────────────────────────────────────────────────────

export interface CodexAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  detail: string | null;
}

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

function getTokenExpiryMs(token?: string): number | null {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}

function getCodexAuthStatusFromFile(): CodexAuthStatus | null {
  let bestStatus: CodexAuthStatus | null = null;
  let bestScore = -Infinity;

  for (const home of getCredentialHomes()) {
    const authPath = path.join(home, ".codex", "auth.json");
    if (!fs.existsSync(authPath)) continue;

    try {
      const raw = fs.readFileSync(authPath, "utf8");
      const data = JSON.parse(raw) as CodexAuthFile;
      const apiKey = data.OPENAI_API_KEY?.trim();
      const tokens = data.tokens;
      const accessExp = getTokenExpiryMs(tokens?.access_token);
      const idExp = getTokenExpiryMs(tokens?.id_token);
      const bestExp = Math.max(accessExp ?? -Infinity, idExp ?? -Infinity);
      const hasRefreshToken = Boolean(tokens?.refresh_token);
      const hasCurrentJwt = bestExp > Date.now();
      const loggedIn = Boolean(apiKey) || hasRefreshToken || hasCurrentJwt;

      if (!loggedIn) continue;

      const idPayload = tokens?.id_token ? decodeJwtPayload(tokens.id_token) : null;
      const email = typeof idPayload?.email === "string" ? idPayload.email : null;
      const mode = data.auth_mode?.trim() || (apiKey ? "api_key" : "chatgpt");
      const detail = email
        ? `Logged in via ${mode} (${email})`
        : `Logged in via ${mode}`;
      const score = Math.max(bestExp, hasRefreshToken ? Number.MAX_SAFE_INTEGER : -Infinity);

      if (score > bestScore) {
        bestScore = score;
        bestStatus = {
          installed: true,
          loggedIn: true,
          detail,
        };
      }
    } catch {
      // Ignore malformed auth files and continue checking other homes.
    }
  }

  return bestStatus;
}

function getCodexAuthStatusFromCli(): CodexAuthStatus | null {
  try {
    const raw = execFileSync("codex", ["login", "status"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const loggedIn = /logged in/i.test(raw);
    return { installed: true, loggedIn, detail: raw || null };
  } catch (err) {
    const stdout =
      err instanceof Error && "stdout" in err && typeof err.stdout === "string"
        ? err.stdout.trim()
        : "";
    const stderr =
      err instanceof Error && "stderr" in err && typeof err.stderr === "string"
        ? err.stderr.trim()
        : "";
    const detail = stdout || stderr || null;
    const loggedIn = /logged in/i.test(detail ?? "");
    return { installed: true, loggedIn, detail };
  }
}

export function getCodexAuthStatus(): CodexAuthStatus {
  if (!commandExists("codex")) {
    return { installed: false, loggedIn: false, detail: null };
  }

  const fileStatus = getCodexAuthStatusFromFile();
  if (fileStatus?.loggedIn) {
    return fileStatus;
  }

  return getCodexAuthStatusFromCli() ?? { installed: true, loggedIn: false, detail: null };
}

export interface DeviceAuthResult {
  code: string;
  url: string;
}

let activeCodexPty: pty.IPty | null = null;

export function startCodexDeviceAuth(): Promise<DeviceAuthResult> {
  if (activeCodexPty) {
    activeCodexPty.kill();
    activeCodexPty = null;
  }

  return new Promise((resolve, reject) => {
    const proc = pty.spawn("codex", ["login", "--device-auth"], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      env: process.env as Record<string, string>,
    });

    activeCodexPty = proc;
    let output = "";
    let resolved = false;

    proc.onData((data) => {
      output += data;
      const clean = stripAnsi(output);

      const urlMatch = clean.match(/(https:\/\/[^\s"'<>]+)/);
      const codeMatch = clean.match(/one-time code[^\n]*\n\s+([A-Z0-9]+-[A-Z0-9]+)/i);

      if (codeMatch && urlMatch && !resolved) {
        resolved = true;
        resolve({ code: codeMatch[1], url: urlMatch[1] });
      }
    });

    proc.onExit(({ exitCode }) => {
      if (activeCodexPty === proc) activeCodexPty = null;
      if (!resolved) {
        reject(new Error(stripAnsi(output) || `codex login exited with code ${exitCode}`));
      }
    });

    setTimeout(() => {
      if (!resolved) {
        proc.kill();
        if (activeCodexPty === proc) activeCodexPty = null;
        reject(new Error("Codex device auth timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

export function connectCodexWithApiKey(apiKey: string): CodexAuthStatus {
  if (!commandExists("codex")) {
    throw new Error("Codex CLI is not installed");
  }

  try {
    execFileSync("codex", ["login", "--with-api-key"], {
      encoding: "utf8",
      timeout: 15_000,
      input: apiKey.trim(),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err && typeof err.stderr === "string"
        ? err.stderr.trim()
        : "";
    throw new Error(stderr || "Failed to authenticate with API key");
  }

  return getCodexAuthStatus();
}
