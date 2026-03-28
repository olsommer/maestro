"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  CheckCircle2Icon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react";
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
          background: "#0b1020",
          foreground: "#fafafa",
          cursor: "#dbeafe",
          selectionBackground: "#1d4ed8",
          brightBlack: "#6b7280",
          green: "#4ade80",
          yellow: "#facc15",
          red: "#f87171",
          blue: "#60a5fa",
          cyan: "#67e8f9",
        },
        fontFamily: "'IBM Plex Mono', 'SFMono-Regular', ui-monospace, monospace",
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
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="size-4 text-emerald-500" />
              <span>
                Most prompts default to <span className="font-medium text-slate-900 dark:text-slate-100">Yes</span>.
                Press <span className="font-mono text-xs">Enter</span> to accept the default, or use the quick actions below.
              </span>
            </div>
          </div>
        )}

        {latestUrl && !completed && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm shadow-sm">
            <ExternalLinkIcon className="size-4 shrink-0 text-blue-400" />
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

        <div className="flex-1 min-h-0 overflow-hidden rounded-2xl border border-slate-900/80 bg-[#0b1020] shadow-[0_20px_60px_rgba(2,6,23,0.35)]">
          <div ref={containerRefCb} className="h-full w-full" />
        </div>

        {!completed && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 flex-1 border-emerald-500/30 bg-emerald-500/10 text-xs font-mono text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300 sm:flex-none"
                onClick={() => sendKey("y\n")}
              >
                <CheckCircle2Icon className="mr-1 size-3.5" />
                Yes / Default
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 flex-1 border-slate-300 bg-slate-100 text-xs font-mono text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:flex-none"
                onClick={() => sendKey("\n")}
              >
                <CornerDownLeftIcon className="mr-1 size-3.5" />
                Enter
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 flex-1 border-rose-500/30 bg-rose-500/10 text-xs font-mono text-rose-700 hover:bg-rose-500/15 dark:text-rose-300 sm:flex-none"
                onClick={() => sendKey("n\n")}
              >
                <XCircleIcon className="mr-1 size-3.5" />
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
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
              <CheckCircle2Icon className="size-4" />
              <span>Setup complete! Starting Maestro...</span>
            </div>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={handleRestart} className="gap-2">
                <RotateCcwIcon className="size-4" />
                Restart
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSkip} className="gap-2">
                <ShieldAlertIcon className="size-4" />
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
