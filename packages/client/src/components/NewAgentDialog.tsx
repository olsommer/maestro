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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewAgentDialog({ open, onClose }: Props) {
  const addAgent = useStore((s) => s.addAgent);
  const selectAgent = useStore((s) => s.selectAgent);
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("claude");
  const [projectId, setProjectId] = useState("");
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customCommandTemplate, setCustomCommandTemplate] = useState("");
  const [customEnvText, setCustomEnvText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [disableSandbox, setDisableSandbox] = useState(false);
  const [worktreeMode, setWorktreeMode] = useState<"none" | "new" | "existing">("none");
  const [worktreePath, setWorktreePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setProjectId(selectedProjectId ?? projects[0]?.id ?? "");
  }, [open, projects, selectedProjectId]);

  const isCustomProvider = provider === "custom";

  function parseCustomEnv(raw: string): Record<string, string> {
    const entries = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
          throw new Error(`Invalid env line: ${line}`);
        }
        return [
          line.slice(0, separatorIndex).trim(),
          line.slice(separatorIndex + 1).trim(),
        ] as const;
      });
    return Object.fromEntries(entries);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isRoot = projectId === "__root__";
    const trimmedProjectId = isRoot ? undefined : (projectId.trim() || undefined);

    if (!trimmedProjectId && !isRoot) {
      setError("Project is required");
      return;
    }
    if (worktreeMode !== "none" && isRoot) {
      setError("Worktrees require a project");
      return;
    }
    if (worktreeMode === "existing" && !worktreePath.trim()) {
      setError("Worktree path is required");
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
      const { agent } = await api.createAgent({
        name: name || undefined,
        provider,
        projectId: trimmedProjectId,
        projectPath: isRoot ? "/" : undefined,
        customDisplayName: isCustomProvider
          ? customDisplayName.trim() || undefined
          : undefined,
        customCommandTemplate: isCustomProvider
          ? customCommandTemplate.trim()
          : undefined,
        customEnv,
        skipPermissions,
        disableSandbox,
        useWorktree: worktreeMode === "existing",
        worktreePath: worktreeMode === "existing" ? worktreePath.trim() : undefined,
        autoWorktree: worktreeMode === "new",
        prompt: prompt.trim() || undefined,
      });
      addAgent(agent);
      selectAgent(agent.id);
      onClose();
      setName("");
      setPrompt("");
      setCustomDisplayName("");
      setCustomCommandTemplate("");
      setCustomEnvText("");
      setWorktreeMode("none");
      setWorktreePath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setLoading(false);
    }
  };

  const selectedProject = projects.find((project) => project.id === projectId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
          <DialogDescription>Configure and launch a new coding agent</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Could not create agent</AlertTitle>
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
                placeholder="my-agent"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="provider">Provider</FieldLabel>
              <Select
                value={provider}
                onValueChange={(value) => setProvider(String(value ?? "claude"))}
              >
                <SelectTrigger id="provider" className="w-full">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="claude">Claude Code</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="project">Project</FieldLabel>
              {projects.length > 0 ? (
                <Select
                  value={projectId}
                  onValueChange={(value) => setProjectId(String(value ?? ""))}
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
              ) : (
                <FieldDescription>No projects configured. Add a project in Settings first.</FieldDescription>
              )}
              {selectedProject && (
                <FieldDescription>{selectedProject.localPath}</FieldDescription>
              )}
              {projectId === "__root__" && (
                <FieldDescription>Agent will run from the filesystem root.</FieldDescription>
              )}
            </Field>

            {isCustomProvider && (
              <>
                <FieldSeparator>Custom CLI</FieldSeparator>

                <Field>
                  <FieldLabel htmlFor="custom-display-name">CLI Label</FieldLabel>
                  <Input
                    id="custom-display-name"
                    value={customDisplayName}
                    onChange={(e) => setCustomDisplayName(e.target.value)}
                    placeholder="Agent Browser"
                  />
                  <FieldDescription>
                    This label is shown in the UI for custom providers.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="custom-command-template">
                    Command Template
                  </FieldLabel>
                  <Textarea
                    id="custom-command-template"
                    value={customCommandTemplate}
                    onChange={(e) => setCustomCommandTemplate(e.target.value)}
                    rows={3}
                    placeholder="agent-browser --cwd {{projectPath}} --task {{prompt}}"
                    className="font-mono"
                  />
                  <FieldDescription>
                    Placeholders: <code>{"{{projectPath}}"}</code>,{" "}
                    <code>{"{{prompt}}"}</code>
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="custom-env">Env Vars</FieldLabel>
                  <Textarea
                    id="custom-env"
                    value={customEnvText}
                    onChange={(e) => setCustomEnvText(e.target.value)}
                    rows={3}
                    placeholder={"KEY=value\nANOTHER=value"}
                    className="font-mono"
                  />
                  <FieldDescription>
                    Optional newline-delimited environment variables for the command.
                  </FieldDescription>
                </Field>
              </>
            )}

            <Field>
              <FieldLabel htmlFor="agent-prompt">Prompt to start immediately</FieldLabel>
              <Textarea
                id="agent-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="What should this agent work on?"
              />
              <FieldDescription>
                If provided, the agent will start immediately with this prompt.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="worktree-mode">Worktree</FieldLabel>
              <Select
                value={worktreeMode}
                onValueChange={(value) => setWorktreeMode(value as "none" | "new" | "existing")}
              >
                <SelectTrigger id="worktree-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="new">Create new worktree</SelectItem>
                    <SelectItem value="existing">Use existing worktree</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {worktreeMode === "none" && (
                <FieldDescription>
                  Agent works directly in the project directory. Other agents on the same project may conflict.
                </FieldDescription>
              )}
              {worktreeMode === "new" && (
                <FieldDescription>
                  A new git worktree and branch will be created automatically. The agent works in an isolated copy and can&apos;t conflict with other agents.
                </FieldDescription>
              )}
            </Field>

            {worktreeMode === "existing" && (
              <Field>
                <FieldLabel htmlFor="worktree-path">Worktree Path</FieldLabel>
                <Input
                  id="worktree-path"
                  value={worktreePath}
                  onChange={(e) => setWorktreePath(e.target.value)}
                  placeholder={
                    selectedProject
                      ? `${selectedProject.localPath}/../feature-worktree`
                      : "/absolute/path/to/worktree"
                  }
                />
                <FieldDescription>
                  Path to an existing git worktree for this agent.
                </FieldDescription>
              </Field>
            )}

            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="disable-sandbox">Disable Sandbox</FieldLabel>
                <FieldDescription>
                  Run the agent without nsjail sandboxing, even if it&apos;s globally enabled.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="disable-sandbox"
                checked={disableSandbox}
                onCheckedChange={(checked) => {
                  setDisableSandbox(checked);
                  // When sandbox is disabled, turn off YOLO (no safety net).
                  // When sandbox is re-enabled, force YOLO on (sandbox is the safety boundary).
                  setSkipPermissions(!checked);
                }}
              />
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="skip-permissions">YOLO mode</FieldLabel>
                <FieldDescription>
                  {disableSandbox
                    ? "Disabled — no sandbox means no safety net for auto-approval."
                    : "Auto-enabled in sandbox — the sandbox is the security boundary."}
                </FieldDescription>
              </FieldContent>
              <Switch
                id="skip-permissions"
                checked={skipPermissions}
                onCheckedChange={setSkipPermissions}
                disabled
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
