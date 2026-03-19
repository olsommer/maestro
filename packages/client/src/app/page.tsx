"use client";

import { BotIcon, Clock3Icon, TriangleAlertIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useStore } from "@/lib/store";

function Dashboard() {
  const agents = useStore((s) => s.agents);
  const projects = useStore((s) => s.projects);
  const running = agents.filter((a) => a.status === "running").length;
  const completed = agents.filter((a) => a.status === "completed").length;
  const errored = agents.filter((a) => a.status === "error").length;
  const idle = agents.filter((a) => a.status === "idle").length;

  const stats = [
    {
      label: "Projects",
      value: projects.length,
      description: "Tracked workspaces",
    },
    {
      label: "Total Terminals",
      value: agents.length,
      description: "Available workers",
    },
    {
      label: "Running",
      value: running,
      description: "Active sessions",
    },
    {
      label: "Completed",
      value: completed,
      description: "Finished runs",
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold sm:text-2xl">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Overview of projects and agent activity across Maestro.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardTitle>{stat.label}</CardTitle>
              <CardDescription>{stat.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tracking-tight">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {errored > 0 && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>
              {errored} agent{errored === 1 ? "" : "s"} need attention
            </AlertTitle>
            <AlertDescription>
              Open the Terminals view to inspect failures and restart affected sessions.
            </AlertDescription>
          </Alert>
        )}

        {idle > 0 && (
          <Alert>
            <Clock3Icon />
            <AlertTitle>
              {idle} agent{idle === 1 ? "" : "s"} currently idle
            </AlertTitle>
            <AlertDescription>
              Idle agents are ready for a new prompt or task assignment.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {agents.length === 0 && (
        <Empty className="min-h-[18rem] border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>No agents yet</EmptyTitle>
            <EmptyDescription>
              Go to the Terminals page to create your first coding agent.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <AppShell>
      <main className="flex-1 overflow-auto">
        <Dashboard />
      </main>
    </AppShell>
  );
}
