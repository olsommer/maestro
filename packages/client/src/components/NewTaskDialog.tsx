"use client";

import { useEffect, useState } from "react";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import { api, type KanbanTask } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function NewTaskDialog({ open, onClose, onCreated }: Props) {
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [existingTasks, setExistingTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setProjectId(selectedProjectId ?? projects[0]?.id ?? "");
    api.getKanbanTasks().then(({ tasks }) => setExistingTasks(tasks)).catch(() => {});
  }, [open, projects, selectedProjectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedProjectId = projectId.trim() || undefined;

    if (!title.trim() || !trimmedProjectId) {
      setError("Title and project are required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await api.createKanbanTask({
        title: title.trim(),
        description: description.trim(),
        projectId: trimmedProjectId,
        priority,
        blockedBy,
      });
      onCreated();
      onClose();
      setTitle("");
      setDescription("");
      setBlockedBy([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setLoading(false);
    }
  };

  const selectedProject = projects.find((project) => project.id === projectId);
  const availableBlockers = existingTasks.filter(
    (task) => task.column !== "done" && !blockedBy.includes(task.id)
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>Add a task to the Kanban board</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Could not create task</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-title">Title</FieldLabel>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fix authentication bug"
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="task-description">Description</FieldLabel>
              <Textarea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Detailed description of the task..."
              />
            </Field>

            {projects.length > 0 && (
              <Field>
                <FieldLabel htmlFor="task-project">Project</FieldLabel>
                <Select
                  value={projectId}
                  onValueChange={(value) =>
                    setProjectId(String(value ?? ""))
                  }
                >
                  <SelectTrigger id="task-project" className="w-full">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {selectedProject && (
                  <FieldDescription>{selectedProject.localPath}</FieldDescription>
                )}
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(String(value ?? "medium"))}
              >
                <SelectTrigger id="task-priority" className="w-full">
                  <SelectValue placeholder="Select a priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            {existingTasks.length > 0 && (
              <Field>
                <FieldLabel htmlFor="task-blocked-by">Blocked by</FieldLabel>
                {blockedBy.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {blockedBy.map((id) => {
                      const task = existingTasks.find((t) => t.id === id);
                      return (
                        <Badge key={id} variant="secondary" className="gap-1">
                          {task?.title ?? id}
                          <button
                            type="button"
                            onClick={() =>
                              setBlockedBy((prev) => prev.filter((bid) => bid !== id))
                            }
                            className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                )}
                {availableBlockers.length > 0 && (
                  <Select
                    value=""
                    onValueChange={(value) => {
                      if (value) setBlockedBy((prev) => [...prev, value]);
                    }}
                  >
                    <SelectTrigger id="task-blocked-by" className="w-full">
                      <SelectValue placeholder="Select a blocking task..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availableBlockers.map((task) => (
                          <SelectItem key={task.id} value={task.id}>
                            {task.title}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
                <FieldDescription>
                  This task won&apos;t start until all selected tasks are done.
                </FieldDescription>
              </Field>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
