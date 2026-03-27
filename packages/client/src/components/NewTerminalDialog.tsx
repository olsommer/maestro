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
  const [provider, setProvider] = useState<"none" | "claude" | "codex">("none");
  const [projectId, setProjectId] = useState("");
  const [autoWorktree, setAutoWorktree] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [disableSandbox, setDisableSandbox] = useState(false);
  const [sandboxProvider, setSandboxProvider] = useState<"none" | "docker">("docker");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(generateDefaultTerminalName());
    setProjectId("__root__");
    setProvider("none");
    setAutoWorktree(false);
    setSkipPermissions(true);
    setDisableSandbox(false);
    setSandboxProvider("docker");
    setError("");
  }, [open]);

  const hasCodingAgent = provider !== "none";

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
        provider,
        projectId: trimmedProjectId,
        projectPath: isRoot ? "/" : undefined,
        autoWorktree: !isRoot && autoWorktree ? true : undefined,
        skipPermissions: hasCodingAgent && !disableSandbox ? skipPermissions : false,
        disableSandbox,
        sandboxProvider: !disableSandbox ? sandboxProvider : undefined,
      });
      addTerminal(terminal);
      selectTerminal(terminal.id);
      onClose();
      setName(generateDefaultTerminalName());
      setProjectId("__root__");
      setProvider("none");
      setAutoWorktree(false);
      setSkipPermissions(true);
      setDisableSandbox(false);
      setSandboxProvider("docker");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create terminal");
    } finally {
      setLoading(false);
    }
  };

  const selectedProject = projects.find((project) => project.id === projectId);
  const worktreeDisabled = projectId === "__root__";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Terminal</DialogTitle>
          <DialogDescription>
            Configure a coding terminal. It starts immediately and stays available until deleted.
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
                  if (nextProjectId === "__root__") {
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
                    ? "Unavailable for Root (/). Select a project to create a fresh worktree."
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
                  Run inside a sandbox runner. Choose the runner below when sandboxing is on.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="sandbox-enabled"
                checked={!disableSandbox}
                onCheckedChange={(checked) => {
                  setDisableSandbox(!checked);
                  if (!checked) {
                    setSkipPermissions(false);
                  }
                }}
              />
            </Field>

            {!disableSandbox && (
              <Field>
                <FieldLabel htmlFor="sandbox-provider">Sandbox runner</FieldLabel>
                <Select
                  value={sandboxProvider}
                  onValueChange={(value) =>
                    setSandboxProvider(
                      (value as "none" | "docker") ?? "docker"
                    )
                  }
                >
                  <SelectTrigger id="sandbox-provider" className="w-full">
                    <SelectValue placeholder="Select a sandbox runner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="docker">Docker</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Docker uses an isolated container with Node, Python, and Docker Compose
                  tooling.
                </FieldDescription>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="provider">Spawn Coding Agent</FieldLabel>
              <Select
                value={provider}
                onValueChange={(value) =>
                  setProvider((value as "none" | "claude" | "codex") ?? "none")
                }
              >
                <SelectTrigger id="provider" className="w-full">
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                    <SelectItem value="claude">Claude Code</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {provider === "none"
                  ? "Launch a plain terminal without starting a coding agent."
                  : "Launch the terminal and start the selected coding agent inside it."}
              </FieldDescription>
            </Field>

            {hasCodingAgent && !disableSandbox && (
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor="skip-permissions">YOLO mode</FieldLabel>
                  <FieldDescription>
                    Run without approval prompts for the selected coding agent.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="skip-permissions"
                  checked={skipPermissions}
                  onCheckedChange={setSkipPermissions}
                />
              </Field>
            )}
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
