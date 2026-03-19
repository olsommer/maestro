"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { api } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDeepgram } from "@/hooks/use-deepgram";
import { Button } from "@/components/ui/button";
import {
  ArrowRightToLineIcon,
  ClipboardPasteIcon,
  CornerDownLeftIcon,
  MicIcon,
  MicOffIcon,
  TextIcon,
  XIcon,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

function useMobileKeyboard() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const threshold = 100;
    const check = () => setOpen(window.innerHeight - vv.height > threshold);
    check();
    vv.addEventListener("resize", check);
    return () => vv.removeEventListener("resize", check);
  }, []);

  return open;
}

function MobileTerminalToolbar({
  terminalId,
  socketRef,
  onShowText,
}: {
  terminalId: string;
  socketRef: React.RefObject<Socket | null>;
  onShowText: () => void;
}) {
  const isMobile = useIsMobile();
  const keyboardOpen = useMobileKeyboard();

  const send = useCallback(
    (data: string) => {
      socketRef.current?.emit("terminal:input", { terminalId, data });
    },
    [terminalId, socketRef]
  );

  const { status: voiceStatus, toggle: toggleVoice } = useDeepgram({
    onTranscript: send,
  });

  if (!isMobile || keyboardOpen) return null;

  const handleEsc = () => send("\x1b");

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) send(text);
    } catch {
      // Clipboard access denied
    }
  };

  const isListening = voiceStatus === "listening";
  const isVoiceConnecting = voiceStatus === "connecting";
  const toolbarButtonClassName =
    "h-9 w-full min-w-0 rounded-md px-0 text-[0.8rem] [&_svg:not([class*='size-'])]:size-[18px]";

  return (
    <div
      className="grid shrink-0 grid-cols-5 gap-2 border-t bg-card px-3 py-2.5"
      onTouchMove={(e) => e.stopPropagation()}
    >
      <Button size="sm" variant="secondary" className={toolbarButtonClassName} onClick={handleEsc}>
        Esc
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className={toolbarButtonClassName}
        aria-label="Send tab"
        onClick={() => send("\t")}
      >
        <ArrowRightToLineIcon className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className={toolbarButtonClassName}
        aria-label="Send enter"
        onClick={() => send("\r")}
      >
        <CornerDownLeftIcon className="size-4" />
      </Button>
      <Button size="sm" variant="secondary" className={toolbarButtonClassName} onClick={() => send("1")}>
        1
      </Button>
      <Button size="sm" variant="secondary" className={toolbarButtonClassName} onClick={() => send("2")}>
        2
      </Button>
      <Button size="sm" variant="secondary" className={toolbarButtonClassName} onClick={() => send("3")}>
        3
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className={toolbarButtonClassName}
        aria-label="Paste from clipboard"
        onClick={handlePaste}
      >
        <ClipboardPasteIcon className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className={toolbarButtonClassName}
        aria-label="Show terminal text"
        onClick={onShowText}
      >
        <TextIcon className="size-4" />
      </Button>
      <Button
        size="sm"
        variant={isListening ? "destructive" : "secondary"}
        className={toolbarButtonClassName}
        aria-label={isListening ? "Stop voice input" : "Start voice input"}
        onClick={toggleVoice}
        disabled={isVoiceConnecting}
      >
        {isListening ? (
          <MicOffIcon className="size-4" />
        ) : (
          <MicIcon className="size-4" />
        )}
      </Button>
    </div>
  );
}

