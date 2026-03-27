import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");
const MAESTRO_DIR = path.join(os.homedir(), ".maestro");
const PID_PATH = path.join(MAESTRO_DIR, "server.pid");
const META_PATH = path.join(MAESTRO_DIR, "server-meta.json");
const LOG_PATH = path.join(MAESTRO_DIR, "server.log");
const UPDATE_STATE_PATH = path.join(MAESTRO_DIR, "maestro-update-state.json");
const TOKEN_PATH = path.join(MAESTRO_DIR, "token");
const LEGACY_TOKEN_PATH = path.join(MAESTRO_DIR, "api-token");
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

interface PackageMeta {
  name: string;
  version: string;
}

interface MaestroUpdateState {
  updating: boolean;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  latestVersion: string | null;
  lastError: string | null;
}

function ensureMaestroDir(): void {
  fs.mkdirSync(MAESTRO_DIR, { recursive: true });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readPackageMeta(): PackageMeta {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as PackageMeta;
  } catch {
    fail(`Maestro package metadata not found at ${PACKAGE_JSON_PATH}`);
  }
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

function readUpdateState(): MaestroUpdateState {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_STATE_PATH, "utf8")) as MaestroUpdateState;
  } catch {
    return {
      updating: false,
      lastCheckedAt: null,
      lastUpdatedAt: null,
      latestVersion: null,
      lastError: null,
    };
  }
}

