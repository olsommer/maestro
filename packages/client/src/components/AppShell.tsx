"use client";

import { useEffect, useState } from "react";
import { GitHubStatusBanner } from "@/components/GitHubStatusBanner";
import { Sidebar } from "@/components/Sidebar";
import { SetupDialog } from "@/components/SetupDialog";
import { SocketProvider } from "@/components/SocketProvider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api
      .getSetupStatus()
      .then(({ needsSetup }) => {
        setNeedsSetup(needsSetup);
        setChecked(true);
      })
      .catch(() => {
        setChecked(true);
      });
  }, []);

  return (
    <>
      {checked && needsSetup && (
        <SetupDialog open={needsSetup} onComplete={() => setNeedsSetup(false)} />
      )}
      <SidebarProvider>
        <Sidebar />

        {/* Main */}
        <SidebarInset className="min-h-dvh">
          <GitHubStatusBanner />
          <header className="sticky top-0 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SocketProvider>
      <AppShellInner>{children}</AppShellInner>
    </SocketProvider>
  );
}
