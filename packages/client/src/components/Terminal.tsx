"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { api } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDeepgram } from "@/hooks/use-deepgram";
import { Button } from "@/components/ui/button";
import { ClipboardPasteIcon, KeyboardIcon, MicIcon, MicOffIcon, TextIcon, XIcon } from "lucide-react";
import type { Socket } from "socket.io-client";
import type { Terminal as GhosttyTerminal } from "ghostty-web";

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
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const send = useCallback(
    (data: string) => {
      socketRef.current?.emit("agent:input", { agentId, data });
    },
    [agentId, socketRef]
  );

  const { status: voiceStatus, toggle: toggleVoice } = useDeepgram({
    onTranscript: send,
  });

  if (!isMobile) return null;

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

  const handleToggleKeyboard = () => {
    if (keyboardOpen) {
      hiddenInputRef.current?.blur();
      setKeyboardOpen(false);
    } else {
      hiddenInputRef.current?.focus({ preventScroll: true });
      setKeyboardOpen(true);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t bg-card px-2 py-1.5">
      <Button size="xs" variant="secondary" onClick={handleEsc}>
        Esc
      </Button>
      <Button size="xs" variant="secondary" onClick={() => send("\t")}>
        Tab
      </Button>
      <Button size="xs" variant="secondary" onClick={() => send("1")}>
        1
      </Button>
      <Button size="xs" variant="secondary" onClick={() => send("2")}>
        2
      </Button>
      <Button size="xs" variant="secondary" onClick={() => send("3")}>
        3
      </Button>
      <Button size="xs" variant="secondary" onClick={handlePaste}>
        <ClipboardPasteIcon className="size-3.5" />
      </Button>
      <Button size="xs" variant="secondary" onClick={onShowText}>
        <TextIcon className="size-3.5" />
        Text
      </Button>
      <Button
        size="xs"
        variant={isListening ? "destructive" : "secondary"}
        onClick={toggleVoice}
        disabled={isVoiceConnecting}
      >
        {isListening ? (
          <MicOffIcon className="size-3.5" />
        ) : (
          <MicIcon className="size-3.5" />
        )}
      </Button>
      <Button
        size="xs"
        variant={keyboardOpen ? "default" : "secondary"}
        onClick={handleToggleKeyboard}
      >
        <KeyboardIcon className="size-3.5" />
      </Button>
      <input
        ref={hiddenInputRef}
        style={{ width: 0, height: 0, padding: 0, border: 0, opacity: 0, position: "absolute", bottom: 0, left: 0 }}
        aria-hidden
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="text"
        onInput={(e) => {
          const value = (e.target as HTMLInputElement).value;
          if (value) {
            send(value);
            (e.target as HTMLInputElement).value = "";
          }
        }}
        onFocus={() => {
          // Prevent browser from scrolling to this input
          window.scrollTo(0, 0);
        }}
        onBlur={() => setKeyboardOpen(false)}
      />
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

      // Touch scrolling for mobile (ghostty-web has no built-in touch scroll)
      let touchStartY = 0;
      let touchAccum = 0;
      const container = containerRef.current;

      const lineHeight = term.rows > 0
        ? container.clientHeight / term.rows
        : 16;

      const onTouchStart = (e: TouchEvent) => {
        touchStartY = e.touches[0].clientY;
        touchAccum = 0;
      };

      const onTouchMove = (e: TouchEvent) => {
        const dy = touchStartY - e.touches[0].clientY;
        touchStartY = e.touches[0].clientY;
        touchAccum += dy;

        const linesToScroll = Math.trunc(touchAccum / lineHeight);
        if (linesToScroll !== 0) {
          term.scrollLines(linesToScroll);
          touchAccum -= linesToScroll * lineHeight;
        }

        e.preventDefault();
      };

      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: false });

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
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
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