function extractBufferText(term: XtermTerminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

export function Terminal({ terminalId, isActive }: { terminalId: string; isActive?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [textOverlay, setTextOverlay] = useState<string | null>(null);

  useLayoutEffect(() => {
    setTextOverlay(null);
    containerRef.current?.replaceChildren();
  }, [terminalId]);

  useEffect(() => {
    let cancelled = false;
    let disposeTerminal: (() => void) | null = null;
    containerRef.current?.replaceChildren();

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (cancelled || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const term = new Terminal({
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
          cursor: "#fafafa",
        },
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: window.innerWidth < 768 ? 10 : 13,
        cursorBlink: true,
        scrollback: 5000,
        convertEol: false,
      });

      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();
      term.focus();

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      setTextOverlay(null);

      // Touch scrolling for mobile
      let touchStartY = 0;
      let touchAccum = 0;
      let didScroll = false;
      const container = containerRef.current;

      const lineHeight = term.rows > 0
        ? container.clientHeight / term.rows
        : 16;

      const onTouchStart = (e: TouchEvent) => {
        touchStartY = e.touches[0].clientY;
        touchAccum = 0;
        didScroll = false;
      };

      const onTouchMove = (e: TouchEvent) => {
        const dy = touchStartY - e.touches[0].clientY;
        touchStartY = e.touches[0].clientY;
        touchAccum += dy;
        didScroll = true;

        const linesToScroll = Math.trunc(touchAccum / lineHeight);
        if (linesToScroll !== 0) {
          term.scrollLines(linesToScroll);
          touchAccum -= linesToScroll * lineHeight;
        }

        e.preventDefault();
      };

      const onTouchEnd = (e: TouchEvent) => {
        if (didScroll) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      container.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(container);

      let resizeTimer: ReturnType<typeof setTimeout>;
      const onViewportResize = () => {
        fitAddon.fit();
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => fitAddon.fit(), 100);
      };
      window.visualViewport?.addEventListener("resize", onViewportResize);
      let cleanedUp = false;

      const socket = getSocket();
      socketRef.current = socket;

      const handleOutput = (data: { terminalId: string; data: string }) => {
        if (data.terminalId === terminalId) {
          term.write(data.data);
        }
      };

      // Send keystrokes to server
      term.onData((data: string) => {
        socket.emit("terminal:input", { terminalId, data });
      });

      // Handle terminal resize
      term.onResize((size: { cols: number; rows: number }) => {
        socket.emit("terminal:resize", {
          terminalId,
          cols: size.cols,
          rows: size.rows,
        });
      });

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        window.visualViewport?.removeEventListener("resize", onViewportResize);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
        socket.off("terminal:output", handleOutput);
        socket.emit("terminal:unsubscribe", { terminalId });
        term.dispose();
        container.replaceChildren();
        termRef.current = null;
        fitAddonRef.current = null;
        socketRef.current = null;
      };

      disposeTerminal = cleanup;

      // Load existing output buffer
      try {
        const { output } = await api.getTerminalOutput(terminalId);
        if (cancelled) {
          cleanup();
          return;
        }
        for (const chunk of output) {
          term.write(chunk);
        }
      } catch {
        // Ignore
      }

      if (cancelled) {
        cleanup();
        return;
      }

      // Subscribe to live output
      socket.emit("terminal:subscribe", { terminalId });

      socket.emit("terminal:resize", {
        terminalId,
        cols: term.cols,
        rows: term.rows,
      });
      socket.on("terminal:output", handleOutput);
    })();

    return () => {
      cancelled = true;
      disposeTerminal?.();
    };
  }, [terminalId]);

  // Refit when toolbar visibility changes (isActive controls toolbar rendering)
  useEffect(() => {
    // Small delay to let the DOM update after toolbar mount/unmount
    const id = setTimeout(() => fitAddonRef.current?.fit(), 50);
    return () => clearTimeout(id);
  }, [isActive]);

  const handleShowText = () => {
    if (termRef.current) {
      setTextOverlay(extractBufferText(termRef.current));
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={containerRef} className="w-full min-h-0 flex-1 touch-none pt-1" />

      {textOverlay !== null && (
        <div className="absolute inset-0 z-10 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Select text to copy
            </span>
            <Button size="xs" variant="ghost" onClick={() => setTextOverlay(null)}>
              <XIcon className="size-3.5" />
            </Button>
          </div>
          <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all p-3 select-text font-mono text-foreground" style={{ fontSize: "9px", lineHeight: "1.4" }}>
            {textOverlay}
          </pre>
        </div>
      )}

      {isActive && (
        <MobileTerminalToolbar
          terminalId={terminalId}
          socketRef={socketRef}
          onShowText={handleShowText}
        />
      )}
    </div>
  );
}
