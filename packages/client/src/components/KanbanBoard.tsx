"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { BanIcon, CheckCircle2Icon, PlusIcon, XIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { api, type KanbanTask } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useStore } from "@/lib/store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "planned", label: "Planned" },
  { id: "ongoing", label: "Ongoing" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
] as const;

function PriorityBadge({ priority }: { priority: string }) {
  const config =
    priority === "high"
      ? { variant: "destructive" as const, label: "High" }
      : priority === "medium"
        ? { variant: "outline" as const, label: "Medium" }
        : { variant: "secondary" as const, label: "Low" };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

interface Props {
  onNewTask: () => void;
}

export function KanbanBoard({ onNewTask }: Props) {
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const loadTasks = useCallback(async () => {
    try {
      const { tasks } = await api.getKanbanTasks();
      setTasks(
        selectedProject
          ? tasks.filter((t) => t.projectId === selectedProject.id || t.projectPath === selectedProject.localPath)
          : tasks
      );
    } catch (err) { console.error("Failed to load tasks:", err); }
  }, [selectedProject]);

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      try {
        const { tasks } = await api.getKanbanTasks();
        if (cancelled) return;
        setTasks(
          selectedProject
            ? tasks.filter((t) => t.projectId === selectedProject.id || t.projectPath === selectedProject.localPath)
            : tasks
        );
      } catch (err) {
        console.error("Failed to load tasks:", err);
      }
    }

    void initialLoad();

    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  useEffect(() => {
    const socket = getSocket();
    const handler = () => loadTasks();
    socket.on("kanban:updated", handler);
    return () => { socket.off("kanban:updated", handler); };
  }, [loadTasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedId(taskId);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleDrop = async (e: React.DragEvent, targetColumn: string) => {
    e.preventDefault();
    if (!draggedId) return;
    const task = tasks.find((t) => t.id === draggedId);
    if (!task || task.column === targetColumn) { setDraggedId(null); return; }
    setTasks((prev) => prev.map((t) => (t.id === draggedId ? { ...t, column: targetColumn } : t)));
    setDraggedId(null);
    try { await api.moveKanbanTask(draggedId, targetColumn); }
    catch { loadTasks(); }
  };
  const handleDelete = async () => {
    if (!pendingDeleteTaskId) return;
    try {
      await api.deleteKanbanTask(pendingDeleteTaskId);
      setTasks((prev) => prev.filter((t) => t.id !== pendingDeleteTaskId));
      setPendingDeleteTaskId(null);
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete task");
    }
  };
  const getColumnTasks = (columnId: string) => tasks.filter((t) => t.column === columnId);
  const doneTaskIds = useMemo(() => new Set(tasks.filter((t) => t.column === "done").map((t) => t.id)), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 sm:p-6 md:flex-row md:overflow-x-auto md:overflow-y-hidden">
      {COLUMNS.map((col) => {
        const columnTasks = getColumnTasks(col.id);
        return (
          <Card
            key={col.id}
            className="flex min-h-[14rem] w-full min-w-0 flex-col md:h-full md:flex-1"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">{col.label}</CardTitle>
                  <Badge variant="secondary" className="text-[10px]">
                    {columnTasks.length}
                  </Badge>
                </div>
                {col.id === "backlog" && (
                  <Button size="xs" variant="ghost" onClick={onNewTask}>
                    <PlusIcon data-icon="inline-start" />
                    Add
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-0 md:flex-1 md:overflow-y-auto">
              {columnTasks.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  className={`cursor-grab rounded-lg border bg-card p-3 transition-all active:cursor-grabbing hover:ring-1 hover:ring-ring/30 ${
                    draggedId === task.id ? "opacity-50" : ""
                  }`}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h4 className="text-sm font-medium leading-tight">{task.title}</h4>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setPendingDeleteTaskId(task.id)}
                    >
                      <XIcon />
                      <span className="sr-only">Delete task</span>
                    </Button>
                  </div>
                  {task.description && (
                    <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={task.priority} />
                    {task.blockedBy.length > 0 && (() => {
                      const isBlocked = !task.blockedBy.every((id) => doneTaskIds.has(id));
                      return (
                        <Badge variant={isBlocked ? "destructive" : "secondary"} className="gap-1">
                          <BanIcon className="size-3" />
                          {isBlocked
                            ? `Blocked (${task.blockedBy.filter((id) => !doneTaskIds.has(id)).length})`
                            : "Unblocked"}
                        </Badge>
                      );
                    })()}
                  </div>
                  {task.blockedBy.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5">
                      {task.blockedBy.map((id) => {
                        const blocker = taskById.get(id);
                        const done = doneTaskIds.has(id);
                        return (
                          <span key={id} className={`text-[11px] ${done ? "text-muted-foreground/50 line-through" : "text-muted-foreground"}`}>
                            {blocker?.title ?? id}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {task.agents && task.agents.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      <Separator />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Assigned agents</span>
                      {task.agents.map((a) => (
                          <div key={a.id} className="flex items-center gap-1.5">
                            <Badge variant="secondary">{a.name || a.id.slice(0, 8)}</Badge>
                            <StatusBadge status={a.status} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {task.labels.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {task.labels.map((label) => (
                        <Badge key={label} variant="outline">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {task.pullRequestUrl && (
                    <div className="mt-2">
                      <a
                        href={task.pullRequestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        Pull request
                        {task.pullRequestNumber ? ` #${task.pullRequestNumber}` : ""}
                      </a>
                    </div>
                  )}
                  {task.progress > 0 && task.progress < 100 && (
                    <Progress value={task.progress} className="mt-2 gap-1">
                      <div className="flex w-full items-center gap-2">
                        <ProgressLabel className="text-[11px] text-muted-foreground">
                          Progress
                        </ProgressLabel>
                        <ProgressValue className="text-[11px]" />
                      </div>
                    </Progress>
                  )}
                  {task.completionSummary && (
                    <Alert className="mt-2">
                      <CheckCircle2Icon />
                      <AlertTitle>Completion summary</AlertTitle>
                      <AlertDescription>{task.completionSummary}</AlertDescription>
                    </Alert>
                  )}
                </div>
              ))}
              {columnTasks.length === 0 && (
                <Empty className="min-h-36 border">
                  <EmptyHeader>
                    <EmptyTitle>
                      {col.id === "planned"
                        ? "Nothing queued"
                        : col.id === "ongoing"
                          ? "No active tasks"
                          : col.id === "review"
                            ? "Nothing in review"
                          : col.id === "done"
                            ? "No completed tasks"
                            : "No tasks yet"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {col.id === "planned"
                        ? "Drop tasks here to queue work."
                        : col.id === "ongoing"
                          ? "Active tasks appear here while agents are working."
                          : col.id === "review"
                            ? "Open pull requests appear here while work is under review."
                          : col.id === "done"
                            ? "Completed tasks land here."
                            : "Create a task to start filling the board."}
                    </EmptyDescription>
                  </EmptyHeader>
                  {col.id === "backlog" && (
                    <Button size="sm" variant="outline" onClick={onNewTask}>
                      <PlusIcon data-icon="inline-start" />
                      Add Task
                    </Button>
                  )}
                </Empty>
              )}
            </CardContent>
          </Card>
        );
      })}
      <ConfirmDialog
        open={pendingDeleteTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteTaskId(null);
        }}
        title="Delete task?"
        description="This permanently removes the kanban task from the board."
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </div>
  );
}
