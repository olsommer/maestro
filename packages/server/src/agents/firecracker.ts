import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execSync, spawn } from "node:child_process";
import { MAESTRO_SANDBOXES_DIR } from "../state/files.js";

export interface FirecrackerConfig {
  terminalId: string;
  cwd: string;
  homeDir: string;
  readonlyMounts?: string[];
  writableMounts?: string[];
  memoryLimit?: number;
  env?: Record<string, string>;
}

export interface FirecrackerRuntime {
  terminalId: string;
  vmId: string;
  stateDir: string;
  apiSocketPath: string;
  logPath: string;
  guestCid: number;
  shellPort: number;
  bridgeCommand: string;
  bridgeArgs: string[];
  cleanup: () => void;
}

interface FirecrackerAssetPaths {
  firecrackerBinary: string;
  socatBinary: string;
  virtiofsdBinary: string;
  kernelPath: string;
  rootfsPath: string;
}

interface SharedDirectory {
  hostPath: string;
  guestPath: string;
  tag: string;
  socketPath: string;
  pidPath: string;
}

const FIRECRACKER_SANDBOX_ROOT = path.join(MAESTRO_SANDBOXES_DIR, "firecracker");
const DEFAULT_SHELL_PORT = Number(process.env.MAESTRO_FIRECRACKER_SHELL_PORT || "10752");
const DEFAULT_MEMORY_MIB = Number(process.env.MAESTRO_FIRECRACKER_MEMORY_MIB || "2048");
const DEFAULT_VCPUS = Number(process.env.MAESTRO_FIRECRACKER_VCPUS || "2");
const DEFAULT_CID_BASE = Number(process.env.MAESTRO_FIRECRACKER_GUEST_CID_BASE || "5200");
const DEFAULT_TAP_PREFIX = process.env.MAESTRO_FIRECRACKER_TAP_PREFIX || "maestrofc";

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function findFirstExistingPath(candidates: Array<string | undefined | null>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveFirecrackerAssets(): FirecrackerAssetPaths {
  const firecrackerBinary =
    process.env.MAESTRO_FIRECRACKER_BINARY?.trim() ||
    findFirstExistingPath(["/usr/local/bin/firecracker", "/usr/bin/firecracker"]);
  const socatBinary =
    process.env.MAESTRO_SOCAT_BINARY?.trim() ||
    findFirstExistingPath(["/usr/bin/socat", "/usr/local/bin/socat"]);
  const curlBinary =
    process.env.MAESTRO_CURL_BINARY?.trim() ||
    findFirstExistingPath(["/usr/bin/curl", "/usr/local/bin/curl"]);
  const virtiofsdBinary =
    process.env.MAESTRO_VIRTIOFSD_BINARY?.trim() ||
    findFirstExistingPath([
      "/usr/libexec/virtiofsd",
      "/usr/lib/qemu/virtiofsd",
      "/usr/local/libexec/virtiofsd",
      "/usr/bin/virtiofsd",
    ]);
  const kernelPath =
    process.env.MAESTRO_FIRECRACKER_KERNEL?.trim() ||
    findFirstExistingPath([
      path.join(os.homedir(), ".maestro", "firecracker", "vmlinux"),
      "/var/lib/maestro/firecracker/vmlinux",
    ]);
  const rootfsPath =
    process.env.MAESTRO_FIRECRACKER_ROOTFS?.trim() ||
    findFirstExistingPath([
      path.join(os.homedir(), ".maestro", "firecracker", "rootfs.ext4"),
      "/var/lib/maestro/firecracker/rootfs.ext4",
    ]);

  if (!firecrackerBinary) {
    throw new Error("firecracker binary not found");
  }
  if (!socatBinary) {
    throw new Error("socat binary not found");
  }
  if (!curlBinary) {
    throw new Error("curl binary not found");
  }
  if (!virtiofsdBinary) {
    throw new Error("virtiofsd binary not found");
  }
  if (!kernelPath) {
    throw new Error("Firecracker kernel image not found");
  }
  if (!rootfsPath) {
    throw new Error("Firecracker rootfs image not found");
  }

  return {
    firecrackerBinary,
    socatBinary,
    virtiofsdBinary,
    kernelPath,
    rootfsPath,
  };
}

function hasKvm(): boolean {
  return fs.existsSync("/dev/kvm");
}

export function isFirecrackerAvailable(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  if (!hasKvm()) {
    return false;
  }

  try {
    resolveFirecrackerAssets();
  } catch {
    return false;
  }

  return true;
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
}

function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function ensureStateDir(terminalId: string): string {
  return ensureDir(path.join(FIRECRACKER_SANDBOX_ROOT, terminalId));
}

function buildSharedDirectories(config: FirecrackerConfig, stateDir: string): SharedDirectory[] {
  const shared: SharedDirectory[] = [];
  const pushSharedDirectory = (
    hostPath: string | undefined,
    guestPath: string,
    tag: string
  ) => {
    if (!hostPath || !path.isAbsolute(hostPath) || !fs.existsSync(hostPath)) {
      return;
    }
    shared.push({
      hostPath,
      guestPath,
      tag,
      socketPath: path.join(stateDir, `${tag}.sock`),
      pidPath: path.join(stateDir, `${tag}.pid`),
    });
  };

  pushSharedDirectory(config.cwd, "/workspace/project", "project");
  pushSharedDirectory(config.homeDir, "/workspace/home", "home");

  for (const [index, mountPath] of (config.readonlyMounts ?? []).entries()) {
    pushSharedDirectory(mountPath, `/workspace/secondary/ro-${index}`, `ro-${index}`);
  }
  for (const [index, mountPath] of (config.writableMounts ?? []).entries()) {
    pushSharedDirectory(mountPath, `/workspace/secondary/rw-${index}`, `rw-${index}`);
  }

  return shared;
}

function startVirtiofsd(shared: SharedDirectory, assets: FirecrackerAssetPaths): void {
  try {
    fs.rmSync(shared.socketPath, { force: true });
  } catch {
    // ignore stale path
  }

  const child = spawn(
    assets.virtiofsdBinary,
    [
      "--socket-path",
      shared.socketPath,
      "--shared-dir",
      shared.hostPath,
      "--cache",
      "auto",
      "--announce-submounts",
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );

  child.unref();
  fs.writeFileSync(shared.pidPath, String(child.pid ?? ""));

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(shared.socketPath)) {
      return;
    }
    sleepMs(100);
  }

  throw new Error(`Timed out waiting for virtiofsd for ${shared.hostPath}`);
}

