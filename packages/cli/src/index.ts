import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAESTRO_DIR = path.join(os.homedir(), ".maestro");
const PID_PATH = path.join(MAESTRO_DIR, "server.pid");
const META_PATH = path.join(MAESTRO_DIR, "server-meta.json");
const LOG_PATH = path.join(MAESTRO_DIR, "server.log");
const TOKEN_PATH = path.join(MAESTRO_DIR, "api-token");
const SERVER_PATH = path.join(PACKAGE_ROOT, "dist", "server.js");
const DEFAULT_HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_PORT = process.env.PORT || "4800";

interface ServerMeta {
  pid: number;
  host: string;
  port: string;
  logPath: string;
  startedAt: string;
  cwd: string;
}

function ensureMaestroDir(): void {
  fs.mkdirSync(MAESTRO_DIR, { recursive: true });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function preflight(): void {
  if (!fs.existsSync(SERVER_PATH)) {
    fail(`Maestro server bundle not found at ${SERVER_PATH}`);
  }
}

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_PATH, "utf8").trim();
    if (!raw) return null;
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
        const fields = stat.trim().split(" ");
        if (fields[2] === "Z") {
          return false;
        }
      } catch {
        // Ignore /proc read failures and fall back to kill(0).
      }
    }
    return true;
  } catch (error) {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    );
  }
}

function readMeta(): ServerMeta | null {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, "utf8")) as ServerMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: ServerMeta): void {
  ensureMaestroDir();
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

function cleanupState(): void {
  try {
    fs.unlinkSync(PID_PATH);
  } catch {}
  try {
    fs.unlinkSync(META_PATH);
  } catch {}
}

function displayHost(host: string | undefined): string {
  if (!host || host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

function getStatus(): { running: boolean; pid: number | null; meta: ServerMeta | null } {
  const pid = readPid();
  const meta = readMeta();

  if (!pid) {
    return { running: false, pid: null, meta };
  }

  if (!isProcessAlive(pid)) {
    cleanupState();
    return { running: false, pid: null, meta };
  }

  return { running: true, pid, meta };
}

function start(): void {
  preflight();
  ensureMaestroDir();

  const current = getStatus();
  if (current.running) {
    const host = displayHost(current.meta?.host || DEFAULT_HOST);
    const port = current.meta?.port || DEFAULT_PORT;
    console.log(`Maestro is already running (pid ${current.pid})`);
    console.log(`URL: http://${host}:${port}`);
    console.log(`Log: ${LOG_PATH}`);
    return;
  }

  const out = fs.openSync(LOG_PATH, "a");
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
    HOST: DEFAULT_HOST,
    PORT: DEFAULT_PORT,
    MAESTRO_INSTALL_ROOT: PACKAGE_ROOT,
  };

  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", out, out],
    env,
  });

  child.unref();

  fs.writeFileSync(PID_PATH, `${child.pid}\n`, "utf8");
  writeMeta({
    pid: child.pid ?? 0,
    host: env.HOST,
    port: env.PORT,
    logPath: LOG_PATH,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
  });

  console.log(`Started Maestro (pid ${child.pid})`);
  console.log(`URL: http://${displayHost(env.HOST)}:${env.PORT}`);
  console.log(`Log: ${LOG_PATH}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stop(): Promise<void> {
  const status = getStatus();
  if (!status.running || !status.pid) {
    console.log("Maestro is not running");
    cleanupState();
    return;
  }

  process.kill(status.pid, "SIGTERM");

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(status.pid)) {
      cleanupState();
      console.log(`Stopped Maestro (pid ${status.pid})`);
      return;
    }
    await sleep(200);
  }

  fail(`Timed out waiting for Maestro (pid ${status.pid}) to stop`);
}

function status(): void {
  const current = getStatus();
  if (!current.running) {
    console.log("Maestro is not running");
    return;
  }

  const host = displayHost(current.meta?.host || DEFAULT_HOST);
  const port = current.meta?.port || DEFAULT_PORT;
  console.log(`Maestro is running (pid ${current.pid})`);
  console.log(`URL: http://${host}:${port}`);
  console.log(`Log: ${LOG_PATH}`);
}

function auth(): void {
  if (!fs.existsSync(TOKEN_PATH)) {
    fail(`Maestro API token not found at ${TOKEN_PATH}. Start Maestro first.`);
  }

  const token = fs.readFileSync(TOKEN_PATH, "utf8").trim();
  const current = getStatus();
  const host = displayHost(current.meta?.host || DEFAULT_HOST);
  const port = current.meta?.port || DEFAULT_PORT;

  console.log(`Server URL: http://${host}:${port}`);
  console.log(`API token: ${token}`);
  console.log(`Token path: ${TOKEN_PATH}`);
}

function help(): void {
  console.log("Usage: maestro <command>");
  console.log("");
  console.log("Commands:");
  console.log("  start   Start the Maestro server in the background");
  console.log("  stop    Stop the background Maestro server");
  console.log("  status  Show whether the Maestro server is running");
  console.log("  auth    Print the local Maestro API token");
}

async function main(): Promise<void> {
  const cmd = process.argv[2];

  switch (cmd) {
    case "start":
      start();
      break;
    case "stop":
      await stop();
      break;
    case "status":
      status();
      break;
    case "auth":
      auth();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      help();
      break;
    default:
      fail(`Unknown command: ${cmd}`);
  }
}

void main();
