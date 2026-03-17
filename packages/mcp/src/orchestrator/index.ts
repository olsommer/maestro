#!/usr/bin/env node

/**
 * Maestro Orchestrator MCP Server
 *
 * Tools for the Super Agent to manage and delegate work across the agent pool.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiRequest } from "./api.js";

const server = new McpServer({
  name: "maestro-orchestrator",
  version: "1.0.0",
});

// ── Project Management ────────────────────────────────────────

server.tool(
  "list_projects",
  "List all known Maestro projects and their current status.",
  {},
  async () => {
    try {
      const data = (await apiRequest("/api/projects")) as {
        projects: unknown[];
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.projects, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_project",
  "Get detailed info about a Maestro project.",
  { id: z.string().describe("Project ID") },
  async ({ id }) => {
    try {
      const data = (await apiRequest(`/api/projects/${id}`)) as {
        project: unknown;
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.project, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "create_project",
  "Create a new Maestro project. Can optionally link a GitHub repo.",
  {
    name: z.string().describe("Project name"),
    repoUrl: z.string().optional().describe("Git repository URL to clone"),
    githubOwner: z.string().optional().describe("GitHub owner (org or user)"),
    githubRepo: z.string().optional().describe("GitHub repo name"),
    defaultBranch: z.string().optional().describe("Default branch name"),
    localPath: z.string().optional().describe("Local path (auto-resolved if omitted)"),
    syncIssues: z.boolean().optional().default(false).describe("Sync GitHub issues to kanban"),
    provider: z
      .enum(["claude", "codex", "custom"])
      .optional()
      .describe("Default provider for agents"),
  },
  async (params) => {
    try {
      const data = (await apiRequest("/api/projects", "POST", params)) as {
        project: { id: string; name: string };
      };
      return {
        content: [
          {
            type: "text" as const,
            text: `Created project "${data.project.name}" (${data.project.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "delete_project",
  "Permanently delete a Maestro project.",
  { id: z.string().describe("Project ID") },
  async ({ id }) => {
    try {
      await apiRequest(`/api/projects/${id}`, "DELETE");
      return {
        content: [{ type: "text" as const, text: `Deleted project ${id}` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "sync_github_issues",
  "Sync GitHub issues into the kanban board for a project.",
  { id: z.string().describe("Project ID") },
  async ({ id }) => {
    try {
      const data = (await apiRequest(
        `/api/projects/${id}/sync/github-issues`,
        "POST"
      )) as { ok: boolean; created?: number; updated?: number };
      return {
        content: [
          {
            type: "text" as const,
            text: `Synced GitHub issues for project ${id}. Created: ${data.created ?? 0}, Updated: ${data.updated ?? 0}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Agent Management ──────────────────────────────────────────

server.tool(
  "list_agents",
  "List all agents and their current status, projects, and tasks.",
  {},
  async () => {
    try {
      const data = (await apiRequest("/api/agents")) as {
        agents: unknown[];
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.agents, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_agent",
  "Get detailed info about a specific agent including output history.",
  { id: z.string().describe("Agent ID") },
  async ({ id }) => {
    try {
      const data = (await apiRequest(`/api/agents/${id}`)) as {
        agent: unknown;
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.agent, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_agent_output",
  "Get the agent's terminal output buffer as raw text.",
  { id: z.string().describe("Agent ID") },
  async ({ id }) => {
    try {
      const data = (await apiRequest(`/api/agents/${id}/output`)) as {
        output: string[];
      };
      return {
        content: [
          {
            type: "text" as const,
            text: data.output.join("") || "(no output yet)",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "create_agent",
  "Create a new agent for a project. Returns in 'idle' state until started.",
  {
    projectId: z.string().optional().describe("Project ID"),
    projectPath: z
      .string()
      .optional()
      .describe("Absolute path to the project directory"),
    name: z.string().optional().describe("Name for the agent"),
    skills: z.array(z.string()).optional().describe("Skills to enable"),
    skipPermissions: z
      .boolean()
      .optional()
      .default(true)
      .describe("Run in autonomous mode (default: true)"),
    provider: z
      .enum(["claude", "codex", "custom"])
      .optional()
      .describe("CLI provider"),

    customDisplayName: z.string().optional().describe("Label for custom CLI"),
    customCommandTemplate: z
      .string()
      .optional()
      .describe("Template for custom CLI commands"),
    customEnv: z
      .record(z.string())
      .optional()
      .describe("Environment variables for the custom CLI"),
  },
  async ({
    projectId,
    projectPath,
    name,
    skills,
    skipPermissions = true,
    provider,
    customDisplayName,
    customCommandTemplate,
    customEnv,
  }) => {
    try {
      if (!projectId && !projectPath) {
        throw new Error("projectId or projectPath is required");
      }
      const data = (await apiRequest("/api/agents", "POST", {
        projectId,
        projectPath,
        name,
        skills,
        skipPermissions,
        provider,
        customDisplayName,
        customCommandTemplate,
        customEnv,
      })) as { agent: { id: string; name: string } };
      return {
        content: [
          {
            type: "text" as const,
            text: `Created agent "${data.agent.name || data.agent.id}"`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "start_agent",
  "Start an idle agent. If a prompt is provided, start with that task. If already running, sends the prompt as input instead.",
  {
    id: z.string().describe("Agent ID"),
    prompt: z
      .string()
      .optional()
      .default("")
      .describe("Optional task/instruction for the agent"),
  },
  async ({ id, prompt }) => {
    try {
      const agentData = (await apiRequest(`/api/agents/${id}`)) as {
        agent: { status: string; name?: string };
      };
      const name = agentData.agent.name || id;

      if (
        agentData.agent.status === "running" ||
        agentData.agent.status === "waiting"
      ) {
        if (!prompt.trim()) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Agent "${name}" is already ${agentData.agent.status}. No input sent.`,
              },
            ],
          };
        }

        await apiRequest(`/api/agents/${id}/input`, "POST", { text: prompt });
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent "${name}" was already ${agentData.agent.status}. Sent as input.`,
            },
          ],
        };
      }

      await apiRequest(`/api/agents/${id}/start`, "POST", { prompt });
      return {
        content: [
          {
            type: "text" as const,
            text: prompt.trim()
              ? `Started agent "${name}" with task: ${prompt.slice(0, 100)}`
              : `Started agent "${name}" with no prompt.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "stop_agent",
  "Stop a running agent and return it to idle state.",
  { id: z.string().describe("Agent ID") },
  async ({ id }) => {
    try {
      await apiRequest(`/api/agents/${id}/stop`, "POST");
      return {
        content: [{ type: "text" as const, text: `Stopped agent ${id}` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "remove_agent",
  "Permanently remove an agent (stops it first if running).",
  { id: z.string().describe("Agent ID") },
  async ({ id }) => {
    try {
      await apiRequest(`/api/agents/${id}`, "DELETE");
      return {
        content: [{ type: "text" as const, text: `Removed agent ${id}` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "send_message",
  "Send input to an agent. If idle, starts the agent with this as the prompt.",
  {
    id: z.string().describe("Agent ID"),
    message: z.string().describe("Message/input to send"),
  },
  async ({ id, message }) => {
    try {
      const agentData = (await apiRequest(`/api/agents/${id}`)) as {
        agent: { status: string; name?: string };
      };
      const name = agentData.agent.name || id;
      const status = agentData.agent.status;

      if (status === "idle" || status === "completed" || status === "error") {
        await apiRequest(`/api/agents/${id}/start`, "POST", {
          prompt: message,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent "${name}" was ${status}. Started with prompt.`,
            },
          ],
        };
      }

      await apiRequest(`/api/agents/${id}/input`, "POST", { text: message });
      return {
        content: [
          {
            type: "text" as const,
            text: `Sent message to agent "${name}" (${status})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Kanban Integration ────────────────────────────────────────

server.tool(
  "list_tasks",
  "List kanban tasks, optionally filtered by column (backlog/planned/ongoing/done).",
  {
    column: z
      .enum(["backlog", "planned", "ongoing", "review", "done"])
      .optional()
      .describe("Filter by column"),
  },
  async ({ column }) => {
    try {
      const query = column ? `?column=${column}` : "";
      const data = (await apiRequest(`/api/kanban/tasks${query}`)) as {
        tasks: unknown[];
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.tasks, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "create_task",
  "Create a new kanban task in the backlog. Move to 'planned' to trigger auto-assignment.",
  {
    title: z.string().describe("Task title"),
    description: z.string().describe("Detailed task description"),
    projectPath: z.string().describe("Project directory for this task"),
    requiredSkills: z
      .array(z.string())
      .optional()
      .describe("Skills needed for this task"),
    priority: z
      .enum(["high", "medium", "low"])
      .optional()
      .describe("Task priority"),
  },
  async ({ title, description, projectPath, requiredSkills, priority }) => {
    try {
      const data = (await apiRequest("/api/kanban/tasks", "POST", {
        title,
        description,
        projectPath,
        requiredSkills,
        priority,
      })) as { task: { id: string; title: string } };
      return {
        content: [
          {
            type: "text" as const,
            text: `Created task "${data.task.title}" (${data.task.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "move_task",
  "Move a kanban task to a different column. Moving to 'planned' triggers auto-assignment to idle agents.",
  {
    taskId: z.string().describe("Task ID"),
    column: z
      .enum(["backlog", "planned", "ongoing", "review", "done"])
      .describe("Target column"),
  },
  async ({ taskId, column }) => {
    try {
      await apiRequest(`/api/kanban/tasks/${taskId}/move`, "POST", { column });
      return {
        content: [
          {
            type: "text" as const,
            text: `Moved task ${taskId} to ${column}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "complete_task",
  "Mark a kanban task as done with a completion summary.",
  {
    taskId: z.string().describe("Task ID"),
    summary: z.string().describe("Summary of what was accomplished"),
  },
  async ({ taskId, summary }) => {
    try {
      await apiRequest(`/api/kanban/tasks/${taskId}`, "PATCH", {
        completionSummary: summary,
      });
      await apiRequest(`/api/kanban/tasks/${taskId}/move`, "POST", {
        column: "done",
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Completed task ${taskId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_task",
  "Get detailed info about a single kanban task.",
  { id: z.string().describe("Task ID") },
  async ({ id }) => {
    try {
      const data = (await apiRequest(`/api/kanban/tasks/${id}`)) as {
        task: unknown;
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.task, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "update_task",
  "Update a kanban task's fields (title, description, priority, progress, labels, etc.).",
  {
    id: z.string().describe("Task ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    priority: z
      .enum(["high", "medium", "low"])
      .optional()
      .describe("New priority"),
    progress: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Progress percentage (0-100)"),
    labels: z.array(z.string()).optional().describe("Labels"),
    blockedBy: z
      .array(z.string())
      .optional()
      .describe("IDs of blocking tasks"),
    completionSummary: z
      .string()
      .optional()
      .describe("Summary of completed work"),
  },
  async ({ id, ...updates }) => {
    try {
      const data = (await apiRequest(
        `/api/kanban/tasks/${id}`,
        "PATCH",
        updates
      )) as { task: { id: string; title: string } };
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated task "${data.task.title}" (${data.task.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "delete_task",
  "Permanently delete a kanban task.",
  { id: z.string().describe("Task ID") },
  async ({ id }) => {
    try {
      await apiRequest(`/api/kanban/tasks/${id}`, "DELETE");
      return {
        content: [{ type: "text" as const, text: `Deleted task ${id}` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Scheduler ────────────────────────────────────────────────

server.tool(
  "list_scheduled_tasks",
  "List all scheduled (cron) tasks.",
  {},
  async () => {
    try {
      const data = (await apiRequest("/api/scheduler/tasks")) as {
        tasks: unknown[];
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.tasks, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_scheduled_task",
  "Get detailed info about a scheduled task.",
  { id: z.string().describe("Scheduled task ID") },
  async ({ id }) => {
    try {
      const data = (await apiRequest(`/api/scheduler/tasks/${id}`)) as {
        task: unknown;
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data.task, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "create_scheduled_task",
  "Create a new scheduled task that spawns an agent on a cron schedule.",
  {
    name: z.string().describe("Task name"),
    prompt: z.string().describe("Prompt to send to the agent each run"),
    schedule: z.string().describe("Cron expression (e.g. '0 */6 * * *' for every 6 hours)"),
    projectId: z.string().optional().describe("Project ID"),
    projectPath: z.string().optional().describe("Project directory"),
    provider: z
      .enum(["claude", "codex", "custom"])
      .optional()
      .describe("CLI provider"),

    customDisplayName: z.string().optional().describe("Label for custom CLI"),
    customCommandTemplate: z
      .string()
      .optional()
      .describe("Template for custom CLI commands"),
    customEnv: z
      .record(z.string())
      .optional()
      .describe("Environment variables"),
    skipPermissions: z
      .boolean()
      .optional()
      .default(true)
      .describe("Run in autonomous mode"),
    enabled: z
      .boolean()
      .optional()
      .default(true)
      .describe("Enable immediately"),
  },
  async (params) => {
    try {
      const data = (await apiRequest(
        "/api/scheduler/tasks",
        "POST",
        params
      )) as { task: { id: string; name: string } };
      return {
        content: [
          {
            type: "text" as const,
            text: `Created scheduled task "${data.task.name}" (${data.task.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "update_scheduled_task",
  "Update a scheduled task's fields (name, prompt, schedule, enabled, etc.).",
  {
    id: z.string().describe("Scheduled task ID"),
    name: z.string().optional().describe("New name"),
    prompt: z.string().optional().describe("New prompt"),
    schedule: z.string().optional().describe("New cron expression"),
    provider: z
      .enum(["claude", "codex", "custom"])
      .optional()
      .describe("CLI provider"),

    skipPermissions: z.boolean().optional().describe("Autonomous mode"),
    enabled: z.boolean().optional().describe("Enable or disable the schedule"),
  },
  async ({ id, ...updates }) => {
    try {
      const data = (await apiRequest(
        `/api/scheduler/tasks/${id}`,
        "PATCH",
        updates
      )) as { task: { id: string; name: string } };
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated scheduled task "${data.task.name}" (${data.task.id})`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "delete_scheduled_task",
  "Delete a scheduled task and unregister its cron job.",
  { id: z.string().describe("Scheduled task ID") },
  async ({ id }) => {
    try {
      await apiRequest(`/api/scheduler/tasks/${id}`, "DELETE");
      return {
        content: [
          { type: "text" as const, text: `Deleted scheduled task ${id}` },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "run_scheduled_task",
  "Manually trigger a scheduled task now, spawning a fresh agent.",
  { id: z.string().describe("Scheduled task ID") },
  async ({ id }) => {
    try {
      const data = (await apiRequest(
        `/api/scheduler/tasks/${id}/run`,
        "POST"
      )) as { ok: boolean; agentId: string };
      return {
        content: [
          {
            type: "text" as const,
            text: `Triggered scheduled task ${id}. Agent spawned: ${data.agentId}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Delegate (composite) ──────────────────────────────────────

server.tool(
  "delegate_task",
  "Create an agent, start it with a task, and wait for the result. The primary tool for delegating work to the agent pool.",
  {
    projectId: z.string().optional().describe("Project ID"),
    projectPath: z.string().optional().describe("Project directory"),
    prompt: z.string().describe("Task for the agent"),
    name: z.string().optional().describe("Agent name"),
    provider: z
      .enum(["claude", "codex", "custom"])
      .optional()
      .describe("CLI provider"),

    customDisplayName: z.string().optional().describe("Label for custom CLI"),
    customCommandTemplate: z
      .string()
      .optional()
      .describe("Template for custom CLI commands"),
    customEnv: z
      .record(z.string())
      .optional()
      .describe("Environment variables for the custom CLI"),
    timeoutSeconds: z
      .number()
      .optional()
      .default(300)
      .describe("Max wait time (default: 300s)"),
  },
  async ({
    projectId,
    projectPath,
    prompt,
    name,
    provider,
    customDisplayName,
    customCommandTemplate,
    customEnv,
    timeoutSeconds = 300,
  }) => {
    try {
      if (!projectId && !projectPath) {
        throw new Error("projectId or projectPath is required");
      }
      // Create agent
      const createData = (await apiRequest("/api/agents", "POST", {
        projectId,
        projectPath,
        name: name || `delegate-${Date.now()}`,
        provider,
        customDisplayName,
        customCommandTemplate,
        customEnv,
        skipPermissions: true,
      })) as { agent: { id: string; name: string } };

      const agentId = createData.agent.id;
      const agentName = createData.agent.name || agentId;

      // Start with prompt
      await apiRequest(`/api/agents/${agentId}/start`, "POST", {
        prompt,
      });

      // Poll for completion (since we don't have long-poll /wait endpoint yet)
      const deadline = Date.now() + timeoutSeconds * 1000;
      let finalStatus = "running";

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        const check = (await apiRequest(`/api/agents/${agentId}`)) as {
          agent: { status: string };
        };
        finalStatus = check.agent.status;
        if (
          finalStatus === "completed" ||
          finalStatus === "error" ||
          finalStatus === "idle"
        ) {
          break;
        }
      }

      // Get output
      const outputData = (await apiRequest(
        `/api/agents/${agentId}/output`
      )) as { output: string[] };
      const output = outputData.output.join("").slice(-2000); // Last 2000 chars

      if (finalStatus === "error") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent "${agentName}" failed.\n\nOutput:\n${output || "(no output)"}`,
            },
          ],
          isError: true,
        };
      }

      if (finalStatus === "running") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent "${agentName}" is still running after ${timeoutSeconds}s. Use get_agent_output(${agentId}) to check progress.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Agent "${agentName}" completed.\n\nOutput:\n${output || "(no output)"}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Start Server ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Maestro Orchestrator MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
