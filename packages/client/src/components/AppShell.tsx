"use client";

import { useEffect, useRef, useState } from "react";
import { GitHubStatusBanner } from "@/components/GitHubStatusBanner";
import { Sidebar } from "@/components/Sidebar";
import { SetupDialog } from "@/components/SetupDialog";
import { SocketProvider } from "@/components/SocketProvider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api";

function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

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

  // Lock the mobile shell to the layout viewport height so the software
  // keyboard overlays the page instead of reflowing the terminal.
  useEffect(() => {
    if (!hideMobileHeader) return;

    const inset = insetRef.current;
    const wrapper = inset?.closest<HTMLElement>("[data-slot='sidebar-wrapper']");
    let lockedWidth = window.innerWidth;
    let lockedHeight = window.innerHeight;

    const applyHeight = (height: number) => {
      const h = `${height}px`;
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

    const update = () => {
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      const keyboardLikeResize =
        nextWidth === lockedWidth &&
        nextHeight < lockedHeight &&
        isEditableElement(document.activeElement);

      if (keyboardLikeResize) {
        applyHeight(lockedHeight);
        return;
      }

      lockedWidth = nextWidth;
      lockedHeight = nextHeight;
      applyHeight(lockedHeight);
    };

    applyHeight(lockedHeight);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
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
