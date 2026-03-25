import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface SandboxConfig {
  /** Working directory (read-write) */
  cwd: string;
  /** Environment variables to pass into the jail */
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

let nsjailPath: string | null | undefined; // undefined = not checked yet

/**
 * Check if nsjail is available on the system.
 */
export function isNsjailAvailable(): boolean {
  if (process.platform !== "linux") return false;

  if (nsjailPath === undefined) {
    try {
      nsjailPath = execSync("which nsjail", { encoding: "utf-8" }).trim();
    } catch {
      nsjailPath = null;
    }
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
  const mountedReadonlyRoots = [...BASE_READONLY_MOUNTS];
  const nodeBin = getNodeBinaryDir();
  const npmGlobalPrefix = getNpmGlobalPrefix();
  const codexCompanionBinDir = getCliCompanionBinDir("codex");

  const args: string[] = [
    // One-shot mode (run command once, exit)
    "--mode", "o",

    // Use host root as base
    "--chroot", "/",

    // Run jailed process as non-root sandbox user
    "--user", `${SANDBOX_UID}`,
    "--group", `${SANDBOX_GID}`,

    // We're already root in Docker, don't try to create a user namespace
    "--disable_clone_newuser",

    // Keep network access (agents need LLM API calls)
    "--disable_clone_newnet",

    // Kill jailed process if maestro dies
    "--forward_signals",

    // Set working directory inside the jail
    "--cwd", config.cwd,

    // Auto-detect cgroup v2 for resource limits
    "--detect_cgroupv2",

    // cgroup memory limit
    "--cgroup_mem_max", String(config.memoryLimit ?? 512 * 1024 * 1024),

    // cgroup PID limit
    "--cgroup_pids_max", String(config.maxProcesses ?? 64),

    // rlimit-based resource limits (always work)
    "--rlimit_cpu", "soft",
    "--rlimit_fsize", "1024", // max file size in MB
    "--rlimit_nproc", String(config.maxProcesses ?? 64),
    "--rlimit_nofile", "1024",

    // Reduce log noise
    "--really_quiet",
  ];

  // -- Read-only system mounts --
  for (const dir of BASE_READONLY_MOUNTS) {
    if (fs.existsSync(dir)) {
      args.push("--bindmount_ro", `${dir}:${dir}`);
    }
  }

  // /lib64 exists on some distros
  if (fs.existsSync("/lib64")) {
    args.push("--bindmount_ro", "/lib64:/lib64");
  }

  // Device access (needed for PTY) + proc
  args.push("--bindmount", "/dev:/dev");
  // proc is mounted by nsjail by default, no need to add it

  // Temp directory (isolated per-agent via tmpfs)
  args.push("--tmpfsmount", "/tmp");

  // Project working directory (read-write)
  args.push("--bindmount", `${config.cwd}:${config.cwd}`);

  // nix store if present
  if (fs.existsSync("/nix")) {
    args.push("--bindmount_ro", "/nix:/nix");
  }

  // Node.js binary + npm global modules (read-only)
  // In Docker these are typically under /usr/local which is already mounted,
  // but on custom setups (nvm, volta) they may be elsewhere.
  if (nodeBin && !isAlreadyMounted(nodeBin, mountedReadonlyRoots)) {
    args.push("--bindmount_ro", `${nodeBin}:${nodeBin}`);
    mountedReadonlyRoots.push(nodeBin);
  }

  // npm global prefix (for globally installed CLIs like claude, codex)
  if (npmGlobalPrefix && !isAlreadyMounted(npmGlobalPrefix, mountedReadonlyRoots)) {
    args.push("--bindmount_ro", `${npmGlobalPrefix}:${npmGlobalPrefix}`);
    mountedReadonlyRoots.push(npmGlobalPrefix);
  }

  // Codex ships an `rg` wrapper next to its real CLI entrypoint. When that
  // directory sits outside the usual mounted roots, expose it explicitly.
  if (codexCompanionBinDir && !isAlreadyMounted(codexCompanionBinDir, mountedReadonlyRoots)) {
    args.push("--bindmount_ro", `${codexCompanionBinDir}:${codexCompanionBinDir}`);
    mountedReadonlyRoots.push(codexCompanionBinDir);
  }

  // Maestro data directory (read-write for agent state)
  const maestroDir = path.join(home, ".maestro");
  if (fs.existsSync(maestroDir)) {
    args.push("--bindmount", `${maestroDir}:${maestroDir}`);
  }

  // Codex credentials + config (read-only for auth)
  const codexDir = path.join(home, ".codex");
  if (fs.existsSync(codexDir)) {
    args.push("--bindmount_ro", `${codexDir}:${codexDir}`);
  }

  // Claude Code credentials - mount read-only for auth
  const claudeDir = path.join(home, ".claude");
  if (fs.existsSync(claudeDir)) {
    args.push("--bindmount_ro", `${claudeDir}:${claudeDir}`);

    // Allow writes to projects subdir (conversation state)
    const claudeProjectsDir = path.join(claudeDir, "projects");
    if (fs.existsSync(claudeProjectsDir)) {
      args.push("--bindmount", `${claudeProjectsDir}:${claudeProjectsDir}`);
    }
  }

  // .claude.json (onboarding flag)
  const claudeJson = path.join(home, ".claude.json");
  if (fs.existsSync(claudeJson)) {
    args.push("--bindmount_ro", `${claudeJson}:${claudeJson}`);
  }

  // Git config (read-only)
  const gitconfig = path.join(home, ".gitconfig");
  if (fs.existsSync(gitconfig)) {
    args.push("--bindmount_ro", `${gitconfig}:${gitconfig}`);
  }

  // GitHub CLI config (read-only)
  const ghConfigDir = path.join(home, ".config", "gh");
  if (fs.existsSync(ghConfigDir)) {
    args.push("--bindmount_ro", `${ghConfigDir}:${ghConfigDir}`);
  }

  // Additional read-only mounts (secondary project paths, etc.)
  if (config.readonlyMounts) {
    for (const mountPath of config.readonlyMounts) {
      if (fs.existsSync(mountPath)) {
        args.push("--bindmount_ro", `${mountPath}:${mountPath}`);
      }
    }
  }

  // Additional read-write mounts
  if (config.writableMounts) {
    for (const mountPath of config.writableMounts) {
      if (fs.existsSync(mountPath)) {
        args.push("--bindmount", `${mountPath}:${mountPath}`);
      }
    }
  }

  // Home directory for sandbox user (writable via tmpfs)
  const sandboxHome = "/home/sandbox";
  args.push("--bindmount", `${sandboxHome}:${sandboxHome}`);

  // Pass environment variables
  for (const [key, value] of Object.entries(config.env)) {
    args.push("--env", `${key}=${value}`);
  }

  // PATH must include Codex companion dirs so bundled helpers like `rg`
  // remain available inside the jail.
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

/**
 * Check if a path is already covered by one of the base mounts.
 */
function isAlreadyMounted(targetPath: string, baseMounts: string[]): boolean {
  return baseMounts.some((base) => targetPath.startsWith(base + "/") || targetPath === base);
}

/**
 * Get the directory containing the Node.js binary.
 */
function getNodeBinaryDir(): string | null {
  try {
    const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
    const realPath = fs.realpathSync(nodePath);
    return path.dirname(realPath);
  } catch {
    return null;
  }
}

/**
 * Get the npm global prefix directory.
 */
function getNpmGlobalPrefix(): string | null {
  try {
    return execSync("npm prefix -g", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function getCliCompanionBinDir(binaryName: string): string | null {
  try {
    const binaryPath = execSync(`which ${binaryName}`, { encoding: "utf-8" }).trim();
    const realPath = fs.realpathSync(binaryPath);
    const companionDir = path.dirname(realPath);
    return fs.existsSync(companionDir) ? companionDir : null;
  } catch {
    return null;
  }
}

function buildSandboxPath(options: {
  nodeBin: string | null;
  npmGlobalPrefix: string | null;
  companionBinDirs: Array<string | null>;
}): string {
  const extraPathDirs = [
    options.nodeBin,
    options.npmGlobalPrefix ? path.join(options.npmGlobalPrefix, "bin") : null,
    ...options.companionBinDirs,
  ].filter((dir): dir is string => typeof dir === "string" && fs.existsSync(dir));

  return Array.from(new Set([...BASE_PATH_DIRS, ...extraPathDirs])).join(":");
}
