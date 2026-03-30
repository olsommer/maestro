"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Terminal } from "@/components/Terminal";
import { NewTerminalDialog } from "@/components/NewTerminalDialog";
import { StatusDot } from "@/components/StatusBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type Agent as TerminalRecord } from "@/lib/api";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import {
  AlignHorizontalSpaceAroundIcon,
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitBranchIcon,
  HistoryIcon,
  PlusIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  Trash2Icon,
  VaultIcon,
} from "lucide-react";

type GridPreset = "auto" | "1x1" | "2x1" | "2x2" | "3x2" | "3x3";

const GRID_PRESETS: Record<
  Exclude<GridPreset, "auto">,
  { cols: number; rows: number; label: string }
> = {
  "1x1": { cols: 1, rows: 1, label: "1x1 Grid" },
  "2x1": { cols: 2, rows: 1, label: "2x1 Grid" },
  "2x2": { cols: 2, rows: 2, label: "2x2 Grid" },
  "3x2": { cols: 3, rows: 2, label: "3x2 Grid" },
  "3x3": { cols: 3, rows: 3, label: "3x3 Grid" },
};

function resolvePreset(terminalCount: number, preset: GridPreset) {
  if (preset !== "auto") return GRID_PRESETS[preset];
  if (terminalCount <= 1) return GRID_PRESETS["1x1"];
  if (terminalCount <= 2) return GRID_PRESETS["2x1"];
  if (terminalCount <= 4) return GRID_PRESETS["2x2"];
  if (terminalCount <= 6) return GRID_PRESETS["3x2"];
  return GRID_PRESETS["3x3"];
}

function getSandboxBadge(terminal: TerminalRecord) {
  const sandboxEnabled =
    !terminal.disableSandbox &&
    terminal.sandboxProvider != null &&
    terminal.sandboxProvider !== "none";

  return {
    label: sandboxEnabled ? "Sandbox" : "No Sandbox",
    title: sandboxEnabled
      ? `Sandbox: ${terminal.sandboxProvider}`
      : "Sandbox disabled",
    className: sandboxEnabled
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : "text-muted-foreground",
  };
}

function getWorktreeBadge(terminal: TerminalRecord) {
  if (terminal.worktreePath) {
    return {
      label: "Worktree",
      title: terminal.worktreePath,
      className: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    };
  }

  if (terminal.autoWorktree) {
    return {
      label: "Worktree Pending",
      title: "Auto worktree will be created on start",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    };
  }

  return {
    label: "Project Tree",
    title: terminal.projectPath,
    className: "text-muted-foreground",
  };
}