function writeUpdateState(patch: Partial<MaestroUpdateState>): void {
  ensureMaestroDir();
  const next = { ...readUpdateState(), ...patch };
  fs.writeFileSync(UPDATE_STATE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
}

function cleanupState(): void {
  try {
    fs.unlinkSync(PID_PATH);
  } catch {}
  try {
    fs.unlinkSync(META_PATH);
  } catch {}
}

function resolveTokenPath(): string | null {
  if (fs.existsSync(TOKEN_PATH)) {
    return TOKEN_PATH;
  }
  if (fs.existsSync(LEGACY_TOKEN_PATH)) {
    return LEGACY_TOKEN_PATH;
  }
  return null;
}

function displayHost(host: string | undefined): string {
  if (!host || host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

function isContainerManagedInstall(): boolean {
  return fs.existsSync("/.dockerenv") || Boolean(process.env.KUBERNETES_SERVICE_HOST);
}

function getNpmCommand(): string {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    execFileSync(npmCommand, ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
    return npmCommand;
  } catch {
    fail("npm is required for `maestro update`, but it was not found in PATH.");
  }
}

function getGlobalNpmRoot(npmCommand: string): string {
  try {
    return execFileSync(npmCommand, ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail("Failed to determine the global npm install directory.");
  }
}

function ensureGlobalNpmInstall(npmCommand: string, packageName: string): void {
  const globalRoot = path.resolve(getGlobalNpmRoot(npmCommand));
  const expectedRoot = path.resolve(globalRoot, packageName);
  const installedRoot = path.resolve(PACKAGE_ROOT);

  if (installedRoot !== expectedRoot) {
    fail(
      `maestro update only supports global npm installs. Expected package path ${expectedRoot}, found ${installedRoot}.`
    );
  }
}

function getLatestPublishedVersion(npmCommand: string, packageName: string): string {
  try {
    const raw = execFileSync(npmCommand, ["view", `${packageName}@latest`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
    if (!raw) {
      throw new Error("empty version response");
    }
    return raw;
  } catch {
    fail(`Failed to query the latest published version for ${packageName}.`);
  }
}

function version(): void {
  const meta = readPackageMeta();
  console.log(meta.version);
}

function runNpmInstallGlobal(npmCommand: string, packageName: string, versionSpec: string): void {
  try {
    execFileSync(
      npmCommand,
      ["install", "-g", `${packageName}@${versionSpec}`],
      { stdio: "inherit" }
    );
  } catch {
    throw new Error(`Failed to update ${packageName}@${versionSpec}.`);
  }
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

function logs(args: string[]): void {
  const follow = args.includes("-f") || args.includes("--follow");

  if (!fs.existsSync(LOG_PATH)) {
    fail(`Maestro log file not found at ${LOG_PATH}. Start Maestro first.`);
  }

  let position = 0;

  const printChunk = (start: number, end: number) => {
    if (end <= start) return;

    const fd = fs.openSync(LOG_PATH, "r");
    try {
      const length = end - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      process.stdout.write(buffer);
    } finally {
      fs.closeSync(fd);
    }
  };

  const stat = fs.statSync(LOG_PATH);
  printChunk(0, stat.size);
  position = stat.size;

  if (!follow) {
    return;
  }

  const stopWatching = () => {
    fs.unwatchFile(LOG_PATH, onChange);
  };

  const onChange = (curr: fs.Stats, prev: fs.Stats) => {
    if (curr.size < position) {
      position = 0;
    }
    if (curr.size > position) {
      printChunk(position, curr.size);
      position = curr.size;
    } else if (prev.size > curr.size) {
      position = curr.size;
    }
  };

  process.on("SIGINT", () => {
    stopWatching();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    stopWatching();
    process.exit(0);
  });

  fs.watchFile(LOG_PATH, { interval: 500 }, onChange);
}

async function update(args: string[]): Promise<void> {
  if (isContainerManagedInstall()) {
    fail("maestro update is only supported for bare-metal npm installs. Redeploy the container image instead.");
  }

  const delayMs = Number(process.env.MAESTRO_SELF_UPDATE_DELAY_MS || "0");
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await sleep(delayMs);
  }

  const meta = readPackageMeta();
  const npmCommand = getNpmCommand();
  ensureGlobalNpmInstall(npmCommand, meta.name);

  const latestVersion = getLatestPublishedVersion(npmCommand, meta.name);
  const currentVersion = meta.version;
  const checkOnly = args.includes("--check");

  console.log(`Installed: ${currentVersion}`);
  console.log(`Latest: ${latestVersion}`);

  if (currentVersion === latestVersion) {
    console.log("Maestro is already up to date.");
    return;
  }

  if (checkOnly) {
    console.log(`Update available: ${currentVersion} -> ${latestVersion}`);
    return;
  }

  const current = getStatus();
  const wasRunning = current.running;

  if (wasRunning) {
    console.log("Stopping Maestro before update...");
    await stop();
  }

  console.log(`Updating ${meta.name} to ${latestVersion}...`);
  try {
    runNpmInstallGlobal(npmCommand, meta.name, "latest");
  } catch (error) {
    writeUpdateState({
      updating: false,
      lastError: error instanceof Error ? error.message : "Maestro update failed.",
    });
    if (wasRunning) {
      console.log("Update failed; attempting to restart the previous Maestro process...");
      start();
    }
    fail(error instanceof Error ? error.message : "Maestro update failed.");
  }

  writeUpdateState({
    updating: false,
    lastUpdatedAt: new Date().toISOString(),
    latestVersion,
    lastError: null,
  });

  if (wasRunning) {
    console.log("Starting Maestro after update...");
    start();
  } else {
    console.log("Update complete.");
  }
}

function help(): void {
  console.log("Usage: maestro <command>");
  console.log("");
  console.log("Commands:");
  console.log("  start   Start the Maestro server in the background");
  console.log("  stop    Stop the background Maestro server");
  console.log("  status  Show whether the Maestro server is running");
  console.log("  auth    Print the local Maestro API token");
  console.log("  logs    Print the Maestro server log");
  console.log("  version Print the installed Maestro CLI version");
  console.log("  update  Update the globally installed Maestro CLI");
  console.log("");
  console.log("Options:");
  console.log("  maestro logs -f         Follow the Maestro server log");
  console.log("  maestro update --check   Check whether an update is available");
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

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
    case "logs":
      logs(args);
      break;
    case "version":
      version();
      break;
    case "update":
      await update(args);
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
