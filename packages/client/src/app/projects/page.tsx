"use client";

import { Dispatch, SetStateAction, useEffect, useState } from "react";
import {
  FolderGit2Icon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  api,
  type GitHubConnectionStatus,
  type GitHubRepoSuggestion,
} from "@/lib/api";
import { useStore } from "@/lib/store";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ConfirmDialog";

function ProjectStatusBadge({ status }: { status: string }) {
  const config =
    status === "ready"
      ? {
        variant: "secondary" as const,
        label: "Ready",
      }
      : status === "bootstrapping"
        ? {
          variant: "outline" as const,
          label: "Bootstrapping",
        }
        : {
          variant: "destructive" as const,
          label: "Error",
        };

  return (
    <Badge variant={config.variant}>
      {config.label}
    </Badge>
  );
}

type Props = {
  isCreateMode: boolean;
  setIsCreateMode: Dispatch<SetStateAction<boolean>>;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
}

function ProjectsView(props: Props) {
  const { isCreateMode, setIsCreateMode, error, setError } = props;
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const setProjects = useStore((s) => s.setProjects);
  const addProject = useStore((s) => s.addProject);
  const removeProject = useStore((s) => s.removeProject);
  const updateProject = useStore((s) => s.updateProject);

  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [bootstrap, setBootstrap] = useState(true);
  const [syncIssues, setSyncIssues] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncingProjectId, setSyncingProjectId] = useState<string | null>(null);
  const [github, setGitHub] = useState<GitHubConnectionStatus | null>(null);
  const [repoSuggestions, setRepoSuggestions] = useState<GitHubRepoSuggestion[]>([]);
  const [searchingRepos, setSearchingRepos] = useState(false);
  const [repoSearchError, setRepoSearchError] = useState("");
  const [selectedRepoSuggestion, setSelectedRepoSuggestion] = useState<string | null>(null);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;
  const pendingDeleteProject =
    projects.find((project) => project.id === pendingDeleteProjectId) ?? null;
  const repoQuery = repoUrl.trim();
  const showRepoSuggestions =
    Boolean(github?.connected) &&
    repoQuery.length > 0 &&
    selectedRepoSuggestion !== repoQuery;
  const showCreateCard = projects.length === 0;

  useEffect(() => {
    const load = async () => {
      try {
        const { projects: fresh } = await api.getProjects();
        setProjects(fresh);
      } catch (err) {
        console.error(err);
      }
    };

    void load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, [setProjects]);

  useEffect(() => {
    const loadGitHub = async () => {
      try {
        const { github: integration } = await api.getGitHubIntegration();
        setGitHub(integration);
      } catch {
        setGitHub(null);
      }
    };

    void loadGitHub();
    const handleStatusChanged = () => {
      void loadGitHub();
    };
    window.addEventListener("maestro:github-status-changed", handleStatusChanged);
    return () => {
      window.removeEventListener("maestro:github-status-changed", handleStatusChanged);
    };
  }, []);

  useEffect(() => {
    if (selectedProject && selectedProject.id !== selectedProjectId) {
      selectProject(selectedProject.id);
    }
  }, [selectProject, selectedProject, selectedProjectId]);

  useEffect(() => {
    if (!github?.connected || !showRepoSuggestions) {
      setRepoSuggestions([]);
      setRepoSearchError("");
      setSearchingRepos(false);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setSearchingRepos(true);
      setRepoSearchError("");
      try {
        const { repos } = await api.searchGitHubRepos(repoQuery);
        if (!cancelled) {
          setRepoSuggestions(repos);
        }
      } catch (err) {
        if (!cancelled) {
          setRepoSuggestions([]);
          setRepoSearchError(
            err instanceof Error ? err.message : "Failed to search repositories"
          );
        }
      } finally {
        if (!cancelled) {
          setSearchingRepos(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [github?.connected, repoQuery, showRepoSuggestions]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { project } = await api.createProject({
        name: name.trim(),
        repoUrl: repoQuery || undefined,
        localPath: localPath.trim() || undefined,
        defaultBranch: defaultBranch.trim() || undefined,
        bootstrap,
        syncIssues,
      });
      addProject(project);
      setName("");
      setRepoUrl("");
      setLocalPath("");
      setDefaultBranch("main");
      setBootstrap(true);
      setSyncIssues(true);
      setRepoSuggestions([]);
      setRepoSearchError("");
      setSelectedRepoSuggestion(null);
      setIsCreateMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  }

  async function handleSync(projectId: string) {
    setSyncingProjectId(projectId);
    setError("");

    try {
      const { project } = await api.syncProjectIssues(projectId);
      if (project) updateProject(project.id, project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync issues");
    } finally {
      setSyncingProjectId(null);
    }
  }

  async function handleDeleteProject() {
    if (!pendingDeleteProjectId) {
      return;
    }

    setDeletingProjectId(pendingDeleteProjectId);
    setError("");

    try {
      await api.deleteProject(pendingDeleteProjectId);
      removeProject(pendingDeleteProjectId);
      setPendingDeleteProjectId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeletingProjectId(null);
    }
  }

  function handleSelectRepo(repo: GitHubRepoSuggestion) {
    setRepoUrl(repo.fullName);
    setSelectedRepoSuggestion(repo.fullName);
    if (!name.trim()) {
      setName(repo.name);
    }
    if (!defaultBranch.trim() || defaultBranch === "main") {
      setDefaultBranch(repo.defaultBranch);
    }
    setRepoSuggestions([]);
    setRepoSearchError("");
  }

  function renderRepoField(
    controlId: string,
    options?: { hideWhenDisconnected?: boolean }
  ) {
    if (options?.hideWhenDisconnected && !github?.connected) {
      return null;
    }

    return (
      <Field data-invalid={repoSearchError ? true : undefined}>
        <FieldLabel htmlFor={controlId}>Repo URL or owner/repo</FieldLabel>
        {github?.connected ? (
          <Command
            shouldFilter={false}
            className="rounded-lg border border-input bg-transparent p-0"
          >
            <CommandInput
              id={controlId}
              value={repoUrl}
              onValueChange={(value) => {
                setRepoUrl(value);
                setSelectedRepoSuggestion(null);
              }}
              placeholder="github.com/org/repo"
              autoComplete="off"
              aria-invalid={repoSearchError ? true : undefined}
            />
            {showRepoSuggestions && !repoSearchError && (
              <CommandList>
                {searchingRepos ? (
                  <CommandGroup heading="GitHub">
                    <CommandItem value="searching" disabled>
                      Searching repositories...
                    </CommandItem>
                  </CommandGroup>
                ) : (
                  <>
                    <CommandEmpty>
                      No matching repositories. You can still type a repo manually.
                    </CommandEmpty>
                    <CommandGroup
                      heading={
                        github.login
                          ? `Accessible repositories for @${github.login}`
                          : "Accessible repositories"
                      }
                    >
                      {repoSuggestions.map((repo) => (
                        <CommandItem
                          key={repo.id}
                          value={repo.fullName}
                          data-checked={
                            selectedRepoSuggestion === repo.fullName ? true : undefined
                          }
                          onSelect={() => handleSelectRepo(repo)}
                        >
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {repo.fullName}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                default branch: {repo.defaultBranch}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="shrink-0 text-[10px] uppercase"
                            >
                              {repo.private ? "Private" : "Public"}
                            </Badge>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            )}
          </Command>
        ) : (
          <Input
            id={controlId}
            value={repoUrl}
            onChange={(e) => {
              setRepoUrl(e.target.value);
              setSelectedRepoSuggestion(null);
            }}
            placeholder="github.com/org/repo"
            autoComplete="off"
          />
        )}
        <FieldDescription>
          {github?.connected
            ? `Repo suggestions powered by GitHub${github.login ? ` for @${github.login}` : ""}.`
            : "Connect GitHub in Settings to enable repository search and selection."}
        </FieldDescription>
        {repoSearchError && (
          <FieldDescription className="text-destructive">
            {repoSearchError}
          </FieldDescription>
        )}
      </Field>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex flex-col border-b lg:w-72 lg:border-b-0 lg:border-r xl:w-80">
        <ScrollArea className="max-h-72 lg:max-h-none lg:flex-1">
          <div className="flex flex-col gap-2 p-2">
            {projects.length === 0 ? (
              <Empty className="min-h-52 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderGit2Icon />
                  </EmptyMedia>
                  <EmptyTitle>No projects yet</EmptyTitle>
                  <EmptyDescription>
                    Create a project from a GitHub repository or local checkout to get
                    started.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              projects.map((project) => (
                <Button
                  key={project.id}
                  type="button"
                  variant={selectedProject?.id === project.id ? "secondary" : "outline"}
                  className="h-auto justify-start px-3 py-3 text-left"
                  onClick={() => selectProject(project.id)}
                >
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{project.name}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {project.repoUrl || project.localPath}
                      </p>
                    </div>
                    <div className="shrink-0 text-[10px] uppercase">
                      <ProjectStatusBadge status={project.status} />
                    </div>
                  </div>
                </Button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
          {showCreateCard ? (
            <Card>
              <CardHeader>
                <CardTitle>Create Project</CardTitle>
                <CardDescription>
                  Create from a repo URL or local checkout. Bootstrap starts a
                  provisioning agent.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="flex flex-col gap-5">
                  {error && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>Project action failed</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="project-name">Name</FieldLabel>
                      <Input
                        id="project-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Maestro"
                      />
                    </Field>

                    {renderRepoField("project-repo")}

                    <FieldSeparator />

                    <Field>
                      <FieldLabel htmlFor="project-local-path">Local Path</FieldLabel>
                      <Input
                        id="project-local-path"
                        value={localPath}
                        onChange={(e) => setLocalPath(e.target.value)}
                        placeholder="Defaults to ~/maestro-projects/<repo>"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="project-default-branch">Default Branch</FieldLabel>
                      <Input
                        id="project-default-branch"
                        value={defaultBranch}
                        onChange={(e) => setDefaultBranch(e.target.value)}
                        placeholder="main"
                      />
                    </Field>

                    <FieldSet>
                      <FieldLegend variant="label">Project Options</FieldLegend>
                      <Field orientation="horizontal">
                        <Switch
                          id="project-bootstrap"
                          checked={bootstrap}
                          onCheckedChange={setBootstrap}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor="project-bootstrap">
                            Bootstrap with agent
                          </FieldLabel>
                          <FieldDescription>
                            Start a provisioning agent after the project is created.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                      <Field orientation="horizontal">
                        <Switch
                          id="project-sync"
                          checked={syncIssues}
                          onCheckedChange={setSyncIssues}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor="project-sync">Import GitHub issues</FieldLabel>
                          <FieldDescription>
                            Pull issues into Maestro after the repository is linked.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldSet>
                  </FieldGroup>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={loading}>
                      {loading ? "Creating..." : "Create Project"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            selectedProject && (
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>{selectedProject.name}</CardTitle>
                      <CardDescription className="mt-1">
                        {selectedProject.repoUrl || "Local project"}
                        <br />
                        {selectedProject.localPath}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs uppercase">
                        <ProjectStatusBadge status={selectedProject.status} />
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleSync(selectedProject.id)}
                        disabled={
                          syncingProjectId === selectedProject.id ||
                          !selectedProject.githubOwner ||
                          !selectedProject.githubRepo
                        }
                      >
                        {syncingProjectId === selectedProject.id
                          ? "Syncing..."
                          : "Sync Issues"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setPendingDeleteProjectId(selectedProject.id)}
                        disabled={deletingProjectId === selectedProject.id}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {error && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>Project action failed</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      {
                        label: "GitHub",
                        value:
                          selectedProject.githubOwner && selectedProject.githubRepo
                            ? `${selectedProject.githubOwner}/${selectedProject.githubRepo}`
                            : "Not linked",
                      },
                      {
                        label: "Default Branch",
                        value: selectedProject.defaultBranch || "Not set",
                      },
                      {
                        label: "Bootstrap Agent",
                        value: selectedProject.bootstrapAgentId || "Not started",
                      },
                      {
                        label: "Last Issue Sync",
                        value: selectedProject.lastSyncedAt
                          ? new Date(selectedProject.lastSyncedAt).toLocaleString()
                          : "Never",
                      },
                    ].map((item) => (
                      <Card key={item.label} className="shadow-none">
                        <CardContent className="flex flex-col gap-1 p-3">
                          <p className="text-xs text-muted-foreground">{item.label}</p>
                          <p className="text-sm">{item.value}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {selectedProject.bootstrapError && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>Bootstrap failed</AlertTitle>
                      <AlertDescription>{selectedProject.bootstrapError}</AlertDescription>
                    </Alert>
                  )}

                  {selectedProject.lastSyncError && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>Issue sync failed</AlertTitle>
                      <AlertDescription>{selectedProject.lastSyncError}</AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )
          )}

          {projects.length > 0 && (
            <Dialog open={isCreateMode} onOpenChange={setIsCreateMode}>
              <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Create Project</DialogTitle>
                  <DialogDescription>
                    Create from a repo URL or local checkout. Bootstrap starts a
                    provisioning agent.
                  </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleCreate} className="flex flex-col gap-5">
                  {error && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>Project action failed</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="project-name-dialog">Name</FieldLabel>
                      <Input
                        id="project-name-dialog"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Maestro"
                      />
                    </Field>

                    {renderRepoField("project-repo-dialog", {
                      hideWhenDisconnected: true,
                    })}

                    <FieldSeparator />

                    <Field>
                      <FieldLabel htmlFor="project-local-path-dialog">Local Path</FieldLabel>
                      <Input
                        id="project-local-path-dialog"
                        value={localPath}
                        onChange={(e) => setLocalPath(e.target.value)}
                        placeholder="Defaults to ~/maestro-projects/<repo>"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="project-default-branch-dialog">
                        Default Branch
                      </FieldLabel>
                      <Input
                        id="project-default-branch-dialog"
                        value={defaultBranch}
                        onChange={(e) => setDefaultBranch(e.target.value)}
                        placeholder="main"
                      />
                    </Field>

                    <FieldSet>
                      <FieldLegend variant="label">Project Options</FieldLegend>
                      <Field orientation="horizontal">
                        <Switch
                          id="project-bootstrap-dialog"
                          checked={bootstrap}
                          onCheckedChange={setBootstrap}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor="project-bootstrap-dialog">
                            Bootstrap with agent
                          </FieldLabel>
                          <FieldDescription>
                            Start a provisioning agent after the project is created.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                      <Field orientation="horizontal">
                        <Switch
                          id="project-sync-dialog"
                          checked={syncIssues}
                          onCheckedChange={setSyncIssues}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor="project-sync-dialog">
                            Import GitHub issues
                          </FieldLabel>
                          <FieldDescription>
                            Pull issues into Maestro after the repository is linked.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldSet>
                  </FieldGroup>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={loading}>
                      {loading ? "Creating..." : "Create Project"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}

          <ConfirmDialog
            open={pendingDeleteProjectId !== null}
            onOpenChange={(open) => {
              if (!open && !deletingProjectId) {
                setPendingDeleteProjectId(null);
              }
            }}
            title="Delete project?"
            description={`This removes ${
              pendingDeleteProject?.name || "this project"
            } from Maestro and clears its linked agents, automations, scheduler entries, and local kanban metadata. It does not delete files in ${
              pendingDeleteProject?.localPath || "the project directory"
            }.`}
            confirmLabel="Delete"
            disabled={deletingProjectId !== null}
            onConfirm={handleDeleteProject}
          />
        </div>
      </div>
    </div>
  );
}

function ProjectsPageInner() {

  const [isCreateMode, setIsCreateMode] = useState(false);
  const [error, setError] = useState("");

  return (
    <>
      <header className="sticky top-0 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-2 py-2 md:px-4 md:py-3">
        <div className="w-full flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Projects</h2>
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              setError("");
              setIsCreateMode(true);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            New Project
          </Button>

        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <ProjectsView isCreateMode={isCreateMode} setIsCreateMode={setIsCreateMode} error={error} setError={setError} />
      </main>
    </>
  )

}

export default function ProjectsPage() {
  return (
    <AppShell>
      <ProjectsPageInner />
    </AppShell>
  );
}
