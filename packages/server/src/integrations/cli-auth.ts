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

export interface ClaudeLoginResult {
  url: string;
}

let activeClaudeSession: {
  proc: pty.IPty;
  promptReady: boolean;
  exited: boolean;
  output: string;
} | null = null;

/**
 * Start Claude login flow:
 * 1. Spawn `claude` in a PTY
 * 2. Wait for the welcome screen, then send `/login`
 * 3. Select option 1 (Claude account with subscription)
 * 4. Extract the OAuth URL
 *
 * Claude stores auth natively — no need for token persistence on our side.
 */
export function startClaudeLogin(): Promise<ClaudeLoginResult> {
  if (activeClaudeSession) {
    activeClaudeSession.proc.kill();
    activeClaudeSession = null;
  }

  return new Promise((resolve, reject) => {
    const proc = pty.spawn("claude", [], {
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
    let sentLogin = false;
    let sentOption = false;

    proc.onData((data) => {
      session.output += data;
      const clean = stripAnsi(session.output);

      // Step 1: Wait for the input prompt (❯), then send /login
      if (!sentLogin && /❯/.test(clean)) {
        sentLogin = true;
        proc.write("/login\r");
        return;
      }

      // Step 2: Wait for the login method selection, then send "1" for subscription
      if (sentLogin && !sentOption && /Select login method/i.test(clean)) {
        sentOption = true;
        proc.write("1");
        return;
      }

      // Step 3: Track when the "Paste code" prompt appears
      if (/paste\s*code\s*here/i.test(clean) || /Pastecodehereifprompted/i.test(clean)) {
        session.promptReady = true;
      }

      // Step 4: Extract the OAuth URL
      const urlMatch = clean.match(/(https:\/\/claude\.ai\/oauth\/authorize[^\s"'<>]+)/);
      if (urlMatch && !resolved) {
        resolved = true;
        resolve({ url: urlMatch[1] });
      }
    });

    proc.onExit(({ exitCode }) => {
      session.exited = true;
      if (activeClaudeSession === session) activeClaudeSession = null;
      if (!resolved) {
        reject(new Error(stripAnsi(session.output) || `claude exited with code ${exitCode}`));
      }
    });

    setTimeout(() => {
      if (!resolved) {
        proc.kill();
        if (activeClaudeSession === session) activeClaudeSession = null;
        reject(new Error("Claude login timed out"));
      }
    }, 5 * 60 * 1000);
  });
}

export async function completeClaudeLogin(code: string): Promise<ClaudeAuthStatus> {
  if (!activeClaudeSession) {
    throw new Error("No active Claude login session. Start the flow again.");
  }

  const session = activeClaudeSession;

  if (session.exited) {
    activeClaudeSession = null;
    throw new Error("Claude process has already exited. Start the flow again.");
  }

  // Wait for the paste prompt to appear (up to 10s)
  if (!session.promptReady) {
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
      }, 10_000);
    });
  }

  if (session.exited) {
    activeClaudeSession = null;
    throw new Error("Claude process exited before prompt was ready. Start the flow again.");
  }

  // Write the OAuth code to the PTY
  session.proc.write(code);
  await new Promise((r) => setTimeout(r, 100));
  session.proc.write("\r");

  // Wait for login to complete — claude stays running after login,
  // so we wait for "Welcome back" or auth success indicators, then kill
  await new Promise<void>((resolve) => {
    if (session.exited) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      session.proc.kill();
      resolve();
    }, 30_000);

    // Listen for success indicators in output
    const checkDone = setInterval(() => {
      const clean = stripAnsi(session.output);
      // After successful login, claude shows the welcome screen again
      if (/logged\s*in|welcome\s*back|successfully/i.test(clean.slice(-500))) {
        clearInterval(checkDone);
        clearTimeout(timeout);
        // Give it a moment to finish writing auth, then kill
        setTimeout(() => {
          session.proc.kill();
          resolve();
        }, 2000);
      }
      if (session.exited) {
        clearInterval(checkDone);
        clearTimeout(timeout);
        resolve();
      }
    }, 500);

    session.proc.onExit(() => {
      clearInterval(checkDone);
      clearTimeout(timeout);
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
