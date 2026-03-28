"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
import type { Terminal as XtermTerminal } from "@xterm/xterm";

export function SetupDialog({
  open,
  onComplete,
}: {
  open: boolean;
  onComplete: () => void;
}) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [completed, setCompleted] = useState(false);
  const [latestUrl, setLatestUrl] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const sendInputRef = useRef<((data: string) => void) | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Callback ref — fires when the portal mounts the div into the DOM
  const containerRefCb = useCallback((el: HTMLDivElement | null) => {
    setContainerEl(el);
  }, []);

  useEffect(() => {
    if (!open || !containerEl) return;

    let cancelled = false;
    let cleanupTerminal: (() => void) | null = null;
    containerEl.replaceChildren();

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (cancelled || !containerEl) return;

      const fitAddon = new FitAddon();

      const term: XtermTerminal = new Terminal({
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
          cursor: "#fafafa",
        },
        fontFamily: "monospace",
        fontSize: 13,
        cursorBlink: true,
        scrollback: 50000,
      });

      term.loadAddon(fitAddon);
      term.open(containerEl);
      term.focus();

      // Wait for the dialog open animation to finish so the container
      // has its final rendered size before we measure cols/rows.
      await new Promise((r) => setTimeout(r, 300));
      if (cancelled) return;
      fitAddon.fit();

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(containerEl);

      const socket = getSocket();

      // Register listeners first
      const handleOutput = (payload: { data: string }) => {
        term.write(payload.data);
      };
      socket.on("setup:output", handleOutput);

      // Surface detected URLs as a clickable banner
      const handleUrl = (payload: { url: string }) => {
        if (cancelled) return;
        setLatestUrl(payload.url);
      };
      socket.on("setup:url", handleUrl);

      const handleClearUrl = () => {
        if (cancelled) return;
        setLatestUrl(null);
      };
      socket.on("setup:clear-url", handleClearUrl);

      const handleSetupComplete = () => {
        if (cancelled) return;
        setCompleted(true);
        setTimeout(() => onCompleteRef.current(), 1500);
      };
      socket.on("setup:complete", handleSetupComplete);

      // Forward input
      term.onData((data: string) => {
        socket.emit("setup:input", { data });
      });

      // Expose a way for the paste helper to send input
      sendInputRef.current = (data: string) => {
        socket.emit("setup:input", { data });
        term.focus();
      };

      // Subscribe and start PTY
      fitAddon.fit();
      socket.emit("setup:subscribe", { cols: term.cols, rows: term.rows });

      // Handle resize
      term.onResize((size: { cols: number; rows: number }) => {
        socket.emit("setup:resize", { cols: size.cols, rows: size.rows });
      });

      cleanupTerminal = () => {
        resizeObserver.disconnect();
        socket.off("setup:output", handleOutput);
        socket.off("setup:url", handleUrl);
        socket.off("setup:clear-url", handleClearUrl);
        socket.off("setup:complete", handleSetupComplete);
        socket.emit("setup:unsubscribe", {});
        sendInputRef.current = null;
        term.dispose();
        containerEl.replaceChildren();
      };
    })();

    return () => {
      cancelled = true;
      cleanupTerminal?.();
    };
  }, [open, containerEl]);

  const handleSkip = () => {
    const socket = getSocket();
    socket.emit("setup:unsubscribe", {});
    onComplete();
  };

  const handlePasteSend = () => {
    if (!pasteValue || !sendInputRef.current) return;
    sendInputRef.current(pasteValue);
    setPasteValue("");
  };

  const handleRestart = () => {
    setCompleted(false);
    setLatestUrl(null);
    const socket = getSocket();
    socket.emit("setup:restart", {});
  };

  const sendKey = (key: string) => {
    sendInputRef.current?.(key);
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
            Install the tooling Maestro needs and authenticate the CLIs it can reuse.
          </DialogDescription>
        </DialogHeader>

        {!completed && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Most prompts default to <span className="font-medium text-foreground">Yes</span>.
            Press <span className="font-mono text-xs">Enter</span> to accept the default, or use the quick buttons below.
          </div>
        )}

        {latestUrl && !completed && (
          <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm">
            <span className="shrink-0 font-medium text-blue-400">
              Open this URL to authenticate:
            </span>
            <a
              href={latestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-blue-400 underline underline-offset-2 hover:text-blue-300"
            >
              {latestUrl}
            </a>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 ml-auto h-7 text-xs"
              onClick={() => window.open(latestUrl, "_blank")}
            >
              Open
            </Button>
          </div>
        )}

        <div className="flex-1 min-h-0 rounded-lg overflow-hidden border bg-[#09090b]">
          <div ref={containerRefCb} className="h-full w-full" />
        </div>

        {!completed && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-mono flex-1 sm:flex-none"
                onClick={() => sendKey("y\n")}
              >
                Yes / Default
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-mono flex-1 sm:flex-none"
                onClick={() => sendKey("\n")}
              >
                Enter
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-mono flex-1 sm:flex-none"
                onClick={() => sendKey("n\n")}
              >
                No
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePasteSend();
                }}
                placeholder="Paste token or code here..."
                className="flex-1 min-w-0 rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={handlePasteSend}
                disabled={!pasteValue}
              >
                Send
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {completed ? (
            <p className="text-sm text-green-500 font-medium">
              Setup complete! Starting Maestro...
            </p>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={handleRestart}>
                Restart
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSkip}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
