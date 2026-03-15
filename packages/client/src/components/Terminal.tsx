"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { api } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { ClipboardPasteIcon, KeyboardIcon, MicIcon } from "lucide-react";
import type { Socket } from "socket.io-client";

function MobileTerminalToolbar({
  agentId,
  socketRef,
}: {
  agentId: string;
  socketRef: React.RefObject<Socket | null>;
}) {
  const isMobile = useIsMobile();
  const [listening, setListening] = useState(false);

  if (!isMobile) return null;

  const send = (data: string) => {
    socketRef.current?.emit("agent:input", { agentId, data });
  };

  const handleEsc = () => send("\x1b");

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) send(text);
    } catch {
      // Clipboard access denied
    }
  };

  const handleVoice = () => {
    const SpeechRecognition =
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition ||
      (window as unknown as Record<string, unknown>).SpeechRecognition;
    if (!SpeechRecognition) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SpeechRecognition as any)();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) send(transcript);
    };

    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    setListening(true);
    recognition.start();
  };

  const hasSpeechRecognition =
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-t bg-card px-2 py-1.5">
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
      {hasSpeechRecognition && (
        <Button
          size="xs"
          variant={listening ? "default" : "secondary"}
          onClick={handleVoice}
          disabled={listening}
        >
          <MicIcon className="size-3.5" />
        </Button>
      )}
      <Button
        size="xs"
        variant="secondary"
        onClick={() => {
          const input = document.createElement("input");
          input.style.position = "fixed";
          input.style.opacity = "0";
          document.body.appendChild(input);
          input.focus();
          input.addEventListener("input", (e) => {
            const value = (e.target as HTMLInputElement).value;
            if (value) {
              send(value);
              (e.target as HTMLInputElement).value = "";
            }
          });
          input.addEventListener("blur", () => input.remove());
        }}
      >
        <KeyboardIcon className="size-3.5" />
      </Button>
    </div>
  );
}

export function Terminal({ agentId, isActive }: { agentId: string; isActive?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!mounted || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const term = new Terminal({
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
          cursor: "#fafafa",
          selectionBackground: "#27272a",
        },
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: window.innerWidth < 768 ? 10 : 13,
        cursorBlink: true,
        convertEol: true,
      });

      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      termRef.current = term;
      fitRef.current = fitAddon;

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

      // Send initial dimensions so the PTY matches the actual terminal size
      socket.emit("agent:resize", {
        agentId,
        cols: term.cols,
        rows: term.rows,
      });

      const handleOutput = (data: { agentId: string; data: string }) => {
        if (data.agentId === agentId) {
          term.write(data.data);
        }
      };
      socket.on("agent:output", handleOutput);

      // Send keystrokes to server
      term.onData((data) => {
        socket.emit("agent:input", { agentId, data });
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        socket.emit("agent:resize", {
          agentId,
          cols: term.cols,
          rows: term.rows,
        });
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        socket.off("agent:output", handleOutput);
        socket.emit("agent:unsubscribe", { agentId });
        term.dispose();
        socketRef.current = null;
      };
    }

    const cleanup = init();

    return () => {
      mounted = false;
      cleanup.then((fn) => fn?.());
    };
  }, [agentId]);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.min.css"
      />
      <div className="flex h-full min-h-0 flex-col">
        <div ref={containerRef} className="w-full min-h-0 flex-1" />
        {isActive && <MobileTerminalToolbar agentId={agentId} socketRef={socketRef} />}
      </div>
    </>
  );
}
