import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as pty from "node-pty";
import type { Server as SocketServer } from "socket.io";

const FLAG_DIR = path.join(os.homedir(), ".maestro");
const FLAG_FILE = path.join(FLAG_DIR, "setup-complete");
const SENTINEL = "__MAESTRO_SETUP_DONE__";
// Match URLs in PTY output. PTY data may contain ANSI escape codes interleaved
// with the URL text, so we first strip all escape sequences before matching.
const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)?|\[[0-9;]*[A-Za-z])/g;
// Detect prompts like "Do you want to use Claude Code? (y/n)" or "Running:"
// which indicate a new step has started and any previous URL is stale.
const STEP_BOUNDARY_RE = /(?:Running:|Checking|Do you want|Enter|Paste|Token)/i;
const INSTALL_ROOT = process.env.MAESTRO_INSTALL_ROOT?.trim();
const SCRIPT_PATH = INSTALL_ROOT
  ? path.resolve(INSTALL_ROOT, "assets/setup.sh")
  : path.resolve(
      import.meta.dirname ?? __dirname,
      "../../scripts/setup.sh"
    );

let activePty: pty.IPty | null = null;
let running = false;
let outputBuffer: string[] = [];
let setupComplete = false;

export function isSetupComplete(): boolean {
  return fs.existsSync(FLAG_FILE);
}

export function markSetupComplete(): void {
  fs.mkdirSync(FLAG_DIR, { recursive: true });
  fs.writeFileSync(FLAG_FILE, new Date().toISOString(), "utf-8");
}

export function resetSetup(): void {
  if (fs.existsSync(FLAG_FILE)) {
    fs.unlinkSync(FLAG_FILE);
  }
  cleanup();
  resetOutputBuffer();
}

export function isSetupRunning(): boolean {
  return running;
}

export function startSetupPty(io: SocketServer, cols?: number, rows?: number): void {
  // Kill any stale PTY from a previous session
  if (activePty) {
    console.log("[setup] Killing stale PTY before starting new one");
    cleanup();
  }

  // Clear buffer from any previous run
  outputBuffer = [];
  setupComplete = false;

  console.log(`[setup] Starting setup PTY, script: ${SCRIPT_PATH}`);
  console.log(`[setup] Script exists: ${fs.existsSync(SCRIPT_PATH)}`);
  console.log(`[setup] Requested dimensions: cols=${cols}, rows=${rows}`);

  running = true;

  // Ensure script is executable
  try {
    fs.chmodSync(SCRIPT_PATH, 0o755);
  } catch {
    // ignore if already executable
  }

  activePty = pty.spawn("bash", [SCRIPT_PATH], {
    name: "xterm-256color",
    cols: cols ?? 120,
    rows: rows ?? 30,
    cwd: os.homedir(),
    env: process.env as Record<string, string>,
  });

  console.log(`[setup] PTY spawned, pid: ${activePty.pid}`);

  activePty.onData((data) => {
    const roomSize = io.sockets.adapter.rooms.get("setup")?.size ?? 0;
    console.log(`[setup] PTY output (${data.length} bytes, ${roomSize} subscribers)`);
    outputBuffer.push(data);
    io.to("setup").emit("setup:output", { data });

    // Strip ANSI escape sequences before URL/boundary detection
    const clean = data.replace(ANSI_RE, "");

    // When a new step boundary is detected, clear any stale URL banner
    const hasUrl = URL_RE.test(clean);
    URL_RE.lastIndex = 0; // reset regex state
    if (!hasUrl && STEP_BOUNDARY_RE.test(clean)) {
      io.to("setup").emit("setup:clear-url", {});
    }

    // Detect URLs and emit them separately for the UI to show as clickable links
    const urls = clean.match(URL_RE);
    if (urls) {
      for (const url of urls) {
        io.to("setup").emit("setup:url", { url });
      }
    }

    if (data.includes(SENTINEL)) {
      setupComplete = true;
      markSetupComplete();
      io.to("setup").emit("setup:complete", {});
      cleanup();
    }
  });

  activePty.onExit(({ exitCode }) => {
    console.log(`[setup] PTY exited with code ${exitCode}`);
    cleanup();
  });
}

export function getSetupOutputBuffer(): string[] {
  return outputBuffer;
}

export function isSetupDone(): boolean {
  return setupComplete;
}

export function sendSetupInput(data: string): void {
  activePty?.write(data);
}

export function resizeSetupPty(cols: number, rows: number): void {
  activePty?.resize(cols, rows);
}

function cleanup(): void {
  if (activePty) {
    try {
      activePty.kill();
    } catch {
      // already dead
    }
    activePty = null;
  }
  running = false;
}

export function resetOutputBuffer(): void {
  outputBuffer = [];
  setupComplete = false;
}