function TerminalPanel({
  terminal,
  isSelected,
  onSelect,
  onDelete,
  onSwipeNavigate,
  onRegisterRefit,
  onRefit,
}: {
  terminal: TerminalRecord;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onSwipeNavigate?: (dir: -1 | 1) => void;
  onRegisterRefit?: (terminalId: string, refit: () => void) => void;
  onRefit?: () => void;
}) {
  const recentInputs = terminal.recentInputs ?? [];
  const sandboxBadge = getSandboxBadge(terminal);
  const worktreeBadge = getWorktreeBadge(terminal);

  return (
    <section
      onClick={onSelect}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl ring-1 transition-all",
        isSelected ? "ring-ring/50 shadow-lg" : "ring-border"
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-card px-2 py-1.5 md:px-3 md:py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 md:gap-2">
          <span className="truncate text-xs font-medium md:text-sm">
            #{terminal.id.slice(0, 8)}
          </span>
          <StatusDot
            status={terminal.status}
            startupStatus={terminal.startupStatus}
          />
          <Badge
            variant="outline"
            className="max-w-[120px] truncate px-1 py-0 text-[9px] md:max-w-[220px] md:px-2 md:py-0.5 md:text-[10px]"
            title={terminal.project?.name || terminal.projectPath}
          >
            {terminal.project?.name || terminal.projectPath}
          </Badge>
          <Badge
            variant="outline"
            title={sandboxBadge.title}
            className={cn(
              "hidden shrink-0 items-center gap-1 px-1 py-0 text-[9px] md:inline-flex md:px-2 md:py-0.5 md:text-[10px]",
              sandboxBadge.className
            )}
          >
            <VaultIcon className="size-3" />
            <span>{sandboxBadge.label}</span>
          </Badge>
          <Badge
            variant="outline"
            title={worktreeBadge.title}
            className={cn(
              "hidden shrink-0 items-center gap-1 px-1 py-0 text-[9px] md:inline-flex md:px-2 md:py-0.5 md:text-[10px]",
              worktreeBadge.className
            )}
          >
            <GitBranchIcon className="size-3" />
            <span>{worktreeBadge.label}</span>
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  onClick={(event) => event.stopPropagation()}
                />
              }
            >
              <HistoryIcon />
              <span className="sr-only">Show recent terminal commands</span>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="flex max-h-[min(26rem,calc(100vh-4rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl p-0"
            >
              <div className="border-b px-3 py-2.5">
                <PopoverTitle>Recent Commands</PopoverTitle>
                <PopoverDescription className="mt-1">
                  Last submitted inputs sent to this terminal.
                </PopoverDescription>
              </div>
              <div className="flex min-h-0 flex-1 flex-col px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  <span>Command history</span>
                  <span>{recentInputs.length}/10</span>
                </div>
                {recentInputs.length > 0 ? (
                  <ScrollArea className="min-h-0 flex-1 pr-3">
                    <div className="space-y-2">
                      {[...recentInputs].reverse().map((input, index) => (
                        <div
                          key={`${index}-${input}`}
                          className="rounded-lg border bg-muted/40 px-2.5 py-2"
                        >
                          <p className="mb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                            {index === 0 ? "Latest" : `Earlier ${index + 1}`}
                          </p>
                          <code className="block whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
                            {input}
                          </code>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No commands captured for this terminal yet.
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size="icon-xs"
            variant="outline"
            className="hidden md:inline-flex"
            onClick={(event) => {
              event.stopPropagation();
              onRefit?.();
            }}
            title="Refit terminal to panel"
          >
            <AlignHorizontalSpaceAroundIcon />
            <span className="sr-only">Refit terminal to panel</span>
          </Button>
          <Button
            size="icon-xs"
            variant="destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2Icon />
            <span className="sr-only">Delete terminal</span>
          </Button>
        </div>
      </div>

      {terminal.error && (
        <div className="border-b bg-card/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          <Alert variant="destructive" className="px-2 py-1.5 text-[11px]">
            <TriangleAlertIcon />
            <AlertTitle>Terminal error</AlertTitle>
            <AlertDescription>{terminal.error}</AlertDescription>
          </Alert>
        </div>
      )}
      {terminal.currentTask && !terminal.error && (
        <div className="hidden border-b bg-card/50 px-3 py-1.5 text-[11px] text-muted-foreground md:block">
          <span className="block truncate">{terminal.currentTask}</span>
        </div>
      )}
      {terminal.startupStatus && !terminal.error && (
        <div className="border-b bg-amber-500/5 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="block truncate">
            {terminal.startupStatus.label} ({terminal.startupStatus.step}/
            {terminal.startupStatus.totalSteps})
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 bg-background">
        <Terminal
          key={terminal.id}
          terminalId={terminal.id}
          isActive={isSelected}
          onSwipeNavigate={onSwipeNavigate}
          registerRefit={
            onRegisterRefit
              ? (refit) => onRegisterRefit(terminal.id, refit)
              : undefined
          }
        />
      </div>
    </section>
  );
}

function TerminalPagePanel() {
  const terminals = useStore((s) => s.agents);
  const selectedTerminalId = useStore((s) => s.selectedAgentId);
  const selectTerminal = useStore((s) => s.selectAgent);
  const updateTerminal = useStore((s) => s.updateAgent);
  const removeTerminal = useStore((s) => s.removeAgent);
  const [showNew, setShowNew] = useState(false);
  const [gridPreset, setGridPreset] = useState<GridPreset>("auto");
  const [projectFilterId, setProjectFilterId] = useState("all");
  const isMobile = useIsMobile();
  const [refitHandlers, setRefitHandlers] = useState<Record<string, () => void>>({});
  const [pendingDeleteTerminal, setPendingDeleteTerminal] =
    useState<TerminalRecord | null>(null);

  const uniqueProjects = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const terminal of terminals) {
      if (terminal.projectId && !seen.has(terminal.projectId)) {
        seen.set(terminal.projectId, {
          id: terminal.projectId,
          name: terminal.project?.name || terminal.projectPath,
        });
      }
    }
    return Array.from(seen.values());
  }, [terminals]);

  const effectiveProjectFilterId =
    projectFilterId !== "all" && !uniqueProjects.some((p) => p.id === projectFilterId)
      ? "all"
      : projectFilterId;

  const visibleTerminals = useMemo(() => {
    if (effectiveProjectFilterId === "all") return terminals;
    return terminals.filter((terminal) => terminal.projectId === effectiveProjectFilterId);
  }, [effectiveProjectFilterId, terminals]);

  const layout = useMemo(
    () => resolvePreset(visibleTerminals.length, gridPreset),
    [gridPreset, visibleTerminals.length]
  );
  const reconnectableTerminals = useMemo(
    () =>
      visibleTerminals.filter(
        (terminal) =>
          terminal.status === "idle" ||
          terminal.status === "completed" ||
          terminal.status === "error"
      ),
    [visibleTerminals]
  );

  useEffect(() => {
    if (visibleTerminals.length === 0) {
      if (selectedTerminalId !== null) selectTerminal(null);
      return;
    }
    if (
      !selectedTerminalId ||
      !visibleTerminals.some((terminal) => terminal.id === selectedTerminalId)
    ) {
      selectTerminal(visibleTerminals[0].id);
    }
  }, [visibleTerminals, selectedTerminalId, selectTerminal]);

  const handleDeleteTerminal = useCallback(async () => {
    if (!pendingDeleteTerminal) return;
    try {
      await api.deleteTerminal(pendingDeleteTerminal.id);
      removeTerminal(pendingDeleteTerminal.id);
      setPendingDeleteTerminal(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete terminal");
    }
  }, [pendingDeleteTerminal, removeTerminal]);

  const handleReconnectAll = useCallback(async () => {
    const results = await Promise.allSettled(
      reconnectableTerminals.map((terminal) => api.startTerminal(terminal.id))
    );
    reconnectableTerminals.forEach((terminal, index) => {
      if (results[index]?.status === "fulfilled") {
        updateTerminal(terminal.id, {
          status: "running",
          currentTask: null,
          error: null,
        });
      }
    });
    const failedCount = results.filter((result) => result.status === "rejected").length;
    if (failedCount > 0) {
      toast.error(`Failed to reconnect ${failedCount} terminal(s).`);
    }
  }, [reconnectableTerminals, updateTerminal]);

  const runningCount = visibleTerminals.filter(
    (terminal) => terminal.status === "running" || terminal.status === "waiting"
  ).length;
  const gridColumns = isMobile ? 1 : layout.cols;
  const panelMinHeight = isMobile ? 320 : 300;

  const selectedIndex = visibleTerminals.findIndex(
    (terminal) => terminal.id === selectedTerminalId
  );
  const selectedTerminal =
    selectedIndex >= 0 ? visibleTerminals[selectedIndex] : null;
  const renderedTerminals =
    isMobile && selectedTerminal ? [selectedTerminal] : visibleTerminals;

  const navigateTerminal = useCallback(
    (dir: -1 | 1) => {
      if (visibleTerminals.length === 0) return;
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const next = (selectedIndex + dir + visibleTerminals.length) % visibleTerminals.length;
      selectTerminal(visibleTerminals[next].id);
    },
    [selectedIndex, visibleTerminals, selectTerminal]
  );

  const registerRefitHandler = useCallback((terminalId: string, refit: () => void) => {
    setRefitHandlers((current) => {
      if (current[terminalId] === refit) {
        return current;
      }
      return {
        ...current,
        [terminalId]: refit,
      };
    });
  }, []);

  const handleRefitTerminal = useCallback((terminalId: string) => {
    refitHandlers[terminalId]?.();
  }, [refitHandlers]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden overscroll-none">
      <div className="sticky top-0 flex h-auto shrink-0 items-center gap-2 border-b bg-background px-2 py-2 md:h-auto md:px-3 md:py-3">
        <div className="flex flex-1 items-center gap-2 overflow-x-auto md:flex-wrap md:justify-between">
          <SidebarTrigger className="-ml-1" />
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
                {uniqueProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {isMobile && visibleTerminals.length > 1 && (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => navigateTerminal(-1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className="shrink-0"
                onClick={() => navigateTerminal(1)}
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
            onClick={handleReconnectAll}
            disabled={reconnectableTerminals.length === 0}
          >
            <RotateCcwIcon />
            <span className="hidden md:inline">Reconnect Offline</span>
          </Button>
          <p className="hidden text-xs font-medium md:block">
            {visibleTerminals.length} terminals · {runningCount} running
          </p>
          <Button size="sm" className="ml-auto shrink-0" onClick={() => setShowNew(true)}>
            <PlusIcon />
            <span className="hidden md:inline">New Terminal</span>
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 md:overflow-auto md:p-3">
        {visibleTerminals.length === 0 ? (
          <Empty className="h-full min-h-[320px] border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>No terminals</EmptyTitle>
              <EmptyDescription>
                {effectiveProjectFilterId === "all"
                  ? "Create a terminal to start working."
                  : "No terminals in the selected project."}
              </EmptyDescription>
            </EmptyHeader>
            {effectiveProjectFilterId === "all" && (
              <Button size="sm" onClick={() => setShowNew(true)}>
                <PlusIcon data-icon="inline-start" />
                New Terminal
              </Button>
            )}
          </Empty>
        ) : (
          <div
            className="grid h-full min-h-full gap-3"
            style={{
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gridAutoRows: `minmax(${panelMinHeight}px, 1fr)`,
            }}
          >
            {renderedTerminals.map((terminal) => (
              <TerminalPanel
                key={terminal.id}
                terminal={terminal}
                isSelected={selectedTerminalId === terminal.id}
                onSelect={() => selectTerminal(terminal.id)}
                onDelete={() => setPendingDeleteTerminal(terminal)}
                onSwipeNavigate={isMobile ? navigateTerminal : undefined}
                onRegisterRefit={registerRefitHandler}
                onRefit={() => handleRefitTerminal(terminal.id)}
              />
            ))}
          </div>
        )}
      </div>

      <NewTerminalDialog open={showNew} onClose={() => setShowNew(false)} />
      <ConfirmDialog
        open={pendingDeleteTerminal !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteTerminal(null);
        }}
        title="Delete terminal?"
        description={`This permanently removes ${
          pendingDeleteTerminal?.name || pendingDeleteTerminal?.id || "this terminal"
        } from Maestro.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteTerminal}
      />
    </div>
  );
}

export default function TerminalsPage() {
  return (
    <AppShell hideMobileHeader>
      <main className="flex min-h-0 flex-1">
        <TerminalPagePanel />
      </main>
    </AppShell>
  );
}
