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

let activeClaudeSession: {
  proc: pty.IPty;
  promptReady: boolean;
  exited: boolean;
  output: string;
} | null = null;

export function startClaudeSetupToken(): Promise<ClaudeSetupTokenResult> {
  if (activeClaudeSession) {
    activeClaudeSession.proc.kill();
    activeClaudeSession = null;
  }

  return new Promise((resolve, reject) => {
    // Use very wide PTY so the long OAuth URL never line-wraps
    const proc = pty.spawn("claude", ["setup-token"], {
      name: "xterm-256color",
      cols: 1000,
      rows: 30,
      env: process.env as Record<string, string>,
    });

    const session = {
      proc,
      promptReady: false,
      exited: false,
      output: "",
    };
    activeClaudeSession = session;

    let resolved = false;

    proc.onData((data) => {
      session.output += data;
      const clean = stripAnsi(session.output);

      // Track when the "Paste code" prompt appears
      if (/Paste code here/i.test(clean)) {
        session.promptReady = true;
        console.log("[claude-auth] Paste prompt is ready");
      }

      // claude setup-token prints ASCII art, then:
      //   "Browser didn't open? Use the url below to sign in (c to copy)"
      //   https://claude.ai/oauth/authorize?...&state=...
      //   "Paste code here if prompted >"
      const urlMatch = clean.match(/(https:\/\/claude\.ai\/oauth\/authorize[^\s"'<>]+)/);
      if (urlMatch && !resolved) {
        resolved = true;
        console.log("[claude-auth] URL extracted, PTY still running");
        resolve({ url: urlMatch[1] });
      }
    });

    proc.onExit(({ exitCode }) => {
      console.log(`[claude-auth] PTY exited with code ${exitCode}`);
      session.exited = true;
      if (activeClaudeSession === session) activeClaudeSession = null;
      if (!resolved) {
        reject(new Error(stripAnsi(session.output) || `claude setup-token exited with code ${exitCode}`));
      }
    });

    setTimeout(() => {
      if (!resolved) {
        proc.kill();
        if (activeClaudeSession === session) activeClaudeSession = null;
        reject(new Error("Claude setup-token timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

export async function completeClaudeSetupToken(token: string): Promise<ClaudeAuthStatus> {
  if (!activeClaudeSession) {
    throw new Error("No active Claude setup-token session. Start the flow again.");
  }

  const session = activeClaudeSession;

  if (session.exited) {
    activeClaudeSession = null;
    throw new Error("Claude setup-token process has already exited. Start the flow again.");
  }

  // Wait for the paste prompt to appear (up to 5s)
  if (!session.promptReady) {
    console.log("[claude-auth] Waiting for paste prompt...");
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (session.promptReady || session.exited) {
          clearInterval(check);
          resolve();
        }
      }, 200);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });
  }

  if (session.exited) {
    activeClaudeSession = null;
    throw new Error("Claude setup-token process exited before prompt was ready. Start the flow again.");
  }

  console.log(`[claude-auth] Writing code to PTY (promptReady=${session.promptReady})`);

  // Write the code to the PTY
  session.proc.write(token);
  // Small delay then press Enter
  await new Promise((r) => setTimeout(r, 100));
  session.proc.write("\r");

  // Wait for the process to exit (up to 15s)
  await new Promise<void>((resolve) => {
    if (session.exited) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      console.log("[claude-auth] Timed out waiting for exit, killing PTY");
      console.log("[claude-auth] Final output:", stripAnsi(session.output).slice(-500));
      session.proc.kill();
      resolve();
    }, 15_000);

    session.proc.onExit(() => {
      clearTimeout(timeout);
      console.log("[claude-auth] PTY exited after code submission");
      resolve();
    });
  });

  activeClaudeSession = null;
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

      // Codex outputs:
      //   "1. Open this link in your browser and sign in to your account"
      //   "   https://auth.openai.com/codex/device"
      //   ""
      //   "2. Enter this one-time code (expires in 15 minutes)"
      //   "   1ASV-BFRAY"
      const urlMatch = clean.match(/(https:\/\/auth\.openai\.com\/[^\s"'<>]+)/);
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
