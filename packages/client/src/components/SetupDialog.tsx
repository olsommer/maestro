"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getSocket } from "@/lib/socket";

export function SetupDialog({
  open,
  onComplete,
}: {
  open: boolean;
  onComplete: () => void;
}) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [completed, setCompleted] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Callback ref — fires when the portal mounts the div into the DOM
  const containerRefCb = useCallback((el: HTMLDivElement | null) => {
    setContainerEl(el);
  }, []);

  useEffect(() => {
    if (!open || !containerEl) return;

    let mounted = true;

    async function init() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!mounted || !containerEl) return;

      const fitAddon = new FitAddon();
      const term = new Terminal({
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
          cursor: "#fafafa",
          selectionBackground: "#27272a",
        },
        fontFamily: "monospace",
        fontSize: 13,
        cursorBlink: true,
      });

      term.loadAddon(fitAddon);
      term.open(containerEl);

      // Wait for the dialog open animation to finish so the container
      // has its final rendered size before we measure cols/rows.
      await new Promise((r) => setTimeout(r, 300));
      if (!mounted) return;
      fitAddon.fit();

      const socket = getSocket();

      // Register listeners first
      const handleOutput = (payload: { data: string }) => {
        term.write(payload.data);
      };
      socket.on("setup:output", handleOutput);

      const handleSetupComplete = () => {
        if (!mounted) return;
        setCompleted(true);
        setTimeout(() => onCompleteRef.current(), 1500);
      };
      socket.on("setup:complete", handleSetupComplete);

      // Forward input
      term.onData((data) => {
        socket.emit("setup:input", { data });
      });

      // Subscribe and start PTY in one step — server auto-starts
      // the PTY with these dimensions when no PTY is running yet
      fitAddon.fit();
      socket.emit("setup:subscribe", { cols: term.cols, rows: term.rows });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        socket.emit("setup:resize", { cols: term.cols, rows: term.rows });
      });
      resizeObserver.observe(containerEl);

      return () => {
        resizeObserver.disconnect();
        socket.off("setup:output", handleOutput);
        socket.off("setup:complete", handleSetupComplete);
        socket.emit("setup:unsubscribe", {});
        term.dispose();
      };
    }

    const cleanup = init();

    return () => {
      mounted = false;
      cleanup.then((fn) => fn?.());
    };
  }, [open, containerEl]);

  const handleSkip = () => {
    const socket = getSocket();
    socket.emit("setup:unsubscribe", {});
    onComplete();
  };

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-3xl h-[80vh] flex flex-col"
      >
        <DialogHeader>
          <DialogTitle>First-Run Setup</DialogTitle>
          <DialogDescription>
            Authenticate your CLI tools to get started with Maestro.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 rounded-lg overflow-hidden border bg-[#09090b]">
          <div ref={containerRefCb} className="h-full w-full" />
        </div>

        {completed ? (
          <DialogFooter>
            <p className="text-sm text-green-500 font-medium">
              Setup complete! Starting Maestro...
            </p>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              Skip Setup
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
