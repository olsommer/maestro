import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MAESTRO_SANDBOX_TERMINALS_DIR } from "../state/files.js";

const DEFAULT_TERMINAL_STATE_BASE = MAESTRO_SANDBOX_TERMINALS_DIR;
const TERMINAL_STATE_BASE =
  process.env.MAESTRO_TERMINAL_STATE_BASE?.trim() || DEFAULT_TERMINAL_STATE_BASE;
const BOOTSTRAP_MARKER = ".bootstrap-complete";

export interface TerminalIsolationPaths {
  rootDir: string;
  homeDir: string;
}

function getGlobalHome(): string {
  return os.homedir();
}

export function getTerminalIsolationPaths(terminalId: string): TerminalIsolationPaths {
  const rootDir = path.join(TERMINAL_STATE_BASE, terminalId);
  return {
    rootDir,
    homeDir: path.join(rootDir, "home"),
  };
}

function copyPathIfPresent(source: string, target: string): void {
  if (!fs.existsSync(source) || fs.existsSync(target)) {
    return;
  }

  const stat = fs.statSync(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (stat.isDirectory()) {
    fs.cpSync(source, target, {
      recursive: true,
      errorOnExist: false,
    });
    return;
  }

  fs.copyFileSync(source, target);
}

function bootstrapTerminalHome(homeDir: string): void {
  const markerPath = path.join(homeDir, BOOTSTRAP_MARKER);
  if (fs.existsSync(markerPath)) {
    return;
  }

  const globalHome = getGlobalHome();
  const copies: Array<[string, string]> = [
    [path.join(globalHome, ".gitconfig"), path.join(homeDir, ".gitconfig")],
    [path.join(globalHome, ".claude.json"), path.join(homeDir, ".claude.json")],
    [path.join(globalHome, ".config", "gh"), path.join(homeDir, ".config", "gh")],
    [path.join(globalHome, ".claude"), path.join(homeDir, ".claude")],
    [path.join(globalHome, ".codex"), path.join(homeDir, ".codex")],
  ];

  for (const [source, target] of copies) {
    copyPathIfPresent(source, target);
  }

  // Pre-create shell history so login shells don't emit noisy warnings when
  // history append is enabled inside isolated homes.
  fs.writeFileSync(path.join(homeDir, ".bash_history"), "", { flag: "a" });
  fs.writeFileSync(markerPath, new Date().toISOString());
}

export function ensureTerminalIsolationHome(terminalId: string): TerminalIsolationPaths {
  const paths = getTerminalIsolationPaths(terminalId);
  fs.mkdirSync(paths.homeDir, { recursive: true });
  bootstrapTerminalHome(paths.homeDir);
  return paths;
}

export function removeTerminalIsolationState(terminalId: string): void {
  const paths = getTerminalIsolationPaths(terminalId);
  fs.rmSync(paths.rootDir, { recursive: true, force: true });
}
