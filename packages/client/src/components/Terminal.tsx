"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent as ReactFormEvent,
} from "react";
import { getSocket, subscribeToTerminalOutput } from "@/lib/socket";
import { useDeepgram } from "@/hooks/use-deepgram";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  ArrowRightToLineIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClipboardIcon,
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
import { toast } from "sonner";
function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
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

function skipAnsiSequence(data: string, startIndex: number): number {
  const nextChar = data[startIndex + 1];
  if (!nextChar) return startIndex;

  // CSI: ESC [ ... final-byte
  if (nextChar === "[") {
    let index = startIndex + 2;
    while (index < data.length) {
      const char = data[index];
      if (char && char >= "@" && char <= "~") {
        return index;
      }
      index += 1;
    }
    return data.length - 1;
  }

  // OSC: ESC ] ... BEL or ST
  if (nextChar === "]") {
    let index = startIndex + 2;
    while (index < data.length) {
      const char = data[index];
      if (char === "\u0007") {
        return index;
      }
      if (char === "\x1b" && data[index + 1] === "\\") {
        return index + 1;
      }
      index += 1;
    }
    return data.length - 1;
  }

  // DCS, SOS, PM, APC: ESC P/X/^/_ ... ST
  if (nextChar === "P" || nextChar === "X" || nextChar === "^" || nextChar === "_") {
    let index = startIndex + 2;
    while (index < data.length) {
      if (data[index] === "\x1b" && data[index + 1] === "\\") {
        return index + 1;
      }
      index += 1;
    }
    return data.length - 1;
  }

  // Two-byte ESC sequences such as ESC O A for application cursor keys.
  if (nextChar === "O" && startIndex + 2 < data.length) {
    return startIndex + 2;
  }

  return startIndex + 1;
}

