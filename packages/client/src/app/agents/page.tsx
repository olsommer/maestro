"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Terminal } from "@/components/Terminal";
import { NewAgentDialog } from "@/components/NewAgentDialog";
import { StatusBadge, StatusDot } from "@/components/StatusBadge";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { api, type Agent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlayIcon,
  PlusIcon,
  SquareIcon,
  TriangleAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { SidebarSeparator, SidebarTrigger } from "@/components/ui/sidebar";

type GridPreset = "auto" | "1x1" | "2x1" | "2x2" | "3x2" | "3x3";

const GRID_PRESETS: Record<Exclude<GridPreset, "auto">, { cols: number; rows: number; label: string }> = {
  "1x1": { cols: 1, rows: 1, label: "1x1 Grid" },
  "2x1": { cols: 2, rows: 1, label: "2x1 Grid" },
  "2x2": { cols: 2, rows: 2, label: "2x2 Grid" },
  "3x2": { cols: 3, rows: 2, label: "3x2 Grid" },
  "3x3": { cols: 3, rows: 3, label: "3x3 Grid" },
};

function resolvePreset(agentCount: number, preset: GridPreset) {
  if (preset !== "auto") return GRID_PRESETS[preset];
  if (agentCount <= 1) return GRID_PRESETS["1x1"];
  if (agentCount <= 2) return GRID_PRESETS["2x1"];
  if (agentCount <= 4) return GRID_PRESETS["2x2"];
  if (agentCount <= 6) return GRID_PRESETS["3x2"];
  return GRID_PRESETS["3x3"];
}

function getProviderLabel(agent: Agent) {
  return agent.provider === "custom"
    ? agent.customDisplayName || "Custom CLI"
    : agent.provider;
}

type StartDialogState =
  | { mode: "single"; agent: Agent }
  | { mode: "all" };

function AgentTerminalPanel({
  agent,
  isSelected,
  onSelect,
  onStart,
  onStop,
  onDelete,
}: {
  agent: Agent;
  isSelected: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const providerLabel = getProviderLabel(agent);
  const canStart = agent.status === "idle" || agent.status === "completed" || agent.status === "error";
  const canStop = agent.status === "running" || agent.status === "waiting";

  return (
    <section
      onClick={onSelect}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl ring-1 transition-all",
        isSelected ? "ring-ring/50 shadow-lg" : "ring-border"
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-card px-2 py-1.5 md:px-3 md:py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 md:block">
          <div className="flex items-center gap-1.5 md:gap-2">
            <span className="truncate text-xs font-medium md:text-sm">
              {agent.name || `Agent ${agent.id.slice(0, 8)}`}
            </span>
            <StatusDot status={agent.status} className="md:hidden" />
            <span className="hidden md:inline-flex"><StatusBadge status={agent.status} /></span>
          </div>
          <div className="hidden flex-wrap items-center gap-1.5 md:mt-1 md:flex">
            <Badge variant="secondary" className="text-[10px]">
              {providerLabel}
            </Badge>
            {agent.model && (
              <Badge variant="outline" className="text-[10px]">
                {agent.model}
              </Badge>
            )}
            <Badge variant="outline" className="max-w-full truncate text-[10px]">
              {agent.project?.name || agent.projectPath}
            </Badge>
          </div>
          {/* Mobile inline badges */}
          <div className="flex items-center gap-1 md:hidden">
            {agent.model && (
              <Badge variant="outline" className="text-[9px] px-1 py-0">
                {agent.model}
              </Badge>
            )}
            <Badge variant="outline" className="max-w-[120px] truncate text-[9px] px-1 py-0">
              {agent.project?.name || agent.projectPath}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canStart && (
            <Button
              size="xs"
              variant="default"
              onClick={(e) => { e.stopPropagation(); onStart(); }}
            >
              <PlayIcon data-icon="inline-start" />
              Start
            </Button>
          )}
          {canStop && (
            <Button
              size="xs"
              variant="secondary"
              onClick={(e) => { e.stopPropagation(); onStop(); }}
            >
              <SquareIcon data-icon="inline-start" />
              Stop
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2Icon />
            <span className="sr-only">Delete agent</span>
          </Button>
        </div>
      </div>

      {(agent.error || agent.currentTask) && (
        <div className="border-b bg-card/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          {agent.error ? (
            <Alert variant="destructive" className="px-2 py-1.5 text-[11px]">
              <TriangleAlertIcon />
              <AlertTitle>Agent error</AlertTitle>
              <AlertDescription>{agent.error}</AlertDescription>
            </Alert>
          ) : (
            <span className="block truncate">{agent.currentTask}</span>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 bg-background">
        <Terminal agentId={agent.id} isActive={isSelected} />
      </div>
    </section>
  );
}

function AgentPanel() {
  const agents = useStore((s) => s.agents);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const selectAgent = useStore((s) => s.selectAgent);
  const updateAgent = useStore((s) => s.updateAgent);
  const removeAgent = useStore((s) => s.removeAgent);
  const [showNew, setShowNew] = useState(false);
  const [gridPreset, setGridPreset] = useState<GridPreset>("auto");
  const [projectFilterId, setProjectFilterId] = useState("all");
  const [isMobile, setIsMobile] = useState(false);
  const [pendingDeleteAgent, setPendingDeleteAgent] = useState<Agent | null>(null);
  const [startDialog, setStartDialog] = useState<StartDialogState | null>(null);
  const [startPrompt, setStartPrompt] = useState("");
  const [startError, setStartError] = useState("");
  const [startingAgents, setStartingAgents] = useState(false);

  const uniqueProjects = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const agent of agents) {
      if (agent.projectId && !seen.has(agent.projectId)) {
        seen.set(agent.projectId, {
          id: agent.projectId,
          name: agent.project?.name || agent.projectPath,
        });
      }
    }
    return Array.from(seen.values());
  }, [agents]);

  const effectiveProjectFilterId =
    projectFilterId !== "all" && !uniqueProjects.some((p) => p.id === projectFilterId)
      ? "all"
      : projectFilterId;

  const visibleAgents = useMemo(() => {
    if (effectiveProjectFilterId === "all") return agents;
    return agents.filter((agent) => agent.projectId === effectiveProjectFilterId);
  }, [effectiveProjectFilterId, agents]);

  const layout = useMemo(
    () => resolvePreset(visibleAgents.length, gridPreset),
    [gridPreset, visibleAgents.length]
  );
  const startableAgents = useMemo(
    () =>
      visibleAgents.filter(
        (agent) =>
          agent.status === "idle" ||
          agent.status === "completed" ||
          agent.status === "error"
      ),
    [visibleAgents]
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (visibleAgents.length === 0) {
      if (selectedAgentId !== null) selectAgent(null);
      return;
    }
    if (!selectedAgentId || !visibleAgents.some((a) => a.id === selectedAgentId)) {
      selectAgent(visibleAgents[0].id);
    }
  }, [visibleAgents, selectedAgentId, selectAgent]);

  const openStartDialog = useCallback((dialog: StartDialogState) => {
    setStartDialog(dialog);
    setStartPrompt(dialog.mode === "single" ? dialog.agent.currentTask?.trim() || "" : "");
    setStartError("");
  }, []);

  const handleStartAgent = useCallback(async () => {
    if (!startDialog) return;
    const normalizedPrompt = startPrompt.trim();
    setStartingAgents(true);
    setStartError("");

    try {
      if (startDialog.mode === "single") {
        await api.startAgent(startDialog.agent.id, normalizedPrompt);
        updateAgent(startDialog.agent.id, {
          status: "running",
          currentTask: normalizedPrompt || null,
          error: null,
        });
      } else {
        const results = await Promise.allSettled(
          startableAgents.map((agent) => api.startAgent(agent.id, normalizedPrompt))
        );

        startableAgents.forEach((agent, index) => {
          if (results[index]?.status === "fulfilled") {
            updateAgent(agent.id, {
              status: "running",
              currentTask: normalizedPrompt || null,
              error: null,
            });
          }
        });

        const failedCount = results.filter((result) => result.status === "rejected").length;
        if (failedCount > 0) {
          setStartError(`Failed to start ${failedCount} agent(s).`);
          return;
        }
      }

      setStartDialog(null);
      setStartPrompt("");
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start agent");
    } finally {
      setStartingAgents(false);
    }
  }, [startDialog, startPrompt, startableAgents, updateAgent]);

  const handleStopAgent = useCallback(async (agentId: string) => {
    try {
      await api.stopAgent(agentId);
      updateAgent(agentId, { status: "idle" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop agent");
    }
  }, [updateAgent]);

  const handleDeleteAgent = useCallback(async () => {
    if (!pendingDeleteAgent) return;
    try {
      await api.deleteAgent(pendingDeleteAgent.id);
      removeAgent(pendingDeleteAgent.id);
      setPendingDeleteAgent(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete agent");
    }
  }, [pendingDeleteAgent, removeAgent]);

  const handleStopAll = useCallback(async () => {
    const stoppable = visibleAgents.filter(
      (a) => a.status === "running" || a.status === "waiting"
    );
    const results = await Promise.allSettled(stoppable.map((a) => api.stopAgent(a.id)));
    stoppable.forEach((a, i) => {
      if (results[i]?.status === "fulfilled") updateAgent(a.id, { status: "idle" });
    });
    const failedCount = results.filter((r) => r.status === "rejected").length;
    if (failedCount > 0) {
      toast.error(`Failed to stop ${failedCount} agent(s).`);
    }
  }, [updateAgent, visibleAgents]);

  const runningCount = visibleAgents.filter(
    (a) => a.status === "running" || a.status === "waiting"
  ).length;
  const gridColumns = isMobile ? 1 : layout.cols;
  const panelMinHeight = isMobile ? 320 : 300;

  const selectedIndex = visibleAgents.findIndex((a) => a.id === selectedAgentId);
  const selectedAgent = selectedIndex >= 0 ? visibleAgents[selectedIndex] : null;

  const navigateAgent = useCallback((dir: -1 | 1) => {
    if (visibleAgents.length === 0) return;
    const next = (selectedIndex + dir + visibleAgents.length) % visibleAgents.length;
    selectAgent(visibleAgents[next].id);
  }, [selectedIndex, visibleAgents, selectAgent]);

  return (
    <div className="flex flex-1 h-full min-h-0 flex-col overflow-hidden">


      {/* Toolbar */}
      <div className="border-b bg-background h-auto md:h-16 sticky top-0 flex shrink-0 items-center gap-2 px-2 py-2 md:px-4 md:py-3">
        <div className="flex flex-1 items-center gap-2 overflow-x-auto md:flex-wrap md:justify-between">
          <SidebarTrigger className="-ml-1" />
          <SidebarSeparator orientation="vertical" className="mx-0 md:mr-2" />
          <div className="hidden md:contents">
            <Select
              value={gridPreset}
              onValueChange={(value) => setGridPreset((value as GridPreset) ?? "auto")}
            >
              <SelectTrigger className="min-w-36" size="sm">
                <SelectValue placeholder="Select a layout" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="auto">Auto Layout</SelectItem>
                  <SelectItem value="1x1">1x1 Grid</SelectItem>
                  <SelectItem value="2x1">2x1 Grid</SelectItem>
                  <SelectItem value="2x2">2x2 Grid</SelectItem>
                  <SelectItem value="3x2">3x2 Grid</SelectItem>
                  <SelectItem value="3x3">3x3 Grid</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Select
            value={effectiveProjectFilterId}
            onValueChange={(value) => setProjectFilterId(String(value ?? "all"))}
          >
            <SelectTrigger size="sm" className="max-w-32 truncate md:min-w-44 md:max-w-none">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All projects</SelectItem>
                {uniqueProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {isMobile && visibleAgents.length > 1 && (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => navigateAgent(-1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => navigateAgent(1)}
              >
                <ChevronRightIcon />
              </Button>
            </>
          )}
          <div className="flex-1 md:hidden" />
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => openStartDialog({ mode: "all" })}
            disabled={startableAgents.length === 0}
          >
            <PlayIcon />
            <span className="hidden md:inline">Start All</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleStopAll}
            disabled={runningCount === 0}
          >
            <SquareIcon />
            <span className="hidden md:inline">Stop All</span>
          </Button>
          <p className="hidden text-xs font-medium md:block">
            {visibleAgents.length} agents · {runningCount} running
          </p>
          <Button size="sm" className="ml-auto shrink-0" onClick={() => setShowNew(true)}>
            <PlusIcon />
            <span className="hidden md:inline">New Agent</span>
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-0 md:overflow-auto md:p-3">
        {visibleAgents.length === 0 ? (
          <Empty className="h-full min-h-[320px] border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>No agents</EmptyTitle>
              <EmptyDescription>
                {effectiveProjectFilterId === "all"
                  ? "Create an agent to start working."
                  : "No agents in the selected project."}
              </EmptyDescription>
            </EmptyHeader>
            {effectiveProjectFilterId === "all" && (
              <Button size="sm" onClick={() => setShowNew(true)}>
                <PlusIcon data-icon="inline-start" />
                New Agent
              </Button>
            )}
          </Empty>
        ) : isMobile && selectedAgent ? (
          <div className="flex flex-1 min-h-0 flex-col">
            <AgentTerminalPanel
              agent={selectedAgent}
              isSelected
              onSelect={() => { }}
              onStart={() => openStartDialog({ mode: "single", agent: selectedAgent })}
              onStop={() => handleStopAgent(selectedAgent.id)}
              onDelete={() => setPendingDeleteAgent(selectedAgent)}
            />
          </div>
        ) : (
          <div
            className="grid h-full min-h-full gap-3"
            style={{
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gridAutoRows: `minmax(${panelMinHeight}px, 1fr)`,
            }}
          >
            {visibleAgents.map((agent) => (
              <AgentTerminalPanel
                key={agent.id}
                agent={agent}
                isSelected={selectedAgentId === agent.id}
                onSelect={() => selectAgent(agent.id)}
                onStart={() => openStartDialog({ mode: "single", agent })}
                onStop={() => handleStopAgent(agent.id)}
                onDelete={() => setPendingDeleteAgent(agent)}
              />
            ))}
          </div>
        )}
      </div>

      <NewAgentDialog open={showNew} onClose={() => setShowNew(false)} />
      <Dialog
        open={startDialog !== null}
        onOpenChange={(open) => {
          if (!open && !startingAgents) {
            setStartDialog(null);
            setStartError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {startDialog?.mode === "single" ? "Start agent" : "Start all agents"}
            </DialogTitle>
            <DialogDescription>
              {startDialog?.mode === "single"
                ? "Leave the prompt blank to start a clean session for this agent."
                : `Provide an optional prompt to start ${startableAgents.length} agent(s) with the same context.`}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleStartAgent();
            }}
            className="flex flex-col gap-4"
          >
            {startError && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Could not start agent</AlertTitle>
                <AlertDescription>{startError}</AlertDescription>
              </Alert>
            )}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="agent-start-prompt">Prompt</FieldLabel>
                <Textarea
                  id="agent-start-prompt"
                  value={startPrompt}
                  onChange={(event) => setStartPrompt(event.target.value)}
                  placeholder="Optional instructions for the agent session"
                  rows={6}
                />
                <FieldDescription>
                  Reuse the current task, refine it, or leave this blank to start fresh.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={startingAgents}
                onClick={() => {
                  setStartDialog(null);
                  setStartError("");
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={startingAgents}>
                {startingAgents ? "Starting..." : "Start"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pendingDeleteAgent !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteAgent(null);
        }}
        title="Delete agent?"
        description={`This permanently removes ${pendingDeleteAgent?.name || pendingDeleteAgent?.id || "this agent"
          } from Maestro.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteAgent}
      />
    </div>
  );
}

export default function AgentsPage() {
  return (
    <AppShell>
      <main className="flex min-h-0 flex-1">
        <AgentPanel />
      </main>
    </AppShell>
  );
}
