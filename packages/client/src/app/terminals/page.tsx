"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Terminal } from "@/components/Terminal";
import { NewTerminalDialog } from "@/components/NewTerminalDialog";
import { StatusBadge, StatusDot } from "@/components/StatusBadge";
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
import { api, type Agent as TerminalRecord } from "@/lib/api";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import {
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  Trash2Icon,
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

function getProviderLabel(terminal: TerminalRecord) {
  if (terminal.provider === "none") {
    return "None";
  }
  return terminal.provider === "custom"
    ? terminal.customDisplayName || "Custom CLI"
    : terminal.provider;
}

function useMobileKeyboard() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const threshold = 100;
    const check = () => setOpen(window.innerHeight - vv.height > threshold);
    check();
    vv.addEventListener("resize", check);
    return () => vv.removeEventListener("resize", check);
  }, []);

  return open;
}

function TerminalPanel({
  terminal,
  isSelected,
  onSelect,
  onReconnect,
  onDelete,
  mobileKeyboardOpen,
}: {
  terminal: TerminalRecord;
  isSelected: boolean;
  onSelect: () => void;
  onReconnect: () => void;
  onDelete: () => void;
  mobileKeyboardOpen?: boolean;
}) {
  const providerLabel = getProviderLabel(terminal);
  const canReconnect =
    terminal.status === "idle" ||
    terminal.status === "completed" ||
    terminal.status === "error";

  return (
    <section
      onClick={onSelect}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl ring-1 transition-all",
        isSelected ? "ring-ring/50 shadow-lg" : "ring-border"
      )}
    >
      {!mobileKeyboardOpen && (
        <div className="flex items-center justify-between gap-2 border-b bg-card px-2 py-1.5 md:px-3 md:py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 md:block">
            <div className="flex items-center gap-1.5 md:gap-2">
              <span className="truncate text-xs font-medium md:text-sm">
                {terminal.name || `Terminal ${terminal.id.slice(0, 8)}`}
              </span>
              <StatusDot status={terminal.status} className="md:hidden" />
              <span className="hidden md:inline-flex">
                <StatusBadge status={terminal.status} />
              </span>
            </div>
            <div className="hidden flex-wrap items-center gap-1.5 md:mt-1 md:flex">
              <Badge variant="secondary" className="text-[10px]">
                {providerLabel}
              </Badge>
              {terminal.model && (
                <Badge variant="outline" className="text-[10px]">
                  {terminal.model}
                </Badge>
              )}
              <Badge variant="outline" className="max-w-full truncate text-[10px]">
                {terminal.project?.name || terminal.projectPath}
              </Badge>
            </div>
            <div className="flex items-center gap-1 md:hidden">
              {terminal.model && (
                <Badge variant="outline" className="px-1 py-0 text-[9px]">
                  {terminal.model}
                </Badge>
              )}
              <Badge variant="outline" className="max-w-[120px] truncate px-1 py-0 text-[9px]">
                {terminal.project?.name || terminal.projectPath}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canReconnect && (
              <Button
                size="xs"
                variant="default"
                onClick={(event) => {
                  event.stopPropagation();
                  onReconnect();
                }}
              >
                <RotateCcwIcon data-icon="inline-start" />
                Reconnect
              </Button>
            )}
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
      )}

      {terminal.error && !mobileKeyboardOpen && (
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

      <div className="min-h-0 flex-1 bg-background">
        <Terminal key={terminal.id} terminalId={terminal.id} isActive={isSelected} />
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
  const [isMobile, setIsMobile] = useState(false);
  const [pendingDeleteTerminal, setPendingDeleteTerminal] =
    useState<TerminalRecord | null>(null);
  const mobileKeyboardOpen = useMobileKeyboard();

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
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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

  const handleReconnectTerminal = useCallback(
    async (terminalId: string) => {
      try {
        await api.startTerminal(terminalId);
        updateTerminal(terminalId, {
          status: "running",
          currentTask: null,
          error: null,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to reconnect terminal");
      }
    },
    [updateTerminal]
  );

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

  const navigateTerminal = useCallback(
    (dir: -1 | 1) => {
      if (visibleTerminals.length === 0) return;
      const next = (selectedIndex + dir + visibleTerminals.length) % visibleTerminals.length;
      selectTerminal(visibleTerminals[next].id);
    },
    [selectedIndex, visibleTerminals, selectTerminal]
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden overscroll-none">
      <div
        className={cn(
          "sticky top-0 flex h-auto shrink-0 items-center gap-2 border-b bg-background px-2 py-2 md:h-16 md:px-4 md:py-3",
          mobileKeyboardOpen && "hidden md:flex"
        )}
      >
        <div className="flex flex-1 items-center gap-2 overflow-x-auto md:flex-wrap md:justify-between">
          <SidebarTrigger className="-ml-1 md:hidden" />
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
        ) : isMobile && selectedTerminal ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <TerminalPanel
              key={selectedTerminal.id}
              terminal={selectedTerminal}
              isSelected
              onSelect={() => {}}
              onReconnect={() => handleReconnectTerminal(selectedTerminal.id)}
              onDelete={() => setPendingDeleteTerminal(selectedTerminal)}
              mobileKeyboardOpen={mobileKeyboardOpen}
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
            {visibleTerminals.map((terminal) => (
              <TerminalPanel
                key={terminal.id}
                terminal={terminal}
                isSelected={selectedTerminalId === terminal.id}
                onSelect={() => selectTerminal(terminal.id)}
                onReconnect={() => handleReconnectTerminal(terminal.id)}
                onDelete={() => setPendingDeleteTerminal(terminal)}
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
