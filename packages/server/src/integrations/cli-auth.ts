import { execFileSync, spawn } from "node:child_process";

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

    const data = JSON.parse(raw) as {
      loggedIn?: boolean;
      email?: string;
      orgName?: string;
      authMethod?: string;
    };

    return {
      installed: true,
      loggedIn: Boolean(data.loggedIn),
      email: data.email ?? null,
      orgName: data.orgName ?? null,
      authMethod: data.authMethod ?? null,
    };
  } catch {
    return { installed: true, loggedIn: false, email: null, orgName: null, authMethod: null };
  }
}

export interface ClaudeSetupTokenResult {
  url: string;
}

let activeClaudeAuth: { abort: () => void; child: ReturnType<typeof spawn> } | null = null;

export function startClaudeSetupToken(): Promise<ClaudeSetupTokenResult> {
  if (activeClaudeAuth) {
    activeClaudeAuth.abort();
    activeClaudeAuth = null;
  }

  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["setup-token"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let output = "";
    let resolved = false;

    const cleanup = () => {
      activeClaudeAuth = null;
    };

    activeClaudeAuth = {
      child,
      abort: () => {
        child.kill();
        cleanup();
      },
    };

    const onData = (chunk: Buffer) => {
      output += chunk.toString();

      // claude setup-token prints ASCII art, ANSI escapes, then a URL.
      // Strip escape codes before matching.
      const clean = stripAnsi(output);
      const urlMatch = clean.match(/(https:\/\/claude\.ai\/oauth\/[^\s"'<>]+)/);
      if (urlMatch && !resolved) {
        resolved = true;
        resolve({ url: urlMatch[1] });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("close", (exitCode) => {
      cleanup();
      if (!resolved) {
        reject(new Error(output || `claude setup-token exited with code ${exitCode}`));
      }
    });

    child.on("error", (err) => {
      cleanup();
      if (!resolved) {
        reject(err);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        child.kill();
        cleanup();
        reject(new Error("Claude setup-token timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

export async function completeClaudeSetupToken(token: string): Promise<ClaudeAuthStatus> {
  if (!activeClaudeAuth) {
    throw new Error("No active Claude setup-token session");
  }

  const { child } = activeClaudeAuth;

  // Write the token to stdin of the waiting claude setup-token process
  child.stdin?.write(token + "\n");
  child.stdin?.end();

  // Wait for the process to exit (up to 10s)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve();
    }, 10_000);

    child.on("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  activeClaudeAuth = null;
  return getClaudeAuthStatus();
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

    // "Logged in using ChatGPT" or "Logged in using API key" etc.
    const loggedIn = /logged in/i.test(raw);
    return { installed: true, loggedIn, detail: raw };
  } catch (err) {
    const stderr =
      err instanceof Error && "stderr" in err && typeof err.stderr === "string"
        ? err.stderr.trim()
        : "";
    // If it exits with error, user is not logged in
    return { installed: true, loggedIn: false, detail: stderr || null };
  }
}

export interface DeviceAuthResult {
  code: string;
  url: string;
}

let activeCodexAuth: { abort: () => void } | null = null;

export function startCodexDeviceAuth(): Promise<DeviceAuthResult> {
  if (activeCodexAuth) {
    activeCodexAuth.abort();
    activeCodexAuth = null;
  }

  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["login", "--device-auth"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let output = "";
    let resolved = false;

    const cleanup = () => {
      activeCodexAuth = null;
    };

    activeCodexAuth = {
      abort: () => {
        child.kill();
        cleanup();
      },
    };

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const clean = stripAnsi(output);

      // Codex outputs:
      //   "1. Open this link in your browser..."
      //   "   https://auth.openai.com/codex/device"
      //   "2. Enter this one-time code..."
      //   "   1ASV-BFRAY"
      // The code is on its own line, indented with spaces.
      const urlMatch = clean.match(/(https:\/\/auth\.openai\.com\/[^\s"'<>]+)/);
      const codeMatch = clean.match(/one-time code[^\n]*\n\s+([A-Z0-9]+-[A-Z0-9]+)/i);

      if (codeMatch && urlMatch && !resolved) {
        resolved = true;
        resolve({ code: codeMatch[1], url: urlMatch[1] });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("close", (exitCode) => {
      cleanup();
      if (!resolved) {
        reject(new Error(output || `codex login exited with code ${exitCode}`));
      }
    });

    child.on("error", (err) => {
      cleanup();
      if (!resolved) {
        reject(err);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        child.kill();
        cleanup();
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
