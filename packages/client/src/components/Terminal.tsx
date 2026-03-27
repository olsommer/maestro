"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { useDeepgram } from "@/hooks/use-deepgram";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  ArrowRightToLineIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CornerDownLeftIcon,
  EllipsisIcon,
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

interface LocalTerminalSnapshot {
  terminalId: string;
  cursor: number;
  data: string;
  savedAt: number;
}

const SNAPSHOT_PERSIST_DELAY_MS = 400;
function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
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
  const [keyboardState, setKeyboardState] = useState({
    keyboardInset: 0,
    keyboardOpen: false,
  });

  useEffect(() => {
    let layoutViewportWidth = window.innerWidth;
    let layoutViewportHeight = window.innerHeight;
    const vv = window.visualViewport;
    if (!vv) return;

    const threshold = 100;
    const check = () => {
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      const keyboardLikeResize =
        nextWidth === layoutViewportWidth &&
        nextHeight < layoutViewportHeight &&
        isEditableElement(document.activeElement);

      if (!keyboardLikeResize) {
        layoutViewportWidth = nextWidth;
        layoutViewportHeight = nextHeight;
      }

      const keyboardInset = Math.max(
        0,
        Math.round(layoutViewportHeight - (vv.height + vv.offsetTop))
      );
      setKeyboardState({
        keyboardInset,
        keyboardOpen: layoutViewportHeight - vv.height > threshold,
      });
    };

    check();
    vv.addEventListener("resize", check);
    vv.addEventListener("scroll", check);
    window.addEventListener("resize", check);
    return () => {
      vv.removeEventListener("resize", check);
      vv.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return keyboardState;
}

function removeLastCharacter(value: string): string {
  const chars = Array.from(value);
  chars.pop();
  return chars.join("");
}

function removeLastWord(value: string): string {
  const chars = Array.from(value);
  while (chars.length > 0 && /\s/.test(chars[chars.length - 1] ?? "")) {
    chars.pop();
  }
  while (chars.length > 0 && !/\s/.test(chars[chars.length - 1] ?? "")) {
    chars.pop();
  }
  return chars.join("");
}

function trimPreview(value: string, maxLength = 240): string {
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  return chars.slice(chars.length - maxLength).join("");
}

function applyMobilePreviewInput(currentPreview: string, data: string): string {
  let nextPreview = currentPreview;

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];

    if (!char) continue;

    if (char === "\x1b") {
      while (index + 1 < data.length) {
        const nextChar = data[index + 1];
        if (!nextChar) break;
        if (/[A-Za-z~]/.test(nextChar)) {
          index += 1;
          break;
        }
        if (nextChar === "[" || nextChar === "]" || /[0-9;?]/.test(nextChar)) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (char === "\r" || char === "\n" || char === "\u0003" || char === "\u0004") {
      nextPreview = "";
      continue;
    }

    if (char === "\u0008" || char === "\u007f") {
      nextPreview = removeLastCharacter(nextPreview);
      continue;
    }

    if (char === "\u0015") {
      nextPreview = "";
      continue;
    }

    if (char === "\u0017") {
      nextPreview = removeLastWord(nextPreview);
      continue;
    }

    if (char === "\t") {
      nextPreview = trimPreview(`${nextPreview}  `);
      continue;
    }

    if (char < " ") {
      continue;
    }

    nextPreview = trimPreview(`${nextPreview}${char}`);
  }

  return nextPreview;
}

function MobileTerminalControls({
  onToggleTextOverlay,
  onTranscript,
  send,
  textOverlayOpen,
}: {
  onToggleTextOverlay: () => void;
  onTranscript: (text: string) => void;
  send: (data: string) => void;
  textOverlayOpen: boolean;
}) {
  const isMobile = useIsMobile();
  const { keyboardOpen } = useMobileKeyboard();
  const [moreOpen, setMoreOpen] = useState(false);
  const { status: voiceStatus, toggle: toggleVoice, waveform } = useDeepgram({
    onTranscript,
  });

  if (!isMobile) return null;

  const isListening = voiceStatus === "listening" || voiceStatus === "stopping";
  const isVoiceBusy = voiceStatus === "connecting" || voiceStatus === "stopping";
  const toolbarButtonClassName = "min-w-0 px-0";
  const voiceHint =
    voiceStatus === "connecting"
      ? "Preparing mic..."
      : voiceStatus === "listening"
        ? "Recording... tap again to send"
        : voiceStatus === "stopping"
          ? "Sending..."
          : null;
  const voiceStatusOffset = moreOpen
    ? "calc(env(safe-area-inset-bottom) + 6.5rem)"
    : "calc(env(safe-area-inset-bottom) + 3.4rem)";

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[105] px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2"
      aria-hidden={keyboardOpen}
      onTouchMove={(event) => event.stopPropagation()}
      style={keyboardOpen ? { visibility: "hidden" } : undefined}
    >
      {voiceHint && (
        <div
          className="pointer-events-none absolute inset-x-0 flex items-center justify-center px-2"
          style={{ bottom: voiceStatusOffset }}
        >
          <div className="inline-flex max-w-full items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-lg backdrop-blur-md">
            <span
              className={`size-2 rounded-full ${
                voiceStatus === "listening"
                  ? "bg-red-500 animate-pulse"
                  : voiceStatus === "stopping"
                    ? "bg-emerald-500 animate-pulse"
                    : "bg-amber-500 animate-pulse"
              }`}
            />
            <span>{voiceHint}</span>
            <div className="flex h-4 items-end gap-0.5" aria-hidden="true">
              {waveform.map((level, index) => (
                <span
                  key={index}
                  className={`w-1 rounded-full transition-[height,opacity] duration-75 ${
                    voiceStatus === "stopping" ? "bg-emerald-500/70" : "bg-red-500/80"
                  }`}
                  style={{
                    height: `${Math.max(4, Math.round(level * 16))}px`,
                    opacity: voiceStatus === "listening" ? 0.45 + level * 0.55 : 0.55,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {moreOpen && (
          <div className="pointer-events-auto grid grid-cols-5 gap-1.5 rounded-lg border bg-card/95 p-1.5 shadow-lg backdrop-blur-md">
            <Button size="xs" variant="secondary" className={toolbarButtonClassName} onClick={() => send("\x1b[A")}>
              <ChevronUpIcon className="size-3.5" />
            </Button>
            <Button size="xs" variant="secondary" className={toolbarButtonClassName} onClick={() => send("\x1b[D")}>
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <Button size="xs" variant="secondary" className={toolbarButtonClassName} onClick={() => send("\x1b[B")}>
              <ChevronDownIcon className="size-3.5" />
            </Button>
            <Button size="xs" variant="secondary" className={toolbarButtonClassName} onClick={() => send("\x1b[C")}>
              <ChevronRightIcon className="size-3.5" />
            </Button>
            <Button
              size="xs"
              variant={textOverlayOpen ? "default" : "secondary"}
              className={toolbarButtonClassName}
              onClick={onToggleTextOverlay}
              aria-label="Show terminal text"
            >
              <TextIcon className="size-3.5" />
            </Button>
          </div>
        )}

        <div className="pointer-events-auto grid grid-cols-5 gap-1.5 rounded-lg border bg-card/95 p-1.5 shadow-lg backdrop-blur-md">
          <Button
            size="xs"
            variant="secondary"
            className={toolbarButtonClassName}
            onClick={() => send("\x1b")}
            aria-label="Escape"
          >
            <XIcon className="size-3.5" />
          </Button>
          <Button
            size="xs"
            variant="secondary"
            className={toolbarButtonClassName}
            onClick={() => send("\t")}
            aria-label="Tab"
          >
            <ArrowRightToLineIcon className="size-3.5" />
          </Button>
          <Button
            size="xs"
            variant="secondary"
            className={toolbarButtonClassName}
            onClick={() => send("\r")}
            aria-label="Enter"
          >
            <CornerDownLeftIcon className="size-3.5" />
          </Button>
          <Button
            size="xs"
            variant={isListening ? "destructive" : "secondary"}
            className={toolbarButtonClassName}
            onClick={toggleVoice}
            disabled={isVoiceBusy}
            aria-label={
              voiceStatus === "stopping"
                ? "Finishing voice input"
                : isListening
                  ? "Stop voice input"
                  : "Start voice input"
            }
          >
            {isListening ? (
              <MicOffIcon className={voiceStatus === "stopping" ? "size-3.5 animate-pulse" : "size-3.5"} />
            ) : (
              <MicIcon className={voiceStatus === "connecting" ? "size-3.5 animate-pulse" : "size-3.5"} />
            )}
          </Button>
          <Button
            size="xs"
            variant={moreOpen ? "default" : "secondary"}
            className={toolbarButtonClassName}
            onClick={() => setMoreOpen((current) => !current)}
            aria-label="More controls"
          >
            <EllipsisIcon className="size-3.5" />
          </Button>
        </div>
      </div>
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

export function Terminal({
  terminalId,
  isActive,
  onSwipeNavigate,
}: {
  terminalId: string;
  isActive?: boolean;
  onSwipeNavigate?: (dir: -1 | 1) => void;
}) {
  const isMobile = useIsMobile();
  const { keyboardInset, keyboardOpen } = useMobileKeyboard();
  const containerRef = useRef<HTMLDivElement>(null);
  const isActiveRef = useRef(Boolean(isActive));
  const isMobileRef = useRef(isMobile);
  const onSwipeNavigateRef = useRef(onSwipeNavigate);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const attachedRef = useRef(false);
  const lastSeqRef = useRef(0);
  const pendingChunksRef = useRef<Map<number, string>>(new Map());
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const mobileCompositionActiveRef = useRef(false);
  const [textOverlay, setTextOverlay] = useState<string | null>(null);
  const [mobileComposingText, setMobileComposingText] = useState("");
  const [mobileInputPreview, setMobileInputPreview] = useState("");

  useLayoutEffect(() => {
    setTextOverlay(null);
    mobileCompositionActiveRef.current = false;
    setMobileComposingText("");
    setMobileInputPreview("");
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
    isActiveRef.current = Boolean(isActive);
    if (!isActive) {
      shouldRestoreFocusRef.current = false;
      mobileCompositionActiveRef.current = false;
      setMobileComposingText("");
      setMobileInputPreview("");
    }
  }, [isActive]);

  useEffect(() => {
    isMobileRef.current = isMobile;
    if (termRef.current) {
      termRef.current.options.disableStdin = false;
    }
    if (isMobile) {
      shouldRestoreFocusRef.current = false;
    }
  }, [isMobile]);

  useEffect(() => {
    onSwipeNavigateRef.current = onSwipeNavigate;
  }, [onSwipeNavigate]);

  const sendToTerminal = useCallback(
    (data: string) => {
      if (isMobileRef.current) {
        setMobileInputPreview((current) => applyMobilePreviewInput(current, data));
      }
      socketRef.current?.emit("terminal:input", { terminalId, data });
    },
    [terminalId]
  );

  const handleVoiceTranscript = useCallback(
    (text: string) => {
      const transcript = text.trim();
      if (!transcript) return;
      sendToTerminal(`${transcript}\r`);
    },
    [sendToTerminal]
  );

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
        scrollback: 50000,
        convertEol: false,
        disableStdin: false,
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
      let touchStartX = 0;
      let touchStartY = 0;
      let lastTouchY = 0;
      let touchAccum = 0;
      let didScroll = false;
      let swipeTriggered = false;
      let gestureAxis: "pending" | "horizontal" | "vertical" = "pending";
      const container = containerRef.current;
      const gestureLockThreshold = 16;
      const swipeTriggerThreshold = 56;

      const lineHeight = term.rows > 0
        ? container.clientHeight / term.rows
        : 16;

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        lastTouchY = e.touches[0].clientY;
        touchAccum = 0;
        didScroll = false;
        swipeTriggered = false;
        gestureAxis = "pending";
      };

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const totalDx = touch.clientX - touchStartX;
        const totalDy = touch.clientY - touchStartY;
        const absDx = Math.abs(totalDx);
        const absDy = Math.abs(totalDy);

        if (
          gestureAxis === "pending" &&
          (absDx >= gestureLockThreshold || absDy >= gestureLockThreshold)
        ) {
          if (absDx > absDy * 1.25) {
            gestureAxis = "horizontal";
          } else if (absDy > absDx * 1.25) {
            gestureAxis = "vertical";
            touchAccum += touchStartY - touch.clientY;
            lastTouchY = touch.clientY;
          }
        }

        if (gestureAxis === "horizontal") {
          if (
            !swipeTriggered &&
            absDx >= swipeTriggerThreshold &&
            absDx > absDy * 1.25 &&
            isMobileRef.current &&
            isActiveRef.current
          ) {
            swipeTriggered = true;
            onSwipeNavigateRef.current?.(totalDx < 0 ? 1 : -1);
          }
          e.preventDefault();
          return;
        }

        if (gestureAxis !== "vertical") {
          return;
        }

        const dy = lastTouchY - touch.clientY;
        lastTouchY = touch.clientY;
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
        if (swipeTriggered || didScroll) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        shouldRestoreFocusRef.current = isActiveRef.current;
        term.focus();
        requestAnimationFrame(() => fitAddon.fit());
      };

      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      container.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(container);

      let attachRequestId = 0;
      let cleanedUp = false;

      const socket = getSocket();
      socketRef.current = socket;
      const storedSnapshot = loadStoredSnapshot(terminalId);

      const persistSnapshot = () => {
        const snapshot: LocalTerminalSnapshot = {
          terminalId,
          cursor: lastSeqRef.current,
          data: serializeAddon.serialize(),
          savedAt: Date.now(),
        };

        storeSnapshot(terminalId, {
          cursor: snapshot.cursor,
          data: snapshot.data,
          savedAt: snapshot.savedAt,
        });
      };

      const schedulePersistSnapshot = () => {
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
        }
        persistTimerRef.current = setTimeout(() => {
          persistTimerRef.current = null;
          persistSnapshot();
        }, SNAPSHOT_PERSIST_DELAY_MS);
      };

      const rememberTerminalFocus = () => {
        if (isMobileRef.current || !isActiveRef.current) {
          shouldRestoreFocusRef.current = false;
          return;
        }
        shouldRestoreFocusRef.current = container.contains(document.activeElement);
      };

      const restoreTerminalFocus = () => {
        if (isMobileRef.current || !isActiveRef.current || !shouldRestoreFocusRef.current) {
          return;
        }

        const activeElement = document.activeElement;
        if (isEditableElement(activeElement) && !container.contains(activeElement)) {
          return;
        }

        requestAnimationFrame(() => {
          if (cancelled || cleanedUp || isMobileRef.current || !isActiveRef.current) {
            return;
          }
          term.focus();
        });
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
        if (isMobileRef.current) {
          setMobileInputPreview((current) => applyMobilePreviewInput(current, data));
        }
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
        if (isMobileRef.current) {
          return;
        }
        shouldRestoreFocusRef.current = isActiveRef.current;
        term.focus();
        requestAnimationFrame(() => fitAddon.fit());
      };
      container.addEventListener("pointerdown", onPointerDown);

      const helperTextarea =
        term.textarea ??
        container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");

      const syncComposingText = (value?: string | null) => {
        if (!isMobileRef.current || !mobileCompositionActiveRef.current) return;
        setMobileComposingText(value ?? helperTextarea?.value ?? "");
      };

      const onTerminalFocus = () => {
        shouldRestoreFocusRef.current = isActiveRef.current;
      };

      const onTerminalBlur = () => {
        if (document.visibilityState === "hidden") {
          return;
        }
        mobileCompositionActiveRef.current = false;
        setMobileComposingText("");
        if (!container.contains(document.activeElement)) {
          shouldRestoreFocusRef.current = false;
        }
      };

      const onHelperInput = () => {
        if (!mobileCompositionActiveRef.current) {
          return;
        }
        syncComposingText(helperTextarea?.value);
      };

      const onCompositionStart = () => {
        mobileCompositionActiveRef.current = true;
        setMobileComposingText("");
      };

      const onCompositionUpdate = (event: CompositionEvent) => {
        syncComposingText(event.data);
      };

      const onCompositionEnd = () => {
        mobileCompositionActiveRef.current = false;
        setMobileComposingText("");
      };

      helperTextarea?.addEventListener("focus", onTerminalFocus);
      helperTextarea?.addEventListener("blur", onTerminalBlur);
      helperTextarea?.addEventListener("input", onHelperInput);
      helperTextarea?.addEventListener("compositionstart", onCompositionStart);
      helperTextarea?.addEventListener("compositionupdate", onCompositionUpdate);
      helperTextarea?.addEventListener("compositionend", onCompositionEnd);

      const attachTerminal = async () => {
        const requestedCursor = lastSeqRef.current;
        const requestId = ++attachRequestId;

        try {
          const attachment = await new Promise<TerminalAttachResponse>((resolve, reject) => {
            socket.emit(
              "terminal:attach",
              { terminalId, cursor: requestedCursor },
              (payload: unknown) => {
                try {
                  resolve(TerminalAttachResponseSchema.parse(payload));
                } catch (error) {
                  reject(error);
                }
              }
            );
          });

          if (cancelled || cleanedUp || requestId !== attachRequestId) {
            return;
          }

          if (attachment.mode === "snapshot") {
            if (requestedCursor === 0 || attachment.cursor > requestedCursor) {
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
          restoreTerminalFocus();

          socket.emit("terminal:resize", {
            terminalId,
            cols: term.cols,
            rows: term.rows,
          });
        } catch {
          // Ignore
        }
      };

      const onPageHide = () => {
        rememberTerminalFocus();
        persistSnapshot();
      };
      window.addEventListener("pagehide", onPageHide);

      const resumeTerminal = () => {
        if (cancelled || cleanedUp) return;
        if (document.visibilityState === "hidden") return;
        requestAnimationFrame(() => fitAddon.fit());
        if (socket.connected) {
          restoreTerminalFocus();
          void attachTerminal();
          return;
        }
        socket.connect();
      };

      const onSocketConnect = () => {
        void attachTerminal();
      };

      const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          rememberTerminalFocus();
          return;
        }
        resumeTerminal();
      };

      const onWindowBlur = () => {
        rememberTerminalFocus();
      };

      const onWindowFocus = () => {
        resumeTerminal();
      };

      socket.on("connect", onSocketConnect);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("blur", onWindowBlur);
      window.addEventListener("focus", onWindowFocus);

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        persistSnapshot();
        resizeObserver.disconnect();
        window.removeEventListener("pagehide", onPageHide);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("focus", onWindowFocus);
        container.removeEventListener("pointerdown", onPointerDown);
        helperTextarea?.removeEventListener("focus", onTerminalFocus);
        helperTextarea?.removeEventListener("blur", onTerminalBlur);
        helperTextarea?.removeEventListener("input", onHelperInput);
        helperTextarea?.removeEventListener("compositionstart", onCompositionStart);
        helperTextarea?.removeEventListener("compositionupdate", onCompositionUpdate);
        helperTextarea?.removeEventListener("compositionend", onCompositionEnd);
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
        socket.off("connect", onSocketConnect);
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

      await attachTerminal();

      if (cancelled) {
        cleanup();
        return;
      }
    })();

    return () => {
      cancelled = true;
      disposeTerminal?.();
    };
  }, [terminalId]);

  // Refit when the active terminal changes and the mobile controls mount/unmount.
  useEffect(() => {
    const id = setTimeout(() => fitAddonRef.current?.fit(), 50);
    return () => clearTimeout(id);
  }, [isActive]);

  const handleShowText = useCallback(() => {
    if (termRef.current) {
      setTextOverlay(extractBufferText(termRef.current));
    }
  }, []);

  const handleToggleTextOverlay = useCallback(() => {
    if (textOverlay !== null) {
      setTextOverlay(null);
      return;
    }
    handleShowText();
  }, [handleShowText, textOverlay]);

  const mobilePreviewValue = mobileComposingText
    ? trimPreview(`${mobileInputPreview}${mobileComposingText}`)
    : mobileInputPreview;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={containerRef} className="w-full min-h-0 flex-1 touch-none pt-1" />

      {isActive && isMobile && keyboardOpen && (
        <div
          className="pointer-events-none absolute inset-x-0 z-[100] px-2"
          style={{ bottom: `${keyboardInset + 8}px` }}
        >
          <textarea
            readOnly
            value={mobilePreviewValue}
            placeholder="Typing preview"
            aria-label="Typing preview"
            className="h-14 w-full resize-none rounded-lg border border-border bg-card/95 px-3 py-2 font-mono text-xs leading-relaxed text-foreground shadow-lg backdrop-blur-sm placeholder:text-muted-foreground"
          />
        </div>
      )}

      {textOverlay !== null && (
        <div className="absolute inset-0 z-[110] flex flex-col bg-background">
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
        <MobileTerminalControls
          onToggleTextOverlay={handleToggleTextOverlay}
          onTranscript={handleVoiceTranscript}
          send={sendToTerminal}
          textOverlayOpen={textOverlay !== null}
        />
      )}
    </div>
  );
}
