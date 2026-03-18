import * as fs from "fs";
import type { FastifyInstance } from "fastify";
import { AgentSpawnOptions, AgentStartInput, AgentSendInput } from "@maestro/wire";
import {
  createAgent,
  startAgent,
  stopAgent,
  deleteAgent,
  sendInput,
  listAgents,
  getAgent,
  getAgentOutput,
} from "../agents/agent-manager.js";
import { getProjectRecordById } from "../state/projects.js";
import { updateAgentRecord } from "../state/agents.js";
import { createAgentWorktree, isGitRepo } from "../agents/worktree.js";

export async function registerAgentRoutes(app: FastifyInstance) {
  // List all agents
  app.get("/api/agents", async () => {
    const agents = await listAgents();
    return { agents };
  });

  // Get single agent
  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const agent = await getAgent(req.params.id);
    if (!agent) return reply.status(404).send({ error: "Agent not found" });
    return { agent };
  });

  // Get agent output buffer
  app.get<{ Params: { id: string } }>(
    "/api/agents/:id/output",
    async (req, reply) => {
      const agent = await getAgent(req.params.id);
      if (!agent) return reply.status(404).send({ error: "Agent not found" });
      return { output: getAgentOutput(req.params.id) };
    }
  );

  // Create agent
  app.post("/api/agents", async (req, reply) => {
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

      const createdAgent = await createAgent({
        name: options.name,
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
          const autoPath = createAgentWorktree(projectPath, createdAgent.id);
          updateAgentRecord(createdAgent.id, { worktreePath: autoPath });
        } catch (err) {
          // Clean up the agent if worktree creation fails
          await deleteAgent(createdAgent.id);
          return reply.status(500).send({
            error: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // If prompt provided, start immediately
      if (options.prompt) {
        await startAgent(createdAgent.id, options.prompt);
      }

      const agent = await getAgent(createdAgent.id);
      return reply.status(201).send({ agent: agent ?? createdAgent });
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : "Invalid input" });
    }
  });

  // Start agent with prompt
  app.post<{ Params: { id: string } }>(
    "/api/agents/:id/start",
    async (req, reply) => {
      try {
        const input = AgentStartInput.parse(req.body);
        const result = await startAgent(
          req.params.id,
          input.prompt
        );
        return { ok: true, ...result };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to start agent",
        });
      }
    }
  );

  // Stop agent
  app.post<{ Params: { id: string } }>(
    "/api/agents/:id/stop",
    async (req, reply) => {
      try {
        await stopAgent(req.params.id);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to stop agent",
        });
      }
    }
  );

  // Send input to agent
  app.post<{ Params: { id: string } }>(
    "/api/agents/:id/input",
    async (req, reply) => {
      try {
        const input = AgentSendInput.parse(req.body);
        const ok = sendInput(req.params.id, input.text);
        if (!ok) return reply.status(400).send({ error: "Agent has no active PTY" });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to send input",
        });
      }
    }
  );

  // Delete agent
  app.delete<{ Params: { id: string } }>(
    "/api/agents/:id",
    async (req, reply) => {
      try {
        await deleteAgent(req.params.id);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to delete agent",
        });
      }
    }
  );
}
