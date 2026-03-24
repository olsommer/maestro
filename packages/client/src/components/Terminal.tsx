"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
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
import {
  TerminalAttachResponse as TerminalAttachResponseSchema,
  type TerminalAttachResponse,
} from "@maestro/wire";

interface StoredTerminalSnapshot {
  cursor: number;
  data: string;
  savedAt: number;
}

function getSnapshotStorageKey(terminalId: string): string {
  return `maestro:terminal-snapshot:${terminalId}`;
}

function loadStoredSnapshot(terminalId: string): StoredTerminalSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getSnapshotStorageKey(terminalId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTerminalSnapshot>;
    if (
      typeof parsed.cursor !== "number" ||
      typeof parsed.data !== "string" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }
    return parsed as StoredTerminalSnapshot;
  } catch {
    return null;
  }
}

function storeSnapshot(terminalId: string, snapshot: StoredTerminalSnapshot): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(getSnapshotStorageKey(terminalId), JSON.stringify(snapshot));
  } catch {
    // Ignore quota/storage errors
  }
}

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

function applyMobileTextareaWorkaround(container: HTMLDivElement): void {
  const helper = container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
  if (!helper) return;

  helper.style.position = "fixed";
  helper.style.top = "0";
  helper.style.left = "0";
  helper.style.width = "1px";
  helper.style.height = "1px";
  helper.style.opacity = "0";
  helper.style.pointerEvents = "none";
  helper.style.clipPath = "inset(50%)";
}

export function Terminal({ terminalId, isActive }: { terminalId: string; isActive?: boolean }) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobileRef = useRef(isMobile);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const attachedRef = useRef(false);
  const lastSeqRef = useRef(0);
  const pendingChunksRef = useRef<Map<number, string>>(new Map());
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [textOverlay, setTextOverlay] = useState<string | null>(null);

  useLayoutEffect(() => {
    setTextOverlay(null);
    attachedRef.current = false;
    lastSeqRef.current = 0;
    pendingChunksRef.current.clear();
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    containerRef.current?.replaceChildren();
  }, [terminalId]);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile || !containerRef.current) return;
    applyMobileTextareaWorkaround(containerRef.current);
  }, [isMobile]);

  useEffect(() => {
    let cancelled = false;
    let disposeTerminal: (() => void) | null = null;
    containerRef.current?.replaceChildren();

    void (async () => {
      const [{ Terminal }, { FitAddon }, { SerializeAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-serialize"),
      ]);

      if (cancelled || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const serializeAddon = new SerializeAddon();
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
      term.loadAddon(serializeAddon);
      term.open(containerRef.current);
      fitAddon.fit();
      if (!isMobileRef.current) {
        term.focus();
      }

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
      const storedSnapshot = loadStoredSnapshot(terminalId);

      const persistSnapshot = () => {
        storeSnapshot(terminalId, {
          cursor: lastSeqRef.current,
          data: serializeAddon.serialize(),
          savedAt: Date.now(),
        });
      };

      const schedulePersistSnapshot = () => {
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
        }
        persistTimerRef.current = setTimeout(() => {
          persistTimerRef.current = null;
          persistSnapshot();
        }, 200);
      };

      const flushPendingChunks = () => {
        for (const seq of Array.from(pendingChunksRef.current.keys())) {
          if (seq <= lastSeqRef.current) {
            pendingChunksRef.current.delete(seq);
          }
        }

        while (true) {
          const nextSeq = lastSeqRef.current + 1;
          const nextChunk = pendingChunksRef.current.get(nextSeq);
          if (nextChunk === undefined) {
            break;
          }

          pendingChunksRef.current.delete(nextSeq);
          lastSeqRef.current = nextSeq;
          term.write(nextChunk);
        }

        schedulePersistSnapshot();
      };

      const handleOutput = (data: { terminalId: string; data: string; seq: number }) => {
        if (data.terminalId === terminalId) {
          if (data.seq <= lastSeqRef.current) {
            return;
          }

          pendingChunksRef.current.set(data.seq, data.data);
          if (attachedRef.current) {
            flushPendingChunks();
          }
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
        schedulePersistSnapshot();
      });

      const onPointerDown = () => {
        term.focus();
        requestAnimationFrame(() => fitAddon.fit());
      };
      container.addEventListener("pointerdown", onPointerDown);

      const onPageHide = () => {
        persistSnapshot();
      };
      window.addEventListener("pagehide", onPageHide);

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        persistSnapshot();
        clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        window.visualViewport?.removeEventListener("resize", onViewportResize);
        window.removeEventListener("pagehide", onPageHide);
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
        socket.off("terminal:output", handleOutput);
        socket.emit("terminal:unsubscribe", { terminalId });
        term.dispose();
        container.replaceChildren();
        attachedRef.current = false;
        pendingChunksRef.current.clear();
        termRef.current = null;
        fitAddonRef.current = null;
        socketRef.current = null;
      };

      disposeTerminal = cleanup;

      if (storedSnapshot?.data) {
        term.write(storedSnapshot.data);
        lastSeqRef.current = storedSnapshot.cursor;
      }

      socket.on("terminal:output", handleOutput);

      try {
        const attachment = await new Promise<TerminalAttachResponse>((resolve, reject) => {
          socket.emit(
            "terminal:attach",
            { terminalId, cursor: lastSeqRef.current },
            (payload: unknown) => {
              try {
                resolve(TerminalAttachResponseSchema.parse(payload));
              } catch (error) {
                reject(error);
              }
            }
          );
        });

        if (cancelled) {
          cleanup();
          return;
        }

        if (attachment.mode === "snapshot") {
          if (storedSnapshot == null || attachment.cursor > lastSeqRef.current) {
            term.reset();
            fitAddon.fit();
            for (const chunk of attachment.output) {
              term.write(chunk);
            }
            lastSeqRef.current = attachment.cursor;
          }
        } else {
          for (const chunk of attachment.chunks) {
            pendingChunksRef.current.set(chunk.seq, chunk.data);
          }
        }

        attachedRef.current = true;
        flushPendingChunks();
        requestAnimationFrame(() => fitAddon.fit());
      } catch {
        // Ignore
      }

      if (cancelled) {
        cleanup();
        return;
      }

      socket.emit("terminal:resize", {
        terminalId,
        cols: term.cols,
        rows: term.rows,
      });
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
