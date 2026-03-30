"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GithubIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  ZapIcon,
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
import { Separator } from "@/components/ui/separator";

interface AutomationRun {
  id: string;
  status: string;
  itemsFound: number;
  itemsProcessed: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface Automation {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  sourceType: string;
  sourceConfig: Record<string, string>;
  triggerType: string;
  agentProjectId: string | null;
  agentProjectPath: string;
  project?: {
    id: string;
    name: string;
    githubOwner: string | null;
    githubRepo: string | null;
  } | null;
  agentPromptTemplate: string;
  agentProvider: string;
  agentModel: string | null;
  agentCustomDisplayName: string | null;
  agentCustomCommandTemplate: string | null;
  agentCustomEnv: Record<string, string> | null;
  pollIntervalMinutes: number;
  lastPollAt: string | null;
  runs: AutomationRun[];
  createdAt: string;
}

const MENTIONS_SOURCE_LABEL = "GitHub Mentions";

function runBadgeVariant(status: string): "secondary" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "completed") return "secondary";
  return "outline";
}

function AutomationsView() {
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [pollInterval, setPollInterval] = useState(5);
  const [pendingAction, setPendingAction] = useState<{
    id: string;
    type: "reset" | "delete";
  } | null>(null);

  const githubProjects = projects.filter((project) => project.githubOwner && project.githubRepo);
  const selectedGithubProject =
    githubProjects.find((project) => project.id === projectId) ?? null;
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const visibleAutomations = selectedProjectId
    ? automations.filter(
        (automation) =>
          automation.agentProjectId === selectedProjectId ||
          automation.agentProjectPath === selectedProject?.localPath
      )
    : automations;

  useEffect(() => {
    if (!showNew) return;
    const defaultProjectId =
      githubProjects.find((project) => project.id === selectedProjectId)?.id ??
      githubProjects[0]?.id ??
      "";
    setProjectId(defaultProjectId);
  }, [githubProjects, selectedProjectId, showNew]);

  async function getJsonOrThrow<T>(res: Response): Promise<T> {
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/automations");
      const data = await getJsonOrThrow<{ automations: Automation[] }>(res);
      setAutomations(Array.isArray(data.automations) ? data.automations : []);
    } catch {
      setAutomations([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedProjectId = projectId.trim();

    if (!name.trim() || !trimmedProjectId) {
      setError("Name and project are required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await authFetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          agentProjectId: trimmedProjectId,
          pollIntervalMinutes: pollInterval,
        }),
      });

      await getJsonOrThrow<{ automation: Automation }>(res);
      setShowNew(false);
      setName("");
      setProjectId(
        githubProjects.find((project) => project.id === selectedProjectId)?.id ??
          githubProjects[0]?.id ??
          ""
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    await authFetch(`/api/automations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    await load();
  }

  async function handleConfirmAction() {
    if (!pendingAction) return;

    if (pendingAction.type === "reset") {
      await authFetch(`/api/automations/${pendingAction.id}/reset`, { method: "POST" });
    } else {
      await authFetch(`/api/automations/${pendingAction.id}`, { method: "DELETE" });
    }

    setPendingAction(null);
    await load();
  }

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold sm:text-2xl">Automations</h2>
          <p className="text-sm text-muted-foreground">
            Event-driven workflows that spawn agents.
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
            New Automation
          </Button>
        </div>
      </div>

      {showNew && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create Automation</CardTitle>
            <CardDescription>
              Create a GitHub mentions automation for a linked project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-5">
              {error && (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>Could not create automation</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="automation-name">Name</FieldLabel>
                  <Input
                    id="automation-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Automation name"
                  />
                </Field>

                <Field>
                  <FieldLabel>Source</FieldLabel>
                  <div className="flex h-9 items-center rounded-md border px-3 text-sm">
                    {MENTIONS_SOURCE_LABEL}
                  </div>
                  <FieldDescription>
                    Automations currently trigger only from GitHub mentions.
                  </FieldDescription>
                </Field>

                {githubProjects.length > 0 ? (
                  <Field>
                    <FieldLabel htmlFor="automation-project">Project</FieldLabel>
                    <Select
                      value={projectId}
                      onValueChange={(value) => setProjectId(String(value ?? ""))}
                    >
                      <SelectTrigger id="automation-project" className="w-full">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {githubProjects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {selectedGithubProject && (
                      <FieldDescription>
                        {selectedGithubProject.githubOwner}/{selectedGithubProject.githubRepo}
                      </FieldDescription>
                    )}
                    <FieldDescription>
                      Automations are scoped to a GitHub-linked project and use that repository
                      for mentions.
                    </FieldDescription>
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel>Project</FieldLabel>
                    <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                      Link a project to a GitHub repository before creating an automation.
                    </div>
                    <FieldDescription>
                      Automations are scoped to a GitHub-linked project and use that repository
                      for mentions.
                    </FieldDescription>
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="automation-poll-interval">
                    Poll Interval
                  </FieldLabel>
                  <Input
                    id="automation-poll-interval"
                    type="number"
                    value={pollInterval}
                    onChange={(e) =>
                      setPollInterval(parseInt(e.target.value, 10) || 5)
                    }
                    min={1}
                  />
                  <FieldDescription>Interval in minutes.</FieldDescription>
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
                <Button type="submit" disabled={loading || githubProjects.length === 0}>
                  {loading ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {visibleAutomations.length === 0 ? (
        <Empty className="min-h-[20rem] border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ZapIcon />
            </EmptyMedia>
            <EmptyTitle>No automations yet</EmptyTitle>
            <EmptyDescription>
              Create an automation to watch a source and launch agent work automatically.
            </EmptyDescription>
          </EmptyHeader>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <PlusIcon data-icon="inline-start" />
            New Automation
          </Button>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleAutomations.map((automation) => (
            <Card key={automation.id} size="sm">
              <CardContent>
                <div className="mb-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{automation.name}</span>
                    <Badge variant="secondary">
                      {automation.sourceType === "github_mentions"
                        ? MENTIONS_SOURCE_LABEL
                        : automation.sourceType}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      every {automation.pollIntervalMinutes}m
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {automation.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handleToggle(automation.id, automation.enabled)}
                    >
                      {automation.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="secondary"
                      onClick={() =>
                        setPendingAction({ id: automation.id, type: "reset" })
                      }
                    >
                      <RotateCcwIcon />
                      <span className="sr-only">Reset processed items</span>
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="destructive"
                      onClick={() =>
                        setPendingAction({ id: automation.id, type: "delete" })
                      }
                    >
                      <Trash2Icon />
                      <span className="sr-only">Delete automation</span>
                    </Button>
                  </div>
                </div>

                {automation.description && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    {automation.description}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="max-w-full truncate text-[10px]">
                    {automation.project?.name || automation.agentProjectPath}
                  </Badge>
                  {(automation.project?.githubOwner || automation.sourceConfig.owner) &&
                    (automation.project?.githubRepo || automation.sourceConfig.repo) && (
                      <Badge variant="secondary" className="text-[10px]">
                        <GithubIcon className="size-3" />
                        {(automation.project?.githubOwner || automation.sourceConfig.owner)}/
                        {(automation.project?.githubRepo || automation.sourceConfig.repo)}
                      </Badge>
                    )}
                  {automation.lastPollAt && (
                    <Badge variant="outline" className="text-[10px]">
                      Last poll: {new Date(automation.lastPollAt).toLocaleString()}
                    </Badge>
                  )}
                </div>

                {automation.runs.length > 0 && (
                  <div className="mt-3 flex flex-col gap-3">
                    <Separator />
                    <p className="text-xs text-muted-foreground">Recent runs</p>
                    {automation.runs.slice(0, 3).map((run) => (
                      <Card key={run.id} className="shadow-none">
                        <CardContent className="flex flex-col gap-2 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
                            <span className="text-muted-foreground">
                              {run.itemsProcessed}/{run.itemsFound} items
                            </span>
                            <span className="text-muted-foreground/60">
                              {new Date(run.startedAt).toLocaleString()}
                            </span>
                          </div>
                          {run.error && (
                            <Alert variant="destructive">
                              <TriangleAlertIcon />
                              <AlertTitle>Run failed</AlertTitle>
                              <AlertDescription>{run.error}</AlertDescription>
                            </Alert>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        title={
          pendingAction?.type === "reset"
            ? "Reset processed items?"
            : "Delete automation?"
        }
        description={
          pendingAction?.type === "reset"
            ? "This clears the automation's processed item history so existing items can run again."
            : "This permanently removes the automation and its recent run history from Maestro."
        }
        confirmLabel={pendingAction?.type === "reset" ? "Reset" : "Delete"}
        onConfirm={handleConfirmAction}
      />
    </div>
  );
}

export default function Page() {
  return (
    <AppShell>
      <main className="flex-1 overflow-auto">
        <AutomationsView />
      </main>
    </AppShell>
  );
}
