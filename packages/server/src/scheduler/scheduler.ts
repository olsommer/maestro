import cron from "node-cron";
import {
  createTerminal,
  createAutoSpawnTerminal,
  startTerminal,
} from "../agents/terminal-manager.js";
import type { AgentProvider } from "@maestro/wire";
import {
  listScheduledTaskRecords,
  updateScheduledTaskRecord,
} from "../state/sqlite.js";
import type { ScheduledTaskRecord } from "../state/types.js";

interface ScheduledJob {
  taskId: string;
  cronTask: ReturnType<typeof cron.schedule>;
}

const activeJobs = new Map<string, ScheduledJob>();

export async function startScheduler() {
  const tasks = listScheduledTaskRecords().filter((task) => task.enabled);
  for (const task of tasks) {
    registerJob(task);
  }

  console.log(`Scheduler started with ${tasks.length} task(s)`);
}

export function stopScheduler() {
  for (const [, job] of activeJobs) {
    job.cronTask.stop();
  }
  activeJobs.clear();
  console.log("Scheduler stopped");
}

export function registerJob(task: ScheduledTaskRecord) {
  unregisterJob(task.id);

  if (!cron.validate(task.schedule)) {
    console.error(`Invalid cron expression for task "${task.name}": ${task.schedule}`);
    return;
  }

  const cronTask = cron.schedule(task.schedule, async () => {
    console.log(`Scheduler: running task "${task.name}"`);
    await executeScheduledTask(task);
  });

  activeJobs.set(task.id, { taskId: task.id, cronTask });
  console.log(`Scheduler: registered task "${task.name}" with schedule "${task.schedule}"`);
}

export function unregisterJob(taskId: string) {
  const existing = activeJobs.get(taskId);
  if (existing) {
    existing.cronTask.stop();
    activeJobs.delete(taskId);
  }
}

async function executeScheduledTask(task: ScheduledTaskRecord) {
  try {
    const name = `scheduled-${task.name}-${Date.now()}`;
    const agent = task.provider === "custom"
      ? await createTerminal({
          name,
          kind: "scheduler",
          provider: task.provider as AgentProvider,
          projectId: task.projectId || undefined,
          projectPath: task.projectPath,
          customDisplayName: task.customDisplayName || undefined,
          customCommandTemplate: task.customCommandTemplate || undefined,
          customEnv: task.customEnv || undefined,
          skipPermissions: task.skipPermissions,
        })
      : await createAutoSpawnTerminal({
          name,
          kind: "scheduler",
          projectId: task.projectId || undefined,
          projectPath: task.projectPath,
        });

    await startTerminal(agent.id, task.prompt);
    updateScheduledTaskRecord(task.id, {
      lastRunAt: new Date().toISOString(),
    });

    console.log(`Scheduler: task "${task.name}" started agent ${agent.id}`);
  } catch (err) {
    console.error(`Scheduler: failed to run task "${task.name}":`, err);
  }
}

export function cronToHuman(expression: string): string {
  const parts = expression.split(" ");
  if (parts.length !== 5) return expression;

  const [min, hour, dom, month, dow] = parts;

  if (min === "*" && hour === "*") return "Every minute";
  if (hour === "*" && min !== "*") return `Every hour at :${min.padStart(2, "0")}`;
  if (dom === "*" && month === "*" && dow === "*") {
    if (min !== "*" && hour !== "*") {
      return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    }
  }

  return expression;
}