function killPidFile(pidPath: string): void {
  if (!fs.existsSync(pidPath)) return;
  const raw = fs.readFileSync(pidPath, "utf8").trim();
  try {
    process.kill(Number(raw), "SIGTERM");
  } catch {
    // ignore
  }
  fs.rmSync(pidPath, { force: true });
}

function getTapName(vmId: string): string {
  return `${DEFAULT_TAP_PREFIX}${sanitizeId(vmId).slice(0, 8)}`;
}

function getDefaultRouteInterface(): string | null {
  try {
    const raw = execSync("ip route show default", { encoding: "utf8" }).trim();
    const match = /\bdev\s+(\S+)/.exec(raw);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function buildTapConfig(vmId: string): {
  tapName: string;
  hostIp: string;
  guestIp: string;
  cidrPrefix: string;
  hostIf: string | null;
} {
  const suffix = Math.max(2, (Array.from(vmId).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 200) + 2);
  return {
    tapName: getTapName(vmId),
    hostIp: `172.30.${suffix}.1`,
    guestIp: `172.30.${suffix}.2`,
    cidrPrefix: "30",
    hostIf: getDefaultRouteInterface(),
  };
}

function createTapDevice(vmId: string): ReturnType<typeof buildTapConfig> {
  const tap = buildTapConfig(vmId);
  execFileSync("ip", ["tuntap", "add", "dev", tap.tapName, "mode", "tap"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  execFileSync("ip", ["addr", "add", `${tap.hostIp}/${tap.cidrPrefix}`, "dev", tap.tapName], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  execFileSync("ip", ["link", "set", "dev", tap.tapName, "up"], {
    stdio: ["ignore", "ignore", "ignore"],
  });

  if (tap.hostIf) {
    try {
      execFileSync("sysctl", ["-w", "net.ipv4.ip_forward=1"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      execFileSync(
        "iptables",
        [
          "-t",
          "nat",
          "-A",
          "POSTROUTING",
          "-s",
          `${tap.guestIp}/${tap.cidrPrefix}`,
          "-o",
          tap.hostIf,
          "-j",
          "MASQUERADE",
        ],
        { stdio: ["ignore", "ignore", "ignore"] }
      );
    } catch {
      // Networking is best-effort. Firecracker shells still work without host NAT.
    }
  }

  return tap;
}

function removeTapDevice(vmId: string): void {
  try {
    execFileSync("ip", ["link", "del", getTapName(vmId)], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    // ignore
  }
}

function sendFirecrackerApiRequest(
  socketPath: string,
  method: "PUT" | "PATCH",
  requestPath: string,
  body: Record<string, unknown>
): void {
  execFileSync(
    process.env.MAESTRO_CURL_BINARY?.trim() || "curl",
    [
      "--silent",
      "--show-error",
      "--fail",
      "--unix-socket",
      socketPath,
      "-X",
      method,
      `http://localhost${requestPath}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify(body),
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
    }
  );
}

function waitForApiSocket(apiSocketPath: string): void {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(apiSocketPath)) {
      return;
    }
    sleepMs(100);
  }
  throw new Error("Timed out waiting for Firecracker API socket");
}

function buildKernelArgs(
  config: FirecrackerConfig,
  sharedDirs: SharedDirectory[],
  tap: ReturnType<typeof buildTapConfig>
): string {
  const mountArgs = sharedDirs.map((entry) => `${entry.tag}:${entry.guestPath}`).join(",");
  const home = "/workspace/home";
  const project = "/workspace/project";
  return [
    "console=ttyS0",
    "reboot=k",
    "panic=1",
    "pci=off",
    "init=/usr/local/bin/maestro-guest-init.sh",
    `maestro.home=${home}`,
    `maestro.project=${project}`,
    `maestro.mounts=${mountArgs}`,
    `maestro.shell_port=${DEFAULT_SHELL_PORT}`,
    `maestro.guest_ip=${tap.guestIp}/${tap.cidrPrefix}`,
    `maestro.gateway_ip=${tap.hostIp}`,
  ].join(" ");
}

export function ensureFirecrackerRuntime(config: FirecrackerConfig): FirecrackerRuntime {
  if (!isFirecrackerAvailable()) {
    throw new Error(
      "Firecracker is not available. Install Firecracker, virtiofsd, socat, and guest assets first."
    );
  }

  const assets = resolveFirecrackerAssets();
  const vmId = sanitizeId(config.terminalId);
  const stateDir = ensureStateDir(config.terminalId);
  const apiSocketPath = path.join(stateDir, "firecracker.sock");
  const logPath = path.join(stateDir, "firecracker.log");
  const metricsPath = path.join(stateDir, "firecracker.metrics");
  const sharedDirs = buildSharedDirectories(config, stateDir);

  for (const sharedDir of sharedDirs) {
    startVirtiofsd(sharedDir, assets);
  }

  const tap = createTapDevice(vmId);
  const guestCid = DEFAULT_CID_BASE + (Array.from(vmId).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 10_000);

  try {
    fs.rmSync(apiSocketPath, { force: true });
  } catch {
    // ignore stale socket
  }

  const logFd = fs.openSync(logPath, "a");
  const firecrackerProcess = spawn(
    assets.firecrackerBinary,
    ["--api-sock", apiSocketPath],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    }
  );
  firecrackerProcess.unref();
  fs.writeFileSync(path.join(stateDir, "firecracker.pid"), String(firecrackerProcess.pid ?? ""));

  waitForApiSocket(apiSocketPath);

  sendFirecrackerApiRequest(apiSocketPath, "PUT", "/logger", {
    log_path: logPath,
    level: "Info",
    show_level: true,
    show_log_origin: false,
  });
  sendFirecrackerApiRequest(apiSocketPath, "PUT", "/metrics", {
    metrics_path: metricsPath,
  });
  sendFirecrackerApiRequest(apiSocketPath, "PUT", "/machine-config", {
    vcpu_count: DEFAULT_VCPUS,
    mem_size_mib: Math.max(512, Math.ceil((config.memoryLimit ?? DEFAULT_MEMORY_MIB * 1024 * 1024) / (1024 * 1024))),
    smt: false,
    track_dirty_pages: false,
  });
  sendFirecrackerApiRequest(apiSocketPath, "PUT", "/boot-source", {
    kernel_image_path: assets.kernelPath,
    boot_args: buildKernelArgs(config, sharedDirs, tap),
  });
  sendFirecrackerApiRequest(apiSocketPath, "PUT", "/drives/rootfs", {
    drive_id: "rootfs",
    path_on_host: assets.rootfsPath,
    is_root_device: true,
    is_read_only: false,
  });
  sendFirecrackerApiRequest(apiSocketPath, "PUT", "/network-interfaces/eth0", {
    iface_id: "eth0",
    guest_mac: "AA:FC:00:00:00:01",
    host_dev_name: tap.tapName,
  });
  sendFirecrackerApiRequest(apiSocketPath, "PUT", "/vsocks/root", {
    vsock_id: "root",
    guest_cid: guestCid,
    uds_path: path.join(stateDir, "vsock.sock"),
  });

  for (const sharedDir of sharedDirs) {
    sendFirecrackerApiRequest(apiSocketPath, "PUT", `/fs/${sharedDir.tag}`, {
      fs_id: sharedDir.tag,
      socket: sharedDir.socketPath,
      mount_tag: sharedDir.tag,
    });
  }

  sendFirecrackerApiRequest(apiSocketPath, "PUT", "/actions", {
    action_type: "InstanceStart",
  });

  const cleanup = () => {
    try {
      sendFirecrackerApiRequest(apiSocketPath, "PUT", "/actions", {
        action_type: "SendCtrlAltDel",
      });
    } catch {
      // ignore API failures during teardown
    }
    killPidFile(path.join(stateDir, "firecracker.pid"));
    for (const sharedDir of sharedDirs) {
      killPidFile(sharedDir.pidPath);
      try {
        fs.rmSync(sharedDir.socketPath, { force: true });
      } catch {
        // ignore
      }
    }
    removeTapDevice(vmId);
    try {
      fs.rmSync(apiSocketPath, { force: true });
    } catch {
      // ignore
    }
  };

  return {
    terminalId: config.terminalId,
    vmId,
    stateDir,
    apiSocketPath,
    logPath,
    guestCid,
    shellPort: DEFAULT_SHELL_PORT,
    bridgeCommand: assets.socatBinary,
    bridgeArgs: [
      "STDIO,rawer,echo=0",
      `VSOCK-CONNECT:${guestCid}:${DEFAULT_SHELL_PORT}`,
    ],
    cleanup,
  };
}
