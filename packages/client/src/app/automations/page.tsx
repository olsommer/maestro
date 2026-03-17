"use client";

import { useCallback, useEffect, useState } from "react";
import {
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

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
  project?: { id: string; name: string } | null;
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

const SOURCE_TYPES = [
  { value: "github_issues", label: "GitHub Issues" },
  { value: "github_prs", label: "GitHub PRs" },
  { value: "rss", label: "RSS Feed" },
];

const PROVIDERS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "custom", label: "Custom CLI" },
];

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
  const [sourceType, setSourceType] = useState("github_issues");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [provider, setProvider] = useState("claude");
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customCommandTemplate, setCustomCommandTemplate] = useState("");
  const [customEnvText, setCustomEnvText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [promptTemplate, setPromptTemplate] = useState(
    "Review this GitHub issue and provide a fix:\n\nTitle: {{ item.title }}\nBody: {{ item.body }}\nURL: {{ item.url }}"
  );
  const [pollInterval, setPollInterval] = useState(5);
  const [pendingAction, setPendingAction] = useState<{
    id: string;
    type: "reset" | "delete";
  } | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const visibleAutomations = selectedProjectId
    ? automations.filter(
        (automation) =>
          automation.agentProjectId === selectedProjectId ||
          automation.agentProjectPath === selectedProject?.localPath
      )
    : automations;
  const isCustomProvider = provider === "custom";

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
          if (separatorIndex === -1) throw new Error(`Invalid: ${line}`);
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
    const trimmedProjectId = projectId.trim() || undefined;
    const trimmedProjectPath = projectPath.trim() || undefined;

    if (!name.trim() || (!trimmedProjectId && !trimmedProjectPath)) {
      setError("Name and project are required");
      return;
    }
    if (isCustomProvider && !customCommandTemplate.trim()) {
      setError("Custom command template is required");
      return;
    }

    setLoading(true);
    setError("");

    let sourceConfig: Record<string, string> = {};
    if (sourceType === "github_issues" || sourceType === "github_prs") {
      if (!owner.trim() || !repo.trim()) {
        setError("Owner and repo required");
        setLoading(false);
        return;
      }
      sourceConfig = { owner: owner.trim(), repo: repo.trim() };
    } else if (sourceType === "rss") {
      if (!rssUrl.trim()) {
        setError("RSS URL required");
        setLoading(false);
        return;
      }
      sourceConfig = { url: rssUrl.trim() };
    }

    try {
      const customEnv =
        isCustomProvider && customEnvText.trim()
          ? parseCustomEnv(customEnvText)
          : undefined;

      const res = await authFetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sourceType,
          sourceConfig,
          agentProvider: provider,
          agentCustomDisplayName: isCustomProvider
            ? customDisplayName.trim() || undefined
            : undefined,
          agentCustomCommandTemplate: isCustomProvider
            ? customCommandTemplate.trim()
            : undefined,
          agentCustomEnv: customEnv,
          agentProjectId: trimmedProjectId,
          agentProjectPath: trimmedProjectId ? undefined : trimmedProjectPath,
          agentPromptTemplate: promptTemplate,
          pollIntervalMinutes: pollInterval,
        }),
      });

      await getJsonOrThrow<{ automation: Automation }>(res);
      setShowNew(false);
      setName("");
      setOwner("");
      setRepo("");
      setRssUrl("");
      setProvider("claude");
      setCustomDisplayName("");
      setCustomCommandTemplate("");
      setCustomEnvText("");
      setProjectId(selectedProjectId ?? projects[0]?.id ?? "");
      setProjectPath("");
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
              Configure a source, project, and prompt template for automated agent runs.
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
                  <FieldLabel htmlFor="automation-source">Source</FieldLabel>
                  <Select
                    value={sourceType}
                    onValueChange={(value) =>
                      setSourceType(String(value ?? "github_issues"))
                    }
                  >
                    <SelectTrigger id="automation-source" className="w-full">
                      <SelectValue placeholder="Select a source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {SOURCE_TYPES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="automation-provider">Provider</FieldLabel>
                  <Select
                    value={provider}
                    onValueChange={(value) => setProvider(String(value ?? "claude"))}
                  >
                    <SelectTrigger id="automation-provider" className="w-full">
                      <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {PROVIDERS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                {(sourceType === "github_issues" || sourceType === "github_prs") && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="automation-owner">GitHub Owner</FieldLabel>
                      <Input
                        id="automation-owner"
                        value={owner}
                        onChange={(e) => setOwner(e.target.value)}
                        placeholder="org"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="automation-repo">GitHub Repo</FieldLabel>
                      <Input
                        id="automation-repo"
                        value={repo}
                        onChange={(e) => setRepo(e.target.value)}
                        placeholder="repo"
                      />
                    </Field>
                  </>
                )}

                {sourceType === "rss" && (
                  <Field>
                    <FieldLabel htmlFor="automation-rss-url">RSS URL</FieldLabel>
                    <Input
                      id="automation-rss-url"
                      value={rssUrl}
                      onChange={(e) => setRssUrl(e.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                )}

                {projects.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor="automation-project">Project</FieldLabel>
                    <Select
                      value={projectId || "manual"}
                      onValueChange={(value) =>
                        setProjectId(value === "manual" ? "" : String(value ?? ""))
                      }
                    >
                      <SelectTrigger id="automation-project" className="w-full">
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
                  <FieldLabel htmlFor="automation-project-path">Path</FieldLabel>
                  <Input
                    id="automation-project-path"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="Agent project path"
                    disabled={Boolean(projectId)}
                  />
                  <FieldDescription>
                    {projectId
                      ? "Using the selected project path."
                      : "Use this when the automation should target a path not stored in Maestro."}
                  </FieldDescription>
                </Field>

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

                {isCustomProvider && (
                  <>
                    <FieldSeparator>Custom CLI</FieldSeparator>

                    <Field>
                      <FieldLabel htmlFor="automation-cli-label">CLI Label</FieldLabel>
                      <Input
                        id="automation-cli-label"
                        value={customDisplayName}
                        onChange={(e) => setCustomDisplayName(e.target.value)}
                        placeholder="CLI label"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="automation-command-template">
                        Command Template
                      </FieldLabel>
                      <Textarea
                        id="automation-command-template"
                        value={customCommandTemplate}
                        onChange={(e) => setCustomCommandTemplate(e.target.value)}
                        rows={3}
                        className="font-mono"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="automation-env">Env Vars</FieldLabel>
                      <Textarea
                        id="automation-env"
                        value={customEnvText}
                        onChange={(e) => setCustomEnvText(e.target.value)}
                        rows={3}
                        className="font-mono"
                      />
                    </Field>
                  </>
                )}

                <Field>
                  <FieldLabel htmlFor="automation-prompt-template">
                    Prompt Template
                  </FieldLabel>
                  <Textarea
                    id="automation-prompt-template"
                    value={promptTemplate}
                    onChange={(e) => setPromptTemplate(e.target.value)}
                    rows={5}
                    className="font-mono"
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
                      {SOURCE_TYPES.find((item) => item.value === automation.sourceType)?.label ||
                        automation.sourceType}
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
                  <Badge variant="secondary" className="text-[10px]">
                    {automation.agentProvider === "custom"
                      ? automation.agentCustomDisplayName || "Custom CLI"
                      : automation.agentProvider}
                  </Badge>
                  <Badge variant="outline" className="max-w-full truncate text-[10px]">
                    {automation.project?.name || automation.agentProjectPath}
                  </Badge>
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
