"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { api } from "@/lib/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { ClipboardPasteIcon, KeyboardIcon, MicIcon, LinkIcon, TextIcon, XIcon } from "lucide-react";
import type { Socket } from "socket.io-client";

function MobileTerminalToolbar({
  agentId,
  socketRef,
  termRef,
  onShowText,
}: {
  agentId: string;
  socketRef: React.RefObject<Socket | null>;
  termRef: React.RefObject<import("@xterm/xterm").Terminal | null>;
  onShowText: () => void;
}) {
  const isMobile = useIsMobile();
  const [listening, setListening] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleCopyUrl = async () => {
    if (!termRef.current) return;
    // Extract all text from the terminal buffer
    // Join lines without newlines first since URLs may wrap across PTY lines
    const buffer = termRef.current.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        // isWrapped means this line is a continuation of the previous
        if (line.isWrapped && lines.length > 0) {
          lines[lines.length - 1] += line.translateToString(true).trimStart();
        } else {
          lines.push(line.translateToString(true));
        }
      }
    }
    const text = lines.join("\n");
    const urls = text.match(/https?:\/\/[^\s"'<>]+/g);
    if (urls && urls.length > 0) {
      const lastUrl = urls[urls.length - 1];
      try {
        await navigator.clipboard.writeText(lastUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback: open the URL directly
        window.open(lastUrl, "_blank", "noopener,noreferrer");
      }
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
      <Button size="xs" variant={copied ? "default" : "secondary"} onClick={handleCopyUrl}>
        <LinkIcon className="size-3.5" />
        {copied ? "Copied!" : "URL"}
      </Button>
      <Button size="xs" variant="secondary" onClick={onShowText}>
        <TextIcon className="size-3.5" />
        Text
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

function extractBufferText(term: import("@xterm/xterm").Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

export function Terminal({ agentId, isActive }: { agentId: string; isActive?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [textOverlay, setTextOverlay] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (!mounted || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon((_event, uri) => {
        window.open(uri, "_blank", "noopener,noreferrer");
      });
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
      term.loadAddon(webLinksAddon);
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

  const handleShowText = () => {
    if (termRef.current) {
      setTextOverlay(extractBufferText(termRef.current));
    }
  };

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.min.css"
      />
      <div className="relative flex h-full min-h-0 flex-col">
        <div ref={containerRef} className="w-full min-h-0 flex-1" />

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
            termRef={termRef}
            onShowText={handleShowText}
          />
        )}
      </div>
    </>
  );
}
