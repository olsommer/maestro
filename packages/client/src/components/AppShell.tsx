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
  // Also constrain the sidebar wrapper to prevent page-level scrolling.
  useEffect(() => {
    if (!hideMobileHeader) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const inset = insetRef.current;
    const wrapper = inset?.closest<HTMLElement>("[data-slot='sidebar-wrapper']");

    const update = () => {
      const h = `${vv.height}px`;
      if (inset) {
        inset.style.height = h;
        inset.style.minHeight = h;
        inset.style.maxHeight = h;
      }
      if (wrapper) {
        wrapper.style.height = h;
        wrapper.style.minHeight = h;
        wrapper.style.maxHeight = h;
        wrapper.style.overflow = "hidden";
      }
    };
    update();
    vv.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      if (inset) {
        inset.style.height = "";
        inset.style.minHeight = "";
        inset.style.maxHeight = "";
      }
      if (wrapper) {
        wrapper.style.height = "";
        wrapper.style.minHeight = "";
        wrapper.style.maxHeight = "";
        wrapper.style.overflow = "";
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
