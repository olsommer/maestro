import * as fs from "fs";
import type { FastifyInstance } from "fastify";
import {
  AgentSpawnOptions,
  AgentStartInput,
  AgentSendInput,
} from "@maestro/wire";
import {
  createTerminal,
  deleteTerminal,
  getTerminal,
  getTerminalOutputSnapshot,
  listTerminals,
  sendTerminalInput,
  startTerminal,
  stopTerminal,
} from "../agents/terminal-manager.js";
import { getProjectRecordById } from "../state/projects.js";
import { updateTerminalRecord } from "../state/terminals.js";
import { createTerminalWorktree, isGitRepo } from "../agents/worktree.js";

export async function registerTerminalRoutes(app: FastifyInstance) {
  // List all terminals
  app.get("/api/terminals", async () => {
    const terminals = await listTerminals();
    return { terminals };
  });

  // Get single terminal
  app.get<{ Params: { id: string } }>("/api/terminals/:id", async (req, reply) => {
    const terminal = await getTerminal(req.params.id);
    if (!terminal) return reply.status(404).send({ error: "Terminal not found" });
    return { terminal };
  });

  // Get terminal output buffer
  app.get<{ Params: { id: string } }>(
    "/api/terminals/:id/output",
    async (req, reply) => {
      const terminal = await getTerminal(req.params.id);
      if (!terminal) return reply.status(404).send({ error: "Terminal not found" });
      return await getTerminalOutputSnapshot(req.params.id);
    }
  );

  // Create terminal
  app.post("/api/terminals", async (req, reply) => {
    try {
      const options = AgentSpawnOptions.parse(req.body);
      let projectPath = options.projectPath;

      if (options.projectId) {
        const project = getProjectRecordById(options.projectId);
        if (!project) {
          return reply.status(404).send({ error: "Project not found" });
        }
        projectPath = project.localPath;
      }

      if (!projectPath) {
        return reply.status(400).send({ error: "projectPath is required" });
      }

      const wantsWorktree = options.useWorktree ?? options.worktree ?? false;
      const wantsAutoWorktree = options.autoWorktree ?? false;
      let worktreePath = options.worktreePath?.trim() || null;

      if (wantsWorktree && !worktreePath) {
        return reply.status(400).send({
          error: "worktreePath is required when useWorktree is enabled",
        });
      }

      if (worktreePath && !fs.existsSync(worktreePath)) {
        return reply.status(400).send({ error: "worktreePath does not exist" });
      }

      // Validate auto-worktree precondition (git repo check)
      if (wantsAutoWorktree && !worktreePath) {
        if (!isGitRepo(projectPath)) {
          return reply.status(400).send({
            error: "Auto-worktree requires the project to be a git repository",
          });
        }
      }

      const createdAgent = await createTerminal({
        name: options.name,
        kind: "terminal",
        provider: options.provider,
        projectId: options.projectId,
        projectPath,
        worktreePath,
        autoWorktree: wantsAutoWorktree,
        customDisplayName: options.customDisplayName,
        customCommandTemplate: options.customCommandTemplate,
        customEnv: options.customEnv,
        secondaryProjectPaths: options.secondaryProjectPaths,
        skills: options.skills,
        skipPermissions: options.skipPermissions,
        disableSandbox: options.disableSandbox,
      });

      // Auto-create a new worktree using the real agent ID
      if (wantsAutoWorktree && !worktreePath) {
        try {
          const autoPath = createTerminalWorktree(projectPath, createdAgent.id);
          updateTerminalRecord(createdAgent.id, { worktreePath: autoPath });
        } catch (err) {
          // Clean up the agent if worktree creation fails
          await deleteTerminal(createdAgent.id);
          return reply.status(500).send({
            error: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      try {
        await startTerminal(createdAgent.id, options.prompt ?? "");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to start terminal session";
        updateTerminalRecord(createdAgent.id, {
          status: "error",
          error: message,
          lastActivity: new Date().toISOString(),
        });
      }

      const terminal = await getTerminal(createdAgent.id);
      return reply.status(201).send({ terminal: terminal ?? createdAgent });
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : "Invalid input" });
    }
  });

  // Start terminal with prompt
  app.post<{ Params: { id: string } }>(
    "/api/terminals/:id/start",
    async (req, reply) => {
      try {
        const input = AgentStartInput.parse(req.body);
        const result = await startTerminal(
          req.params.id,
          input.prompt
        );
        return { ok: true, ...result };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to start terminal",
        });
      }
    }
  );

  // Stop terminal
  app.post<{ Params: { id: string } }>(
    "/api/terminals/:id/stop",
    async (req, reply) => {
      try {
        await stopTerminal(req.params.id);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to stop terminal",
        });
      }
    }
  );

  // Send input to terminal
  app.post<{ Params: { id: string } }>(
    "/api/terminals/:id/input",
    async (req, reply) => {
      try {
        const input = AgentSendInput.parse(req.body);
        const ok = sendTerminalInput(req.params.id, input.text);
        if (!ok) return reply.status(400).send({ error: "Terminal has no active PTY" });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to send input",
        });
      }
    }
  );

  // Delete terminal
  app.delete<{ Params: { id: string } }>(
    "/api/terminals/:id",
    async (req, reply) => {
      try {
        await deleteTerminal(req.params.id);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to delete terminal",
        });
      }
    }
  );
}
