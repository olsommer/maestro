"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { api } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDeepgram } from "@/hooks/use-deepgram";
import { Button } from "@/components/ui/button";
import { ArrowRightToLineIcon, ClipboardPasteIcon, MicIcon, MicOffIcon, TextIcon, XIcon } from "lucide-react";
import type { Socket } from "socket.io-client";
import type { Terminal as GhosttyTerminal } from "ghostty-web";

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
  agentId,
  socketRef,
  onShowText,
}: {
  agentId: string;
  socketRef: React.RefObject<Socket | null>;
  onShowText: () => void;
}) {
  const isMobile = useIsMobile();
  const keyboardOpen = useMobileKeyboard();

  const send = useCallback(
    (data: string) => {
      socketRef.current?.emit("agent:input", { agentId, data });
    },
    [agentId, socketRef]
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

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t bg-card px-2 py-2"
      onTouchMove={(e) => e.stopPropagation()}
    >
      <Button size="sm" variant="secondary" onClick={handleEsc}>
        Esc
      </Button>
      <Button size="sm" variant="secondary" onClick={() => send("\t")}>
        <ArrowRightToLineIcon className="size-4" />
      </Button>
      <Button size="sm" variant="secondary" onClick={() => send("1")}>
        1
      </Button>
      <Button size="sm" variant="secondary" onClick={() => send("2")}>
        2
      </Button>
      <Button size="sm" variant="secondary" onClick={() => send("3")}>
        3
      </Button>
      <Button size="sm" variant="secondary" onClick={handlePaste}>
        <ClipboardPasteIcon className="size-4" />
      </Button>
      <Button size="sm" variant="secondary" onClick={onShowText}>
        <TextIcon className="size-4" />
      </Button>
      <Button
        size="sm"
        variant={isListening ? "destructive" : "secondary"}
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

function extractBufferText(term: GhosttyTerminal): string {
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

export function Terminal({ agentId, isActive }: { agentId: string; isActive?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<GhosttyTerminal | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [textOverlay, setTextOverlay] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      const { init, Terminal, FitAddon } = await import("ghostty-web");

      await init();

      if (!mounted || !containerRef.current) return;

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
      });

      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();
      fitAddon.observeResize();

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Touch scrolling for mobile (ghostty-web has no built-in touch scroll)
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

      // Prevent ghostty's touchend handler from focusing the textarea (opening keyboard)
      // when the user was scrolling rather than tapping.
      const onTouchEnd = (e: TouchEvent) => {
        if (didScroll) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      // Use capture phase to intercept before ghostty's touchend handler
      container.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });

      // Refit terminal when mobile keyboard opens/closes (visualViewport resize)
      let resizeTimer: ReturnType<typeof setTimeout>;
      const onViewportResize = () => {
        // Immediate fit + delayed fit to catch layout reflows
        fitAddon.fit();
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => fitAddon.fit(), 100);
      };
      window.visualViewport?.addEventListener("resize", onViewportResize);

      // Load existing output buffer
      try {
        const { output } = await api.getAgentOutput(agentId);
        for (const chunk of output) {
          term.write(chunk);
        }
      } catch {
        // Ignore
      }

      // Subscribe to live output
      const socket = getSocket();
      socketRef.current = socket;
      socket.emit("agent:subscribe", { agentId });

      // Send initial dimensions
      socket.emit("agent:resize", {
        agentId,
        cols: term.cols,
        rows: term.rows,
      });

      // Handle terminal resize
      term.onResize((size: { cols: number; rows: number }) => {
        socket.emit("agent:resize", {
          agentId,
          cols: size.cols,
          rows: size.rows,
        });
      });

      const handleOutput = (data: { agentId: string; data: string }) => {
        if (data.agentId === agentId) {
          term.write(data.data);
        }
      };
      socket.on("agent:output", handleOutput);

      // Send keystrokes to server
      term.onData((data: string) => {
        socket.emit("agent:input", { agentId, data });
      });

      return () => {
        clearTimeout(resizeTimer);
        window.visualViewport?.removeEventListener("resize", onViewportResize);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
        socket.off("agent:output", handleOutput);
        socket.emit("agent:unsubscribe", { agentId });
        term.dispose();
        socketRef.current = null;
      };
    }

    const cleanup = setup();

    return () => {
      mounted = false;
      cleanup.then((fn) => fn?.());
    };
  }, [agentId]);

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
      <div ref={containerRef} className="w-full min-h-0 flex-1 touch-none" />

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
          agentId={agentId}
          socketRef={socketRef}
          onShowText={handleShowText}
        />
      )}
    </div>
  );
}
