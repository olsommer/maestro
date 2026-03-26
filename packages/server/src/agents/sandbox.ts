import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync, execSync } from "child_process";
import { fileURLToPath } from "url";
import type { SandboxProvider } from "@maestro/wire";

export interface SandboxConfig {
  /** Working directory (read-write) */
  cwd: string;
  /** Environment variables to pass into the sandbox */
  env: Record<string, string>;
  /** Additional read-only mount paths (e.g. secondary project dirs) */
  readonlyMounts?: string[];
  /** Additional read-write mount paths */
  writableMounts?: string[];
  /** Memory limit in bytes (default: 512MB) */
  memoryLimit?: number;
  /** Max number of child processes (default: 64) */
  maxProcesses?: number;
}

interface DockerInspectMount {
  Type?: string;
  Source?: string;
  Name?: string;
  Destination?: string;
  RW?: boolean;
}

interface DockerMountSpec {
  type: "bind" | "volume";
  source: string;
  target: string;
  readonly: boolean;
}

const SANDBOX_UID = 1500;
const SANDBOX_GID = 1500;
const BASE_READONLY_MOUNTS = ["/usr", "/bin", "/lib", "/sbin", "/etc"];
const BASE_PATH_DIRS = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
];
const DEFAULT_DOCKER_IMAGE = process.env.MAESTRO_DOCKER_SANDBOX_IMAGE || "maestro-sandbox:latest";
const DEFAULT_MEMORY_LIMIT = 512 * 1024 * 1024;
const DEFAULT_MAX_PROCESSES = 64;

let nsjailPath: string | null | undefined; // undefined = not checked yet
let dockerPath: string | null | undefined; // undefined = not checked yet
let dockerServerReachable: boolean | undefined;
let dockerImageReadyFor: string | null = null;
let cachedSelfMounts: DockerInspectMount[] | undefined;

