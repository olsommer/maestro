#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const MAESTRO_DIR = path.join(os.homedir(), ".maestro");
const PID_PATH = path.join(MAESTRO_DIR, "server.pid");
const META_PATH = path.join(MAESTRO_DIR, "server-meta.json");
const LOG_PATH = path.join(MAESTRO_DIR, "server.log");
const TOKEN_PATH = path.join(MAESTRO_DIR, "token");
const LEGACY_TOKEN_PATH = path.join(MAESTRO_DIR, "api-token");
const DEFAULT_HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_PORT = process.env.PORT || "4800";

function ensureMaestroDir() {
  fs.mkdirSync(MAESTRO_DIR, { recursive: true });
}

function preflight() {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", ""], {
    stdio: "ignore",
  });

  if (result.error || result.status !== 0) {
    fail("Node must be able to load the local `tsx` package to run the Maestro CLI.");
  }

  const serverEntry = path.join(REPO_ROOT, "packages", "server", "src", "main.ts");
  if (!fs.existsSync(serverEntry)) {
    fail(`Maestro server entrypoint not found at ${serverEntry}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readPid() {
  try {
    const raw = fs.readFileSync(PID_PATH, "utf8").trim();
    if (!raw) return null;
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
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
    return error && error.code === "EPERM";
  }
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeMeta(meta) {
  ensureMaestroDir();
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

function cleanupState() {
  try {
    fs.unlinkSync(PID_PATH);
  } catch {}
  try {
    fs.unlinkSync(META_PATH);
  } catch {}
}

function resolveTokenPath() {
  if (fs.existsSync(TOKEN_PATH)) {
    return TOKEN_PATH;
  }
  if (fs.existsSync(LEGACY_TOKEN_PATH)) {
    return LEGACY_TOKEN_PATH;
  }
  return null;
}

function displayHost(host) {
  if (!host || host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

function getStatus() {
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

function start() {
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
  };

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "./packages/server/src/main.ts"],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", out, out],
      env,
    }
  );

  child.unref();

  fs.writeFileSync(PID_PATH, `${child.pid}\n`, "utf8");
  writeMeta({
    pid: child.pid,
    host: env.HOST,
    port: env.PORT,
    logPath: LOG_PATH,
    startedAt: new Date().toISOString(),
    cwd: REPO_ROOT,
  });

  console.log(`Started Maestro (pid ${child.pid})`);
  console.log(`URL: http://${displayHost(env.HOST)}:${env.PORT}`);
  console.log(`Log: ${LOG_PATH}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stop() {
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

function status() {
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

function auth() {
  const tokenPath = resolveTokenPath();
  if (!tokenPath) {
    fail(`Maestro API token not found at ${TOKEN_PATH}. Start Maestro first.`);
  }

  const token = fs.readFileSync(tokenPath, "utf8").trim();
  const current = getStatus();
  const host = displayHost(current.meta?.host || DEFAULT_HOST);
  const port = current.meta?.port || DEFAULT_PORT;

  console.log(`Server URL: http://${host}:${port}`);
  console.log(`API token: ${token}`);
  console.log(`Token path: ${tokenPath}`);
}

function help() {
  console.log("Usage: maestro <command>");
  console.log("");
  console.log("Commands:");
  console.log("  start   Start the Maestro server in the background");
  console.log("  stop    Stop the background Maestro server");
  console.log("  status  Show whether the Maestro server is running");
  console.log("  auth    Print the local Maestro API token");
}

async function main() {
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
