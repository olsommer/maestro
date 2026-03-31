"use client";

import { useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
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
import { Switch } from "@/components/ui/switch";

interface Props {
  open: boolean;
  onClose: () => void;
}

function generateDefaultTerminalName(): string {
  const token = crypto.randomUUID().slice(0, 6);
  return token;
}

export function NewTerminalDialog({ open, onClose }: Props) {
  const addTerminal = useStore((s) => s.addAgent);
  const selectTerminal = useStore((s) => s.selectAgent);
  const projects = useStore((s) => s.projects);

  const [name, setName] = useState("");
  const [sandboxProvider, setSandboxProvider] = useState<"none" | "docker" | "gvisor">("docker");
  const [sandboxAvailability, setSandboxAvailability] = useState({
    dockerAvailable: true,
    gvisorAvailable: false,
  });
  const [projectId, setProjectId] = useState("");
  const [autoWorktree, setAutoWorktree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    void Promise.all([
      api.getSettings().catch(() => null),
      api.getRuntimeStatus().catch(() => null),
    ])
      .then(([settings, runtimeStatus]) => {
        if (settings) {
          const preferredProvider =
            settings.sandboxProvider === "gvisor" &&
            !runtimeStatus?.sandbox.gvisorAvailable
              ? runtimeStatus?.sandbox.dockerAvailable
                ? "docker"
                : "none"
              : settings.sandboxProvider;
          setSandboxProvider(preferredProvider);
        }
        if (runtimeStatus) {
          setSandboxAvailability(runtimeStatus.sandbox);
        }
      })
      .catch(() => {
        setSandboxProvider("docker");
      });
    setName(generateDefaultTerminalName());
    setProjectId("__root__");
    setAutoWorktree(false);
    setError("");
  }, [open]);

  const disableSandbox = sandboxProvider === "none";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isRoot = projectId === "__root__";
    const trimmedProjectId = isRoot ? undefined : (projectId.trim() || undefined);

    if (!trimmedProjectId && !isRoot) {
      setError("Project is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { terminal } = await api.createTerminal({
        name: name || undefined,
        provider: "none",
        projectId: trimmedProjectId,
        projectPath: isRoot ? "/" : undefined,
        autoWorktree: !isRoot && autoWorktree ? true : undefined,
        skipPermissions: false,
        disableSandbox,
        sandboxProvider: !disableSandbox ? sandboxProvider : undefined,
      });
      addTerminal(terminal);
      selectTerminal(terminal.id);
      onClose();
      setName(generateDefaultTerminalName());
      setProjectId("__root__");
      setAutoWorktree(false);
      setSandboxProvider("docker");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create terminal");
    } finally {
      setLoading(false);
    }
  };

  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedProjectSupportsWorktree = Boolean(selectedProject?.repoUrl);
  const worktreeDisabled =
    projectId === "__root__" || (selectedProject != null && !selectedProjectSupportsWorktree);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Terminal</DialogTitle>
          <DialogDescription>
            Configure a terminal. It starts immediately and stays available until deleted.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Could not create terminal</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="agent-name">Name</FieldLabel>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="a1b2c3"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="project">Project</FieldLabel>
              <Select
                value={projectId}
                onValueChange={(value) => {
                  const nextProjectId = String(value ?? "");
                  setProjectId(nextProjectId);
                  const nextProject = projects.find((project) => project.id === nextProjectId);
                  if (nextProjectId === "__root__" || !nextProject?.repoUrl) {
                    setAutoWorktree(false);
                  }
                }}
              >
                <SelectTrigger id="project" className="w-full">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="__root__">Root (/)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {selectedProject && (
                <FieldDescription>{selectedProject.localPath}</FieldDescription>
              )}
              {projectId === "__root__" && (
                <FieldDescription>Terminal will run from the filesystem root.</FieldDescription>
              )}
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="auto-worktree">Fresh Git Worktree</FieldLabel>
                <FieldDescription>
                  {worktreeDisabled
                    ? projectId === "__root__"
                      ? "Unavailable for Root (/). Select a project to create a fresh worktree."
                      : "Unavailable for projects without a linked git repository."
                    : "Create a fresh git worktree for this terminal. Requires the selected project to be a git repository."}
                </FieldDescription>
              </FieldContent>
              <Switch
                id="auto-worktree"
                checked={autoWorktree}
                disabled={worktreeDisabled}
                onCheckedChange={setAutoWorktree}
              />
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="sandbox-enabled">Sandbox</FieldLabel>
                <FieldDescription>
                  {disableSandbox
                    ? "Run this terminal without sandboxing."
                    : `Run this terminal inside the ${sandboxProvider} sandbox.`}
                </FieldDescription>
              </FieldContent>
              <Select
                value={sandboxProvider}
                onValueChange={(value) => {
                  const nextProvider =
                    value === "gvisor" || value === "docker" || value === "none"
                      ? value
                      : "docker";
                  setSandboxProvider(nextProvider);
                }}
              >
                <SelectTrigger id="sandbox-enabled" className="w-full @md/field-group:w-48">
                  <SelectValue placeholder="Select a sandbox" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem
                      value="gvisor"
                      disabled={!sandboxAvailability.gvisorAvailable}
                    >
                      {sandboxAvailability.gvisorAvailable
                        ? "gVisor"
                        : "gVisor (unavailable)"}
                    </SelectItem>
                    <SelectItem value="docker" disabled={!sandboxAvailability.dockerAvailable}>
                      {sandboxAvailability.dockerAvailable
                        ? "Docker"
                        : "Docker (unavailable)"}
                    </SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Terminal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