function resolveBinaryPath(binary: "docker" | "nsjail"): string | null {
  try {
    return execSync(`which ${binary}`, { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if nsjail is available on the system.
 */
export function isNsjailAvailable(): boolean {
  if (process.platform !== "linux") return false;

  if (nsjailPath === undefined) {
    nsjailPath = resolveBinaryPath("nsjail");
  }

  return nsjailPath !== null;
}

/**
 * Get the resolved nsjail binary path.
 */
export function getNsjailPath(): string {
  if (!nsjailPath) throw new Error("nsjail is not available");
  return nsjailPath;
}

/**
 * Check if Docker CLI access is available and can reach a daemon.
 */
export function isDockerAvailable(): boolean {
  if (dockerPath === undefined) {
    dockerPath = resolveBinaryPath("docker");
  }

  if (!dockerPath) {
    dockerServerReachable = false;
    return false;
  }

  if (dockerServerReachable === undefined) {
    try {
      execFileSync(
        dockerPath,
        ["version", "--format", "{{.Server.Version}}"],
        { stdio: ["ignore", "ignore", "ignore"] }
      );
      dockerServerReachable = true;
    } catch {
      dockerServerReachable = false;
    }
  }

  return dockerServerReachable;
}

export function getDockerPath(): string {
  if (!dockerPath) throw new Error("docker is not available");
  return dockerPath;
}

export function normalizeSandboxProvider(
  value: string | null | undefined,
  legacyEnabled = false
): SandboxProvider {
  if (value === "none" || value === "nsjail" || value === "docker") {
    return value;
  }
  return legacyEnabled ? "nsjail" : "none";
}

export function resolveSandboxProviderAvailability(
  requested: SandboxProvider,
  availability: { nsjailAvailable: boolean; dockerAvailable: boolean }
): SandboxProvider {
  if (requested === "docker") {
    return availability.dockerAvailable ? "docker" : "none";
  }
  if (requested === "nsjail") {
    return availability.nsjailAvailable ? "nsjail" : "none";
  }
  return "none";
}

export function resolveSandboxProvider(requested: SandboxProvider): SandboxProvider {
  return resolveSandboxProviderAvailability(requested, {
    nsjailAvailable: isNsjailAvailable(),
    dockerAvailable: isDockerAvailable(),
  });
}

/**
 * Ensure a directory is writable by the sandbox user.
 * Called by Maestro (running as root) before spawning the jailed process.
 */
export function ensureSandboxWritable(dirPath: string): void {
  try {
    execSync(`chown -R ${SANDBOX_UID}:${SANDBOX_GID} ${JSON.stringify(dirPath)}`, {
      stdio: "ignore",
    });
  } catch {
    // Best-effort; may fail for read-only mounts (which is fine)
  }
}

/**
 * Build nsjail arguments for sandboxed agent execution.
 *
 * The sandbox provides:
 * - Filesystem isolation: only explicit mounts are visible
 * - PID namespace: agent can't see other processes
 * - Resource limits: memory, process count (when cgroups available)
 * - No network isolation (agents need API access)
 * - Non-root execution (uid 1500 / sandbox user)
 */
export function buildNsjailArgs(config: SandboxConfig): string[] {
  const home = os.homedir();
  const sandboxHome = "/home/sandbox";
  const mountedReadonlyRoots = [...BASE_READONLY_MOUNTS];
  const nodeBin = getNodeBinaryDir();
  const npmGlobalPrefix = getNpmGlobalPrefix();
  const codexCompanionBinDir = getCliCompanionBinDir("codex");

  const args: string[] = [
    "--mode", "o",
    "--chroot", "/",
    "--user", `${SANDBOX_UID}`,
    "--group", `${SANDBOX_GID}`,
    "--disable_clone_newuser",
    "--disable_clone_newnet",
    "--forward_signals",
    "--cwd", config.cwd,
    "--detect_cgroupv2",
    "--cgroup_mem_max", String(config.memoryLimit ?? DEFAULT_MEMORY_LIMIT),
    "--cgroup_pids_max", String(config.maxProcesses ?? DEFAULT_MAX_PROCESSES),
    "--rlimit_cpu", "soft",
    "--rlimit_fsize", "1024",
    "--rlimit_nproc", String(config.maxProcesses ?? DEFAULT_MAX_PROCESSES),
    "--rlimit_nofile", "1024",
    "--really_quiet",
  ];

  for (const dir of BASE_READONLY_MOUNTS) {
    if (fs.existsSync(dir)) {
      args.push("--bindmount_ro", `${dir}:${dir}`);
    }
  }

  if (fs.existsSync("/lib64")) {
    args.push("--bindmount_ro", "/lib64:/lib64");
  }

  args.push("--bindmount", "/dev:/dev");
  args.push("--tmpfsmount", "/tmp");
  args.push("--bindmount", `${config.cwd}:${config.cwd}`);

  if (fs.existsSync("/nix")) {
    args.push("--bindmount_ro", "/nix:/nix");
  }

  if (nodeBin && !isAlreadyMounted(nodeBin, mountedReadonlyRoots)) {
    args.push("--bindmount_ro", `${nodeBin}:${nodeBin}`);
    mountedReadonlyRoots.push(nodeBin);
  }

  if (npmGlobalPrefix && !isAlreadyMounted(npmGlobalPrefix, mountedReadonlyRoots)) {
    args.push("--bindmount_ro", `${npmGlobalPrefix}:${npmGlobalPrefix}`);
    mountedReadonlyRoots.push(npmGlobalPrefix);
  }

  if (codexCompanionBinDir && !isAlreadyMounted(codexCompanionBinDir, mountedReadonlyRoots)) {
    args.push("--bindmount_ro", `${codexCompanionBinDir}:${codexCompanionBinDir}`);
    mountedReadonlyRoots.push(codexCompanionBinDir);
  }

  mountSharedAgentPaths(args, home);

  if (config.readonlyMounts) {
    for (const mountPath of config.readonlyMounts) {
      if (fs.existsSync(mountPath)) {
        args.push("--bindmount_ro", `${mountPath}:${mountPath}`);
      }
    }
  }

  if (config.writableMounts) {
    for (const mountPath of config.writableMounts) {
      if (fs.existsSync(mountPath)) {
        args.push("--bindmount", `${mountPath}:${mountPath}`);
      }
    }
  }

  args.push("--bindmount", `${sandboxHome}:${sandboxHome}`);

  for (const [key, value] of Object.entries(config.env)) {
    args.push("--env", `${key}=${value}`);
  }

  const sandboxPath = buildSandboxPath({
    nodeBin,
    npmGlobalPrefix,
    companionBinDirs: [codexCompanionBinDir],
  });
  args.push("--env", `PATH=${sandboxPath}`);
  args.push("--env", `HOME=${sandboxHome}`);
  args.push("--env", "USER=sandbox");
  args.push("--env", "TERM=xterm-256color");

  return args;
}

export function buildDockerRunArgs(
  config: SandboxConfig,
  command: string[],
  image = DEFAULT_DOCKER_IMAGE
): string[] {
  const args: string[] = [
    "run",
    "--rm",
    "--interactive",
    "--tty",
    "--init",
    "--workdir", config.cwd,
    "--hostname", "maestro-sandbox",
    "--tmpfs", "/tmp:exec,mode=1777",
    "--security-opt", "no-new-privileges",
    "--memory", String(config.memoryLimit ?? DEFAULT_MEMORY_LIMIT),
    "--pids-limit", String(config.maxProcesses ?? DEFAULT_MAX_PROCESSES),
    "--name", `maestro-sandbox-${process.pid}-${Date.now()}`,
  ];

  const mounts = collectDockerMounts(config);
  for (const mount of mounts) {
    if (mount.type === "bind") {
      args.push(
        "--mount",
        `type=bind,src=${mount.source},dst=${mount.target}${mount.readonly ? ",readonly" : ""}`
      );
    } else {
      args.push(
        "--mount",
        `type=volume,src=${mount.source},dst=${mount.target}${mount.readonly ? ",readonly" : ""}`
      );
    }
  }

  const env = {
    ...config.env,
    HOME: "/root",
    USER: "root",
    TERM: "xterm-256color",
  };
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }

  args.push(image, ...command);
  return args;
}

export function ensureDockerSandboxImage(): string {
  if (!isDockerAvailable()) {
    throw new Error("docker is not available");
  }

  const image = DEFAULT_DOCKER_IMAGE;
  if (dockerImageReadyFor === image) {
    return image;
  }

  try {
    execFileSync(getDockerPath(), ["image", "inspect", image], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    dockerImageReadyFor = image;
    return image;
  } catch {
    const dockerfilePath = resolveDockerSandboxDockerfile();
    const repoRoot = path.resolve(dockerfilePath, "../../..");
    console.log(`Building Docker sandbox image ${image} from ${dockerfilePath}`);
    execFileSync(
      getDockerPath(),
      ["build", "-t", image, "-f", dockerfilePath, repoRoot],
      { stdio: "inherit" }
    );
    dockerImageReadyFor = image;
    return image;
  }
}

function collectDockerMounts(config: SandboxConfig): DockerMountSpec[] {
  const home = os.homedir();
  const requested = new Map<string, DockerMountSpec>();

  const addMount = (requestedPath: string, readonly: boolean) => {
    const mount = resolveDockerMount(requestedPath, readonly);
    if (!mount) return;

    const key = `${mount.type}:${mount.source}:${mount.target}`;
    const existing = requested.get(key);
    if (existing) {
      existing.readonly = existing.readonly && mount.readonly;
      return;
    }
    requested.set(key, mount);
  };

  addMount(config.cwd, false);
  for (const mountPath of config.readonlyMounts ?? []) {
    addMount(mountPath, true);
  }
  for (const mountPath of config.writableMounts ?? []) {
    addMount(mountPath, false);
  }

  const sharedPaths = getSharedAgentPaths(home);
  for (const sharedPath of sharedPaths.readwrite) {
    addMount(sharedPath, false);
  }
  for (const sharedPath of sharedPaths.readonly) {
    addMount(sharedPath, true);
  }

  return Array.from(requested.values());
}

function resolveDockerMount(
  requestedPath: string,
  readonly: boolean
): DockerMountSpec | null {
  if (!path.isAbsolute(requestedPath) || !fs.existsSync(requestedPath)) {
    return null;
  }

  const selfMount = findCoveringSelfMount(requestedPath);
  if (selfMount?.Destination && selfMount.Type === "volume" && selfMount.Name) {
    return {
      type: "volume",
      source: selfMount.Name,
      target: selfMount.Destination,
      readonly,
    };
  }
  if (selfMount?.Destination && selfMount.Type === "bind" && selfMount.Source) {
    return {
      type: "bind",
      source: selfMount.Source,
      target: selfMount.Destination,
      readonly,
    };
  }

  return {
    type: "bind",
    source: requestedPath,
    target: requestedPath,
    readonly,
  };
}

function getSelfContainerMounts(): DockerInspectMount[] {
  if (cachedSelfMounts !== undefined) {
    return cachedSelfMounts;
  }

  if (!isDockerAvailable()) {
    cachedSelfMounts = [];
    return cachedSelfMounts;
  }

  try {
    const containerId = os.hostname();
    const raw = execFileSync(
      getDockerPath(),
      ["inspect", containerId, "--format", "{{json .Mounts}}"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const parsed = JSON.parse(raw) as DockerInspectMount[];
    cachedSelfMounts = Array.isArray(parsed) ? parsed : [];
  } catch {
    cachedSelfMounts = [];
  }

  return cachedSelfMounts;
}

function findCoveringSelfMount(requestedPath: string): DockerInspectMount | null {
  const mounts = getSelfContainerMounts();
  let best: DockerInspectMount | null = null;

  for (const mount of mounts) {
    const destination = mount.Destination;
    if (!destination) continue;
    if (!isPathWithin(requestedPath, destination)) continue;
    if (!best || destination.length > String(best.Destination).length) {
      best = mount;
    }
  }

  return best;
}

function getSharedAgentPaths(home: string): {
  readonly: string[];
  readwrite: string[];
} {
  const maestroDir = path.join(home, ".maestro");
  const codexDir = path.join(home, ".codex");
  const claudeDir = path.join(home, ".claude");
  const claudeProjectsDir = path.join(claudeDir, "projects");
  const claudeJson = path.join(home, ".claude.json");
  const gitconfig = path.join(home, ".gitconfig");
  const ghConfigDir = path.join(home, ".config", "gh");

  return {
    readwrite: [maestroDir, claudeProjectsDir].filter(fs.existsSync),
    readonly: [codexDir, claudeDir, claudeJson, gitconfig, ghConfigDir].filter(fs.existsSync),
  };
}

function mountSharedAgentPaths(args: string[], home: string): void {
  const sharedPaths = getSharedAgentPaths(home);

  for (const dir of sharedPaths.readwrite) {
    args.push("--bindmount", `${dir}:${dir}`);
  }
  for (const dir of sharedPaths.readonly) {
    args.push("--bindmount_ro", `${dir}:${dir}`);
  }
}

function resolveDockerSandboxDockerfile(): string {
  const localDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "docker/sandbox/Dockerfile"),
    path.resolve(localDir, "../../../../docker/sandbox/Dockerfile"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Docker sandbox Dockerfile not found");
}

function isPathWithin(requestedPath: string, basePath: string): boolean {
  if (requestedPath === basePath) return true;
  if (!requestedPath.startsWith(basePath)) return false;
  return requestedPath.charAt(basePath.length) === path.sep;
}

/**
 * Build the PATH for inside the sandbox, including any companion bin dirs
 * from globally installed CLIs.
 */
function buildSandboxPath(options: {
  nodeBin: string | null;
  npmGlobalPrefix: string | null;
  companionBinDirs: Array<string | null>;
}): string {
  const pathParts = [...BASE_PATH_DIRS];

  if (options.nodeBin && !pathParts.includes(options.nodeBin)) {
    pathParts.unshift(options.nodeBin);
  }

  const globalBin = options.npmGlobalPrefix
    ? path.join(options.npmGlobalPrefix, "bin")
    : null;
  if (globalBin && !pathParts.includes(globalBin)) {
    pathParts.unshift(globalBin);
  }

  for (const dir of options.companionBinDirs) {
    if (dir && !pathParts.includes(dir)) {
      pathParts.unshift(dir);
    }
  }

  return pathParts.join(":");
}

function getNodeBinaryDir(): string | null {
  try {
    const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
    return nodePath ? path.dirname(nodePath) : null;
  } catch {
    return null;
  }
}

function getNpmGlobalPrefix(): string | null {
  try {
    const prefix = execSync("npm prefix -g", { encoding: "utf-8" }).trim();
    return prefix || null;
  } catch {
    return null;
  }
}

function getCliCompanionBinDir(cliName: string): string | null {
  try {
    const cliPath = execSync(`which ${cliName}`, { encoding: "utf-8" }).trim();
    if (!cliPath) return null;
    return path.dirname(fs.realpathSync(cliPath));
  } catch {
    return null;
  }
}

function isAlreadyMounted(targetPath: string, mountRoots: string[]): boolean {
  return mountRoots.some((root) => isPathWithin(targetPath, root));
}
