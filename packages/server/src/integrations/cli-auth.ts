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

function logClaudeAuth(message: string): void {
  console.log(`[cli-auth][claude] ${message}`);
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
    if (!fs.existsSync(credentialsPath)) {
      logClaudeAuth(`credentials file not found at ${credentialsPath}`);
      continue;
    }

    logClaudeAuth(`found credentials file at ${credentialsPath}`);

    try {
      const raw = fs.readFileSync(credentialsPath, "utf8");
      const data = JSON.parse(raw) as ClaudeCredentialsFile;
      const oauth = data.claudeAiOauth;
      if (!oauth?.accessToken) {
        logClaudeAuth(`credentials file at ${credentialsPath} has no access token; skipping`);
        continue;
      }

      const expiresAt =
        typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt)
          ? oauth.expiresAt
          : null;
      const loggedIn = expiresAt === null || expiresAt > Date.now();

      logClaudeAuth(
        `credentials file at ${credentialsPath} evaluated to loggedIn=${loggedIn} (expiresAt=${
          expiresAt === null ? "none" : new Date(expiresAt).toISOString()
        })`
      );

      if (loggedIn && (expiresAt ?? Number.MAX_SAFE_INTEGER) > bestExpiresAt) {
        bestExpiresAt = expiresAt ?? Number.MAX_SAFE_INTEGER;
        bestStatus = {
          installed: true,
          loggedIn: true,
          email: null,
          orgName: null,
          authMethod: "oauth-credentials",
        };
        logClaudeAuth(`credentials file at ${credentialsPath} is the current best auth candidate`);
      }
    } catch (error) {
      logClaudeAuth(
        `failed to read or parse credentials file at ${credentialsPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (bestStatus?.loggedIn) {
    logClaudeAuth("credential-based auth check succeeded");
  } else {
    logClaudeAuth("no valid logged-in credential file found");
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

    const parsed = parseClaudeCliStatus(raw);
    logClaudeAuth(
      parsed
        ? `cli auth status parsed successfully (loggedIn=${parsed.loggedIn}, authMethod=${
            parsed.authMethod ?? "unknown"
          })`
        : "cli auth status returned output that could not be parsed"
    );
    return parsed;
  } catch (err) {
    const stdout =
      err instanceof Error && "stdout" in err && typeof err.stdout === "string"
        ? err.stdout.trim()
        : "";
    if (stdout) {
      const parsed = parseClaudeCliStatus(stdout);
      logClaudeAuth(
        parsed
          ? `cli auth status errored but stdout parsed successfully (loggedIn=${parsed.loggedIn}, authMethod=${
              parsed.authMethod ?? "unknown"
            })`
          : "cli auth status errored and stdout could not be parsed"
      );
      return parsed;
    }

    logClaudeAuth(
      `cli auth status command failed without parseable stdout: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

export function getClaudeAuthStatus(): ClaudeAuthStatus {
  if (!commandExists("claude")) {
    logClaudeAuth("claude binary not found; reporting installed=false");
    return { installed: false, loggedIn: false, email: null, orgName: null, authMethod: null };
  }

  logClaudeAuth("claude binary found; checking credentials first");
  const credentialStatus = getClaudeAuthStatusFromCredentials();
  if (credentialStatus?.loggedIn) {
    logClaudeAuth("returning logged-in status from credentials file");
    return credentialStatus;
  }

  logClaudeAuth("credentials did not establish login; falling back to `claude auth status`");
  const cliStatus = getClaudeAuthStatusFromCli();
  if (cliStatus) {
    logClaudeAuth(`returning status from cli auth check (loggedIn=${cliStatus.loggedIn})`);
    return cliStatus;
  }

  logClaudeAuth("cli auth check returned no status; falling back to loggedOut default");
  return {
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

function parseCodexLoggedInStatus(detail: string | null): boolean {
  const normalized = detail?.trim().toLowerCase();
  if (!normalized) return false;
  if (/\bnot logged in\b/.test(normalized) || /\blogged out\b/.test(normalized)) {
    return false;
  }
  return /\blogged in\b/.test(normalized);
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

    const loggedIn = parseCodexLoggedInStatus(raw);
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
    const loggedIn = parseCodexLoggedInStatus(detail);
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
