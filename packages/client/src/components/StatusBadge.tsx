"use client";

import type { TerminalStartupStatus } from "@maestro/wire";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<
  string,
  {
    badgeClassName: string;
    dotClassName: string;
    standaloneDotClassName: string;
    label: string;
  }
> = {
  idle: {
    badgeClassName: "bg-muted text-muted-foreground",
    dotClassName: "bg-current",
    standaloneDotClassName: "bg-muted-foreground",
    label: "Idle",
  },
  running: {
    badgeClassName: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
    dotClassName: "animate-pulse bg-current",
    standaloneDotClassName: "animate-pulse bg-emerald-400",
    label: "Running",
  },
  waiting: {
    badgeClassName: "border-amber-500/30 bg-amber-500/15 text-amber-400",
    dotClassName: "animate-pulse bg-current",
    standaloneDotClassName: "animate-pulse bg-amber-400",
    label: "Waiting",
  },
  completed: {
    badgeClassName: "border-blue-500/30 bg-blue-500/15 text-blue-400",
    dotClassName: "bg-current",
    standaloneDotClassName: "bg-blue-400",
    label: "Completed",
  },
  error: {
    badgeClassName: "border-destructive/30 bg-destructive/15 text-destructive",
    dotClassName: "bg-current",
    standaloneDotClassName: "bg-destructive",
    label: "Error",
  },
};

export function StatusBadge({
  status,
  startupStatus,
}: {
  status: string;
  startupStatus?: TerminalStartupStatus | null;
}) {
  const config = statusConfig[status] || statusConfig.idle;
  const label =
    startupStatus && status === "waiting"
      ? `${startupStatus.label} ${startupStatus.step}/${startupStatus.totalSteps}`
      : config.label;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 text-[11px]", config.badgeClassName)}
    >
      <span className={cn("size-1.5 rounded-full", config.dotClassName)} />
      {label}
    </Badge>
  );
}

export function StatusDot({
  status,
  className,
  startupStatus,
}: {
  status: string;
  className?: string;
  startupStatus?: TerminalStartupStatus | null;
}) {
  const config = statusConfig[status] || statusConfig.idle;
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", config.standaloneDotClassName, className)}
      title={
        startupStatus && status === "waiting"
          ? `${startupStatus.label} ${startupStatus.step}/${startupStatus.totalSteps}`
          : config.label
      }
    />
  );
}
