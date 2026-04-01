import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync, execSync } from "child_process";
import { fileURLToPath } from "url";
import type { SandboxProvider } from "@maestro/wire";

export interface SandboxConfig {
  /** Working directory (read-write) */
  cwd: string;
  /** Optional isolated HOME directory for the sandbox process */
  homeDir?: string;
  /** Environment variables to pass into the sandbox */
  env: Record<string, string>;
  /** Additional read-only mount paths (e.g. secondary project dirs) */
  readonlyMounts?: string[];
  /** Additional read-write mount paths */
  writableMounts?: string[];
  /** Additional Docker-only mounts (e.g. named volumes) */
  dockerExtraMounts?: DockerMountSpec[];
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

export interface DockerMountSpec {
  type: "bind" | "volume";
  source: string;
  target: string;
  readonly: boolean;
}

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

let dockerPath: string | null | undefined; // undefined = not checked yet
let dockerServerReachable: boolean | undefined;
let runscPath: string | null | undefined;
let gvisorRuntimeAvailable: boolean | undefined;
let dockerImageReadyFor: string | null = null;
let cachedSelfMounts: DockerInspectMount[] | undefined;
let runningInsideContainer: boolean | undefined;

function resolveBinaryPath(binary: "docker" | "runsc"): string | null {
  try {
    return execSync(`which ${binary}`, { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
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

export function isGvisorAvailable(): boolean {
  if (!isDockerAvailable()) {
    gvisorRuntimeAvailable = false;
    return false;
  }

  if (runscPath === undefined) {
    runscPath = resolveBinaryPath("runsc");
  }

  if (!runscPath) {
    gvisorRuntimeAvailable = false;
    return false;
  }

  if (gvisorRuntimeAvailable === undefined) {
    try {
      const runtimes = execFileSync(
        getDockerPath(),
        ["info", "--format", "{{json .Runtimes}}"],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      );
      gvisorRuntimeAvailable = runtimes.includes('"runsc"');
    } catch {
      gvisorRuntimeAvailable = false;
    }
  }

  return gvisorRuntimeAvailable;
}

export function normalizeSandboxProvider(
  value: string | null | undefined,
  legacyEnabled = false
): SandboxProvider {
  if (value === "firecracker") {
    return "gvisor";
  }
  if (value === "none" || value === "docker" || value === "gvisor") {
    return value;
  }
  return legacyEnabled ? "docker" : "none";
}

export function resolveSandboxProviderAvailability(
  requested: SandboxProvider,
  availability: { dockerAvailable: boolean; gvisorAvailable: boolean }
): SandboxProvider {
  if (requested === "docker") {
    return availability.dockerAvailable ? "docker" : "none";
  }
  if (requested === "gvisor") {
    return availability.gvisorAvailable ? "gvisor" : "none";
  }
  return "none";
}

export function resolveSandboxProvider(requested: SandboxProvider): SandboxProvider {
  return resolveSandboxProviderAvailability(requested, {
    dockerAvailable: isDockerAvailable(),
    gvisorAvailable: isGvisorAvailable(),
  });
}

export function buildDockerRunArgs(
  config: SandboxConfig,
  command: string[],
  image = DEFAULT_DOCKER_IMAGE,
  runtimeName?: string
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

  if (runtimeName) {
    args.push("--runtime", runtimeName);
  }

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
    HOME: config.homeDir ?? "/root",
    USER: "root",
    TERM: "xterm-256color",
  };
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }

  args.push(image, ...command);
  return args;
}

export function ensureBuiltinDockerSandboxImage(image = DEFAULT_DOCKER_IMAGE): string {
  if (!isDockerAvailable()) {
    throw new Error("docker is not available");
  }

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

export function ensureDockerSandboxImage(): string {
  return ensureBuiltinDockerSandboxImage();
}

function collectDockerMounts(config: SandboxConfig): DockerMountSpec[] {
  const requested = new Map<string, DockerMountSpec>();

  const addResolvedMount = (mount: DockerMountSpec | null) => {
    if (!mount) return;

    const key = `${mount.type}:${mount.source}:${mount.target}`;
    const existing = requested.get(key);
    if (existing) {
      existing.readonly = existing.readonly && mount.readonly;
      return;
    }
    requested.set(key, { ...mount });
  };

  const addMount = (requestedPath: string, readonly: boolean) => {
    addResolvedMount(resolveDockerMount(requestedPath, readonly));
  };

  addMount(config.cwd, false);
  if (config.homeDir) {
    addMount(config.homeDir, false);
  }
  for (const mountPath of config.readonlyMounts ?? []) {
    addMount(mountPath, true);
  }
  for (const mountPath of config.writableMounts ?? []) {
    addMount(mountPath, false);
  }

  if (!config.homeDir) {
    const sharedPaths = getSharedAgentPaths(os.homedir());
    for (const sharedPath of sharedPaths.readwrite) {
      addMount(sharedPath, false);
    }
    for (const sharedPath of sharedPaths.readonly) {
      addMount(sharedPath, true);
    }
  }

  for (const mount of config.dockerExtraMounts ?? []) {
    addResolvedMount(mount);
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

  // When Maestro itself runs in Docker, only paths backed by a bind/volume
  // mount are visible to sibling `docker run` containers. Image-layer files
  // like `/root/.claude.json` exist here but not on the Docker host.
  if (isRunningInsideContainer()) {
    return null;
  }

  return {
    type: "bind",
    source: requestedPath,
    target: requestedPath,
    readonly,
  };
}

export function resolveDockerMountForPath(
  requestedPath: string,
  readonly = false
): DockerMountSpec | null {
  return resolveDockerMount(requestedPath, readonly);
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

function isRunningInsideContainer(): boolean {
  if (runningInsideContainer === undefined) {
    runningInsideContainer = fs.existsSync("/.dockerenv");
  }
  return runningInsideContainer;
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
  const codexDir = path.join(home, ".codex");
  const claudeDir = path.join(home, ".claude");
  const claudeProjectsDir = path.join(claudeDir, "projects");
  const claudeJson = path.join(home, ".claude.json");
  const gitconfig = path.join(home, ".gitconfig");
  const ghConfigDir = path.join(home, ".config", "gh");

  return {
    // Keep only CLI/runtime config writable here. Maestro's own server state
    // stays outside the generic sandbox mount set and terminal sandboxes use
    // a dedicated isolated HOME under ~/.maestro/sandboxes/terminals/<id>.
    readwrite: [codexDir, claudeDir, claudeProjectsDir, claudeJson, ghConfigDir].filter(fs.existsSync),
    readonly: [gitconfig].filter(fs.existsSync),
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
  const installRoot = process.env.MAESTRO_INSTALL_ROOT?.trim();
  const candidates = [
    ...(installRoot ? [path.resolve(installRoot, "assets/docker/sandbox/Dockerfile")] : []),
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

export function __setSelfContainerMountsForTests(mounts: DockerInspectMount[] | undefined): void {
  cachedSelfMounts = mounts;
}

export function __setRunningInsideContainerForTests(value: boolean | undefined): void {
  runningInsideContainer = value;
}
