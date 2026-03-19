"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { KanbanBoard } from "@/components/KanbanBoard";
import { NewTaskDialog } from "@/components/NewTaskDialog";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";

function KanbanPage() {
  const [showNew, setShowNew] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-col gap-3 px-4 pb-2 pt-4 sm:px-6 sm:pt-6 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-xl font-bold sm:text-2xl">Kanban Board</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag tasks to &quot;Planned&quot; to auto-spawn terminals from your default settings
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <PlusIcon className="size-3.5" />
          New Task
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <KanbanBoard key={refreshKey} onNewTask={() => setShowNew(true)} />
      </div>
      <NewTaskDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

export default function Page() {
  return (
    <AppShell>
      <main className="flex min-h-0 flex-1">
        <KanbanPage />
      </main>
    </AppShell>
  );
}
