"use client";

import { useEffect, useState } from "react";
import { GitHubStatusBanner } from "@/components/GitHubStatusBanner";
import { Sidebar } from "@/components/Sidebar";
import { SetupDialog } from "@/components/SetupDialog";
import { SocketProvider } from "@/components/SocketProvider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api";

function useViewportHeight() {
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => setHeight(vv.height);
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  return height;
}

function AppShellInner({ children, hideMobileHeader }: { children: React.ReactNode; hideMobileHeader?: boolean }) {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checked, setChecked] = useState(false);
  const vpHeight = useViewportHeight();

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
        <SidebarInset
          className="min-h-dvh max-h-dvh overflow-hidden"
          style={vpHeight ? { height: vpHeight, minHeight: vpHeight, maxHeight: vpHeight } : undefined}
        >
          <GitHubStatusBanner />
          {!hideMobileHeader && (
            <header className="sticky top-0 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4 md:hidden">
              <SidebarTrigger className="-ml-1" />
              <span className="ascii-logo text-sm md:hidden">Maestro</span>
            </header>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}

export function AppShell({ children, hideMobileHeader }: { children: React.ReactNode; hideMobileHeader?: boolean }) {
  return (
    <SocketProvider>
      <AppShellInner hideMobileHeader={hideMobileHeader}>{children}</AppShellInner>
    </SocketProvider>
  );
}
