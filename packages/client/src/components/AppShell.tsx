"use client";

import { useEffect, useRef, useState } from "react";
import { GitHubStatusBanner } from "@/components/GitHubStatusBanner";
import { Sidebar } from "@/components/Sidebar";
import { SetupDialog } from "@/components/SetupDialog";
import { SocketProvider } from "@/components/SocketProvider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api";

function AppShellInner({ children, hideMobileHeader }: { children: React.ReactNode; hideMobileHeader?: boolean }) {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checked, setChecked] = useState(false);
  const insetRef = useRef<HTMLDivElement>(null);

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

  // On pages that manage their own mobile header (e.g. agents with terminal),
  // track visualViewport height to resize when the keyboard opens/closes.
  useEffect(() => {
    if (!hideMobileHeader) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      if (insetRef.current) {
        const h = `${vv.height}px`;
        insetRef.current.style.height = h;
        insetRef.current.style.minHeight = h;
        insetRef.current.style.maxHeight = h;
      }
    };
    update();
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      if (insetRef.current) {
        insetRef.current.style.height = "";
        insetRef.current.style.minHeight = "";
        insetRef.current.style.maxHeight = "";
      }
    };
  }, [hideMobileHeader]);

  return (
    <>
      {checked && needsSetup && (
        <SetupDialog open={needsSetup} onComplete={() => setNeedsSetup(false)} />
      )}
      <SidebarProvider>
        <Sidebar />

        {/* Main */}
        <SidebarInset
          ref={insetRef}
          className={hideMobileHeader ? "min-h-dvh max-h-dvh overflow-hidden" : "min-h-dvh max-h-dvh"}
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
