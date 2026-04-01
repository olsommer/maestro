import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const MAESTRO_DATA_DIR = path.join(os.homedir(), ".maestro");
export const MAESTRO_PROJECTS_DIR = path.join(MAESTRO_DATA_DIR, "projects");
export const MAESTRO_TERMINALS_DIR = path.join(MAESTRO_DATA_DIR, "terminals");
export const MAESTRO_SANDBOXES_DIR = path.join(MAESTRO_DATA_DIR, "sandboxes");
export const MAESTRO_SANDBOX_TERMINALS_DIR = path.join(MAESTRO_SANDBOXES_DIR, "terminals");
export const MAESTRO_SANDBOX_WORKTREES_DIR = path.join(MAESTRO_SANDBOXES_DIR, "worktrees");

export function ensureDataDir(): string {
  fs.mkdirSync(MAESTRO_DATA_DIR, { recursive: true });
  return MAESTRO_DATA_DIR;
}

export function ensureSandboxesDir(): string {
  fs.mkdirSync(MAESTRO_SANDBOXES_DIR, { recursive: true });
  return MAESTRO_SANDBOXES_DIR;
}

export function ensureTerminalsDir(): string {
  fs.mkdirSync(MAESTRO_TERMINALS_DIR, { recursive: true });
  return MAESTRO_TERMINALS_DIR;
}

export function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(
  filePath: string,
  value: unknown,
  options?: { mode?: number }
): void {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: options?.mode,
  });
  fs.renameSync(tempPath, filePath);
  if (options?.mode != null) {
    fs.chmodSync(filePath, options.mode);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