function applyMobilePreviewInput(currentPreview: string, data: string): string {
  let nextPreview = currentPreview;

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];

    if (!char) continue;

    if (char === "\x1b") {
      index = skipAnsiSequence(data, index);
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

function mapBeforeInputToTerminalData(event: InputEvent): string | null {
  switch (event.inputType) {
    case "insertText":
    case "insertCompositionText":
    case "insertReplacementText":
      return event.data ?? "";
    case "insertParagraph":
    case "insertLineBreak":
      return "\r";
    case "deleteContentBackward":
      return "\u007f";
    case "deleteWordBackward":
      return "\u0017";
    case "deleteHardLineBackward":
    case "deleteSoftLineBackward":
      return "\u0015";
    case "deleteContentForward":
      return "\x1b[3~";
    case "insertTab":
      return "\t";
    default:
      return null;
  }
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

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.error("Clipboard is empty.");
        return;
      }
      send(text);
    } catch {
      toast.error("Clipboard paste is unavailable in this browser.");
    }
  }, [send]);

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
      className="shrink-0 flex flex-col gap-2 px-2 pb-[calc(env(safe-area-inset-bottom)+0.1rem)] pt-2"
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

        <div className="pointer-events-auto grid grid-cols-6 gap-1.5 rounded-lg border bg-card/95 p-1.5 shadow-lg backdrop-blur-md">
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
            onClick={handlePasteFromClipboard}
            aria-label="Paste clipboard"
          >
            <ClipboardIcon className="size-3.5" />
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
  registerRefit,
}: {
  terminalId: string;
  isActive?: boolean;
  onSwipeNavigate?: (dir: -1 | 1) => void;
  registerRefit?: ((refit: (() => void) | null) => void) | null;
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
  const resizeEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const lastEmittedSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const mobileCompositionActiveRef = useRef(false);
  const [textOverlay, setTextOverlay] = useState<string | null>(null);
  const [mobileComposingText, setMobileComposingText] = useState("");
  const [mobileInputPreview, setMobileInputPreview] = useState("");
  const mobileInputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastHandledMobileInputRef = useRef<string | null>(null);

  const blurMobileInput = useCallback(() => {
    requestAnimationFrame(() => {
      mobileInputRef.current?.blur();
    });
  }, []);

  useLayoutEffect(() => {
    setTextOverlay(null);
    mobileCompositionActiveRef.current = false;
    setMobileComposingText("");
    setMobileInputPreview("");
    attachedRef.current = false;
    lastSeqRef.current = 0;
    pendingChunksRef.current.clear();
    if (resizeEmitTimerRef.current) {
      clearTimeout(resizeEmitTimerRef.current);
      resizeEmitTimerRef.current = null;
    }
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = null;
    }
    lastEmittedSizeRef.current = null;
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

  const scheduleFit = useCallback(() => {
    if (fitFrameRef.current !== null) {
      return;
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;
      fitAddonRef.current?.fit();
    });
  }, []);

  const emitTerminalResize = useCallback(() => {
    const term = termRef.current;
    const socket = socketRef.current;
    if (!term || !socket) {
      return;
    }

    const nextSize = { cols: term.cols, rows: term.rows };
    const lastSize = lastEmittedSizeRef.current;
    if (lastSize && lastSize.cols === nextSize.cols && lastSize.rows === nextSize.rows) {
      return;
    }

    socket.emit("terminal:resize", {
      terminalId,
      cols: nextSize.cols,
      rows: nextSize.rows,
    });
    lastEmittedSizeRef.current = nextSize;
  }, [terminalId]);

  const scheduleResizeEmit = useCallback(() => {
    if (resizeEmitTimerRef.current) {
      clearTimeout(resizeEmitTimerRef.current);
    }

    resizeEmitTimerRef.current = setTimeout(() => {
      resizeEmitTimerRef.current = null;
      emitTerminalResize();
    }, 80);
  }, [emitTerminalResize]);

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
        scrollback: 10000,
        convertEol: false,
        disableStdin: false,
      });

      term.loadAddon(fitAddon);
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

        const lineHeight = term.rows > 0 ? container.clientHeight / term.rows : 16;
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
        scheduleFit();
      };

      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      container.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });

      const resizeObserver = new ResizeObserver(() => {
        scheduleFit();
        scheduleResizeEmit();
      });
      resizeObserver.observe(container);

      let attachRequestId = 0;
      let cleanedUp = false;

      const socket = getSocket();
      socketRef.current = socket;

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
          if (data.includes("\r")) {
            requestAnimationFrame(() => {
              helperTextarea?.blur();
              mobileInputRef.current?.blur();
            });
          }
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
      });

      const onPointerDown = () => {
        if (isMobileRef.current) {
          return;
        }
        shouldRestoreFocusRef.current = isActiveRef.current;
        term.focus();
        scheduleFit();
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
              scheduleFit();
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
          scheduleFit();
          restoreTerminalFocus();
          scheduleResizeEmit();
        } catch {
          // Ignore
        }
      };

      const resumeTerminal = () => {
        if (cancelled || cleanedUp) return;
        if (document.visibilityState === "hidden") return;
        scheduleFit();
        if (socket.connected) {
          restoreTerminalFocus();
          if (!attachedRef.current) {
            void attachTerminal();
          } else {
            scheduleResizeEmit();
          }
          return;
        }
        socket.connect();
      };

      const onSocketConnect = () => {
        void attachTerminal();
      };

      const onSocketDisconnect = () => {
        attachedRef.current = false;
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
      socket.on("disconnect", onSocketDisconnect);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("blur", onWindowBlur);
      window.addEventListener("focus", onWindowFocus);
      const unsubscribeTerminalOutput = subscribeToTerminalOutput(
        terminalId,
        handleOutput
      );

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (resizeEmitTimerRef.current) {
          clearTimeout(resizeEmitTimerRef.current);
          resizeEmitTimerRef.current = null;
        }
        if (fitFrameRef.current !== null) {
          cancelAnimationFrame(fitFrameRef.current);
          fitFrameRef.current = null;
        }
        resizeObserver.disconnect();
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
        socket.off("disconnect", onSocketDisconnect);
        unsubscribeTerminalOutput();
        socket.emit("terminal:unsubscribe", { terminalId });
        term.dispose();
        container.replaceChildren();
        attachedRef.current = false;
        pendingChunksRef.current.clear();
        termRef.current = null;
        fitAddonRef.current = null;
        socketRef.current = null;
        lastEmittedSizeRef.current = null;
      };

      disposeTerminal = cleanup;

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
  }, [scheduleFit, scheduleResizeEmit, terminalId]);

  // Refit when the active terminal changes and the mobile controls mount/unmount.
  useEffect(() => {
    const id = setTimeout(() => {
      scheduleFit();
      scheduleResizeEmit();
    }, 50);
    return () => clearTimeout(id);
  }, [isActive, scheduleFit, scheduleResizeEmit]);

  useEffect(() => {
    const refit = () => {
      scheduleFit();
      scheduleResizeEmit();
    };

    registerRefit?.(refit);
    return () => registerRefit?.(null);
  }, [registerRefit, scheduleFit, scheduleResizeEmit]);

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

  const processMobileTextareaInput = useCallback(
    (nativeEvent: InputEvent, preventDefault?: () => void) => {
      const data = mapBeforeInputToTerminalData(nativeEvent);
      if (!data) {
        return;
      }

      const inputKey = `${nativeEvent.inputType}:${nativeEvent.data ?? ""}:${nativeEvent.isComposing ? "1" : "0"}`;
      if (lastHandledMobileInputRef.current === inputKey) {
        lastHandledMobileInputRef.current = null;
        return;
      }

      lastHandledMobileInputRef.current = inputKey;
      preventDefault?.();
      sendToTerminal(data);
      if (data === "\r") {
        blurMobileInput();
      }
    },
    [blurMobileInput, sendToTerminal]
  );

  const handleMobileTextareaBeforeInput = useCallback(
    (event: ReactFormEvent<HTMLTextAreaElement>) => {
      processMobileTextareaInput(event.nativeEvent as InputEvent, () => event.preventDefault());
    },
    [processMobileTextareaInput]
  );

  const handleMobileTextareaInput = useCallback(
    (event: ReactFormEvent<HTMLTextAreaElement>) => {
      processMobileTextareaInput(event.nativeEvent as InputEvent);
    },
    [processMobileTextareaInput]
  );

  const handleMobileTextareaPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const text = event.clipboardData.getData("text");
      if (!text) return;
      event.preventDefault();
      sendToTerminal(text);
    },
    [sendToTerminal]
  );

  const handleMobileTextareaCompositionStart = useCallback(() => {
    mobileCompositionActiveRef.current = true;
    setMobileComposingText("");
  }, []);

  const handleMobileTextareaCompositionUpdate = useCallback(
    (event: React.CompositionEvent<HTMLTextAreaElement>) => {
      setMobileComposingText(event.data ?? "");
    },
    []
  );

  const handleMobileTextareaCompositionEnd = useCallback(() => {
    mobileCompositionActiveRef.current = false;
    setMobileComposingText("");
    requestAnimationFrame(() => {
      const element = mobileInputRef.current;
      if (element) {
        element.selectionStart = element.value.length;
        element.selectionEnd = element.value.length;
      }
    });
  }, []);

  useLayoutEffect(() => {
    const element = mobileInputRef.current;
    if (!element) {
      return;
    }

    const computedStyle = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 10;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const borderTop = Number.parseFloat(computedStyle.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(computedStyle.borderBottomWidth) || 0;
    const minHeight = lineHeight * 2 + paddingTop + paddingBottom + borderTop + borderBottom;

    element.style.height = `${minHeight}px`;
    element.style.height = `${Math.max(minHeight, element.scrollHeight)}px`;
    element.scrollTop = element.scrollHeight;
    element.selectionStart = element.value.length;
    element.selectionEnd = element.value.length;
  }, [mobilePreviewValue, keyboardOpen]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={containerRef} className="w-full min-h-0 flex-1 touch-none pt-1" />

      {isActive && isMobile && keyboardOpen && (
        <div
          className="pointer-events-none absolute inset-x-0 z-[100]"
          style={{ bottom: `${keyboardInset + 4}px` }}
        >
          <div className="pointer-events-auto border-y border-border bg-muted px-4 py-4 shadow-lg">
            <textarea
              ref={mobileInputRef}
              value={mobilePreviewValue}
              placeholder="Type or paste into terminal"
              aria-label="Terminal input"
              rows={2}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              enterKeyHint="send"
              onBeforeInput={handleMobileTextareaBeforeInput}
              onInput={handleMobileTextareaInput}
              onPaste={handleMobileTextareaPaste}
              onCompositionStart={handleMobileTextareaCompositionStart}
              onCompositionUpdate={handleMobileTextareaCompositionUpdate}
              onCompositionEnd={handleMobileTextareaCompositionEnd}
              onChange={() => {
                // Controlled bridge input: terminal writes are handled in beforeinput/paste.
              }}
              className="min-h-[2.75rem] w-full resize-none border-0 bg-transparent p-0 font-mono leading-tight text-foreground outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground"
              style={{ fontSize: "10px", lineHeight: 1.05 }}
            />
          </div>
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
