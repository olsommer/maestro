"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock3Icon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { authFetch } from "@/lib/fetch";
import { useStore } from "@/lib/store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  scheduleHuman: string;
  projectId: string | null;
  projectPath: string;
  project?: { id: string; name: string } | null;
  provider: string;
  customDisplayName: string | null;
  customCommandTemplate: string | null;
  customEnv: Record<string, string> | null;
  skipPermissions: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

const AGENT_MODES = [
  { value: "default", label: "Default coding agent" },
  { value: "custom", label: "Custom CLI" },
];

function SchedulerView() {
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("0 * * * *");
  const [agentMode, setAgentMode] = useState<"default" | "custom">("default");
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customCommandTemplate, setCustomCommandTemplate] = useState("");
  const [customEnvText, setCustomEnvText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const visibleTasks = selectedProjectId
    ? tasks.filter(
        (task) =>
          task.projectId === selectedProjectId ||
          task.projectPath === selectedProject?.localPath
      )
    : tasks;
  const isCustomProvider = agentMode === "custom";

  useEffect(() => {
    if (!showNew) return;
    setProjectId(selectedProjectId ?? projects[0]?.id ?? "");
  }, [showNew, projects, selectedProjectId]);

  function parseCustomEnv(raw: string): Record<string, string> {
    return Object.fromEntries(
      raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separatorIndex = line.indexOf("=");
          if (separatorIndex === -1) {
            throw new Error(`Invalid: ${line}`);
          }
          return [
            line.slice(0, separatorIndex).trim(),
            line.slice(separatorIndex + 1).trim(),
          ] as const;
        })
    );
  }

  async function getJsonOrThrow<T>(res: Response): Promise<T> {
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const loadTasks = useCallback(async () => {
    try {
      const res = await authFetch("/api/scheduler/tasks");
      const data = await getJsonOrThrow<{ tasks: ScheduledTask[] }>(res);
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedProjectId = projectId.trim() || undefined;
    const trimmedProjectPath = projectPath.trim() || undefined;

    if (!name.trim() || !prompt.trim() || (!trimmedProjectId && !trimmedProjectPath)) {
      setError("Name, prompt, and project are required");
      return;
    }
    if (isCustomProvider && !customCommandTemplate.trim()) {
      setError("Custom command template is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const customEnv =
        isCustomProvider && customEnvText.trim()
          ? parseCustomEnv(customEnvText)
          : undefined;

      const res = await authFetch("/api/scheduler/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          prompt: prompt.trim(),
          schedule,
          provider: isCustomProvider ? "custom" : undefined,
          customDisplayName: isCustomProvider
            ? customDisplayName.trim() || undefined
            : undefined,
          customCommandTemplate: isCustomProvider
            ? customCommandTemplate.trim()
            : undefined,
          customEnv,
          projectId: trimmedProjectId,
          projectPath: trimmedProjectId ? undefined : trimmedProjectPath,
          skipPermissions: isCustomProvider ? true : undefined,
        }),
      });

      await getJsonOrThrow<{ task: ScheduledTask }>(res);
      setShowNew(false);
      setName("");
      setPrompt("");
      setAgentMode("default");
      setCustomDisplayName("");
      setCustomCommandTemplate("");
      setCustomEnvText("");
      setProjectId(selectedProjectId ?? projects[0]?.id ?? "");
      setProjectPath("");
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    await authFetch(`/api/scheduler/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    await loadTasks();
  }

  async function handleRunNow(id: string) {
    await authFetch(`/api/scheduler/tasks/${id}/run`, { method: "POST" });
    await loadTasks();
  }

  async function handleDelete() {
    if (!pendingDeleteId) return;
    await authFetch(`/api/scheduler/tasks/${pendingDeleteId}`, { method: "DELETE" });
    setPendingDeleteId(null);
    await loadTasks();
  }

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold sm:text-2xl">Scheduled Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Recurring tasks on a cron schedule.
          </p>
          {selectedProject && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px]">
                {selectedProject.name}
              </Badge>
              <Badge variant="outline" className="max-w-full truncate text-[10px]">
                {selectedProject.localPath}
              </Badge>
            </div>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
          <Select
            value={selectedProjectId ?? "all"}
            onValueChange={(value) =>
              selectProject(value === "all" ? null : String(value ?? ""))
            }
          >
            <SelectTrigger className="min-w-44">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Button size="sm" onClick={() => setShowNew((open) => !open)}>
            <PlusIcon data-icon="inline-start" />
            New Task
          </Button>
        </div>
      </div>

      {showNew && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create Scheduled Task</CardTitle>
            <CardDescription>
              Define a recurring prompt and project context. Default coding-agent runs use Settings &gt; Agents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-5">
              {error && (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>Could not create task</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="scheduler-name">Name</FieldLabel>
                  <Input
                    id="scheduler-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Task name"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="scheduler-schedule">Schedule</FieldLabel>
                  <Input
                    id="scheduler-schedule"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    placeholder="0 * * * *"
                  />
                  <FieldDescription>
                    Cron expression for when the task should run.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="scheduler-provider">Agent</FieldLabel>
                  <Select
                    value={agentMode}
                    onValueChange={(value) => setAgentMode((value as "default" | "custom") ?? "default")}
                  >
                    <SelectTrigger id="scheduler-provider" className="w-full">
                      <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {AGENT_MODES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {!isCustomProvider && (
                    <FieldDescription>
                      Provider, sandbox, YOLO mode, and worktrees come from Settings &gt; Agents.
                    </FieldDescription>
                  )}
                </Field>

                {projects.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor="scheduler-project">Project</FieldLabel>
                    <Select
                      value={projectId || "manual"}
                      onValueChange={(value) =>
                        setProjectId(value === "manual" ? "" : String(value ?? ""))
                      }
                    >
                      <SelectTrigger id="scheduler-project" className="w-full">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="manual">Manual path</SelectItem>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="scheduler-project-path">Project Path</FieldLabel>
                  <Input
                    id="scheduler-project-path"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="Project path"
                    disabled={Boolean(projectId)}
                  />
                  <FieldDescription>
                    {projectId
                      ? "Using the selected project path."
                      : "Use this when the task should target a path not stored in Maestro."}
                  </FieldDescription>
                </Field>

                {isCustomProvider && (
                  <>
                    <FieldSeparator>Custom CLI</FieldSeparator>

                    <Field>
                      <FieldLabel htmlFor="scheduler-cli-label">CLI Label</FieldLabel>
                      <Input
                        id="scheduler-cli-label"
                        value={customDisplayName}
                        onChange={(e) => setCustomDisplayName(e.target.value)}
                        placeholder="CLI label"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="scheduler-command-template">
                        Command Template
                      </FieldLabel>
                      <Textarea
                        id="scheduler-command-template"
                        value={customCommandTemplate}
                        onChange={(e) => setCustomCommandTemplate(e.target.value)}
                        rows={3}
                        placeholder="agent-browser --cwd {{projectPath}} --task {{prompt}}"
                        className="font-mono"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="scheduler-env">Env Vars</FieldLabel>
                      <Textarea
                        id="scheduler-env"
                        value={customEnvText}
                        onChange={(e) => setCustomEnvText(e.target.value)}
                        rows={3}
                        placeholder={"KEY=value\nANOTHER=value"}
                        className="font-mono"
                      />
                    </Field>
                  </>
                )}

                <Field>
                  <FieldLabel htmlFor="scheduler-prompt">Prompt</FieldLabel>
                  <Textarea
                    id="scheduler-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    placeholder="Agent prompt"
                  />
                </Field>
              </FieldGroup>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowNew(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {visibleTasks.length === 0 ? (
        <Empty className="min-h-[20rem] border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clock3Icon />
            </EmptyMedia>
            <EmptyTitle>No scheduled tasks yet</EmptyTitle>
            <EmptyDescription>
              Create a recurring task to run prompts on a schedule.
            </EmptyDescription>
          </EmptyHeader>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <PlusIcon data-icon="inline-start" />
            New Task
          </Button>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleTasks.map((task) => (
            <Card key={task.id} size="sm">
              <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{task.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {task.scheduleHuman}
                    </Badge>
                    <Badge variant={task.enabled ? "secondary" : "outline"} className="text-[10px]">
                      {task.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {task.prompt}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {task.provider === "custom"
                        ? task.customDisplayName || "Custom CLI"
                        : "Default agent"}
                    </Badge>
                    <Badge variant="outline" className="max-w-full truncate text-[10px]">
                      {task.project?.name || task.projectPath}
                    </Badge>
                    {task.lastRunAt && (
                      <Badge variant="outline" className="text-[10px]">
                        Last: {new Date(task.lastRunAt).toLocaleString()}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="xs"
                    onClick={() => handleRunNow(task.id)}
                  >
                    <PlayIcon data-icon="inline-start" />
                    Run
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => handleToggle(task.id, task.enabled)}
                  >
                    {task.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="destructive"
                    onClick={() => setPendingDeleteId(task.id)}
                  >
                    <Trash2Icon />
                    <span className="sr-only">Delete task</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete scheduled task?"
        description="This removes the scheduled task and its run history from Maestro."
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </div>
  );
}

export default function Page() {
  return (
    <AppShell>
      <main className="flex-1 overflow-auto">
        <SchedulerView />
      </main>
    </AppShell>
  );
}
