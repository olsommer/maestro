import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as pty from "node-pty";

const ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)?|\[[0-9;]*[A-Za-z])/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
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
  const candidates = [
    process.env.HOME,
    os.homedir(),
    "/root",
    "/home/sandbox",
  ];

  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))));
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

export function getClaudeAuthStatus(): ClaudeAuthStatus {
  if (!commandExists("claude")) {
    return { installed: false, loggedIn: false, email: null, orgName: null, authMethod: null };
  }

  try {
    const raw = execFileSync("claude", ["auth", "status"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const status = parseClaudeCliStatus(raw);
    if (status?.loggedIn) {
      return status;
    }

    return getClaudeAuthStatusFromCredentials() ?? status ?? {
      installed: true,
      loggedIn: false,
      email: null,
      orgName: null,
      authMethod: null,
    };
  } catch (err) {
    const stdout =
      err instanceof Error && "stdout" in err && typeof err.stdout === "string"
        ? err.stdout.trim()
        : "";
    const status = stdout ? parseClaudeCliStatus(stdout) : null;

    if (status?.loggedIn) {
      return status;
    }

    return getClaudeAuthStatusFromCredentials() ?? status ?? {
      installed: true,
      loggedIn: false,
      email: null,
      orgName: null,
      authMethod: null,
    };
  }
}

// ─── Codex ──────────────────────────────────────────────────────────────────

export interface CodexAuthStatus {
  installed: boolean;
  loggedIn: boolean;
  detail: string | null;
}

export function getCodexAuthStatus(): CodexAuthStatus {
  if (!commandExists("codex")) {
    return { installed: false, loggedIn: false, detail: null };
  }

  try {
    const raw = execFileSync("codex", ["login", "status"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const loggedIn = /logged in/i.test(raw);
    return { installed: true, loggedIn, detail: raw };
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err && typeof err.stderr === "string"
        ? err.stderr.trim()
        : "";
    return { installed: true, loggedIn: false, detail: stderr || null };
  }
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
