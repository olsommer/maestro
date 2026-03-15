import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { AgentProvider } from "@maestro/wire";

export interface InteractiveCommandParams {
  binaryPath: string;
  prompt: string;
  model?: string;
  projectPath: string;
  skipPermissions?: boolean;
  secondaryProjectPaths?: string[];
  mcpConfigPath?: string;
  skills?: string[];
}

export interface CustomProviderConfig {
  displayName?: string | null;
  commandTemplate?: string | null;
  env?: Record<string, unknown> | null;
}

export interface CLIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly binaryName: string;

  resolveBinaryPath(): string;
  buildInteractiveCommand(params: InteractiveCommandParams): string;
  getPtyEnvVars(
    agentId: string,
    projectPath: string,
    skills: string[]
  ): Record<string, string>;
}

function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function quoteShell(s: string): string {
  return `'${escapeShell(s)}'`;
}

function toStringRecord(
  value: Record<string, unknown> | null | undefined
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      result[key] = raw;
    }
  }
  return result;
}

export class ClaudeProvider implements CLIProvider {
  readonly id = "claude";
  readonly displayName = "Claude Code";
  readonly binaryName = "claude";

  resolveBinaryPath(): string {
    // Check common locations
    const candidates = [
      path.join(os.homedir(), ".npm-global/bin/claude"),
      "/usr/local/bin/claude",
      "claude",
    ];
    for (const c of candidates) {
      if (c !== "claude" && fs.existsSync(c)) return c;
    }
    return "claude";
  }

  buildInteractiveCommand(params: InteractiveCommandParams): string {
    let cmd = quoteShell(params.binaryPath);

    if (params.mcpConfigPath && fs.existsSync(params.mcpConfigPath)) {
      cmd += ` --mcp-config ${quoteShell(params.mcpConfigPath)}`;
    }

    if (params.model) {
      cmd += ` --model ${quoteShell(params.model)}`;
    }

    if (params.skipPermissions) {
      cmd += " --dangerously-skip-permissions";
    }

    if (params.secondaryProjectPaths) {
      for (const p of params.secondaryProjectPaths) {
        if (fs.existsSync(p)) {
          cmd += ` --add-dir ${quoteShell(p)}`;
        }
      }
    }

    let finalPrompt = params.prompt;
    if (params.prompt && params.skills?.length) {
      const skillsList = params.skills.join(", ");
      finalPrompt = `[IMPORTANT: Use these skills for this session: ${skillsList}. Invoke them with /<skill-name> when relevant to the task.] ${params.prompt}`;
    }

    if (finalPrompt) {
      cmd += ` -p ${quoteShell(finalPrompt)}`;
    }

    return cmd;
  }

  getPtyEnvVars(
    agentId: string,
    projectPath: string,
    skills: string[]
  ): Record<string, string> {
    return {
      CLAUDE_SKILLS: skills.join(","),
      CLAUDE_AGENT_ID: agentId,
      CLAUDE_PROJECT_PATH: projectPath,
    };
  }
}

export class CodexProvider implements CLIProvider {
  readonly id = "codex";
  readonly displayName = "Codex";
  readonly binaryName = "codex";

  resolveBinaryPath(): string {
    return "codex";
  }

  buildInteractiveCommand(params: InteractiveCommandParams): string {
    let cmd = quoteShell(params.binaryPath);

    if (params.model) {
      cmd += ` --model ${quoteShell(params.model)}`;
    }

    if (params.skipPermissions) {
      cmd += " --full-auto";
    }

    if (params.prompt) {
      cmd += ` ${quoteShell(params.prompt)}`;
    }

    return cmd;
  }

  getPtyEnvVars(): Record<string, string> {
    return {};
  }
}

export class GeminiProvider implements CLIProvider {
  readonly id = "gemini";
  readonly displayName = "Gemini CLI";
  readonly binaryName = "gemini";

  resolveBinaryPath(): string {
    return "gemini";
  }

  buildInteractiveCommand(params: InteractiveCommandParams): string {
    let cmd = quoteShell(params.binaryPath);

    if (params.model) {
      cmd += ` --model ${quoteShell(params.model)}`;
    }

    if (params.skipPermissions) {
      cmd += " --sandbox";
    }

    if (params.prompt) {
      cmd += ` ${quoteShell(params.prompt)}`;
    }

    return cmd;
  }

  getPtyEnvVars(): Record<string, string> {
    return {};
  }
}

export class CustomProvider implements CLIProvider {
  readonly id = "custom";
  readonly displayName: string;
  readonly binaryName = "shell";

  constructor(private readonly config: CustomProviderConfig) {
    this.displayName = config.displayName?.trim() || "Custom CLI";
  }

  resolveBinaryPath(): string {
    return process.env.SHELL || "/bin/bash";
  }

  buildInteractiveCommand(params: InteractiveCommandParams): string {
    const template = this.config.commandTemplate?.trim();
    if (!template) {
      throw new Error("Custom CLI command template is required");
    }
    const hasPromptPlaceholder = /\{\{\s*prompt\s*\}\}/.test(template);

    const values: Record<string, string | undefined> = {
      prompt: params.prompt,
      model: params.model,
      projectPath: params.projectPath,
    };

    let command = template.replace(
      /\{\{\s*(prompt|model|projectPath)\s*\}\}/g,
      (_match, key: "prompt" | "model" | "projectPath") =>
        quoteShell(values[key] ?? "")
    );

    if (params.prompt && !hasPromptPlaceholder) {
      command += ` ${quoteShell(params.prompt)}`;
    }

    return command;
  }

  getPtyEnvVars(
    agentId: string,
    projectPath: string
  ): Record<string, string> {
    return {
      MAESTRO_AGENT_ID: agentId,
      MAESTRO_PROJECT_PATH: projectPath,
      ...toStringRecord(this.config.env),
    };
  }
}

const providers: Record<string, CLIProvider> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  gemini: new GeminiProvider(),
};

export function getProvider(
  id?: AgentProvider,
  customConfig?: CustomProviderConfig
): CLIProvider {
  if (id === "custom") {
    return new CustomProvider(customConfig ?? {});
  }
  return providers[id ?? "claude"] ?? providers.claude;
}
