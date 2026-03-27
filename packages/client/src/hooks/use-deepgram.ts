"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type DeepgramStatus = "idle" | "connecting" | "listening" | "stopping" | "error";
const WAVEFORM_BAR_COUNT = 12;
const WAVEFORM_SAMPLE_INTERVAL_MS = 80;

interface UseDeepgramOptions {
  onTranscript: (text: string) => void;
  language?: string;
}

export function useDeepgram({ onTranscript, language }: UseDeepgramOptions) {
  const [status, setStatus] = useState<DeepgramStatus>("idle");
  const [waveform, setWaveform] = useState<number[]>(() => Array(WAVEFORM_BAR_COUNT).fill(0));
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveformTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const finalizedSegmentsRef = useRef<string[]>([]);
  const interimTranscriptRef = useRef("");
  const stoppingRef = useRef(false);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const resetTranscriptBuffer = useCallback(() => {
    finalizedSegmentsRef.current = [];
    interimTranscriptRef.current = "";
  }, []);

  const stopWaveformCapture = useCallback(() => {
    if (waveformTimerRef.current) {
      clearInterval(waveformTimerRef.current);
      waveformTimerRef.current = null;
    }

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    analyserRef.current = null;
    waveformBufferRef.current = null;
    setWaveform(Array(WAVEFORM_BAR_COUNT).fill(0));

    if (audioContext) {
      void audioContext.close().catch(() => {
        // Ignore close errors from torn-down contexts.
      });
    }
  }, []);

  const startWaveformCapture = useCallback(
    async (stream: MediaStream) => {
      stopWaveformCapture();

      const AudioContextClass =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        return;
      }

      try {
        const audioContext = new AudioContextClass();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        waveformBufferRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

        const sampleWaveform = () => {
          const currentAnalyser = analyserRef.current;
          const currentBuffer = waveformBufferRef.current;
          if (!currentAnalyser || !currentBuffer) {
            return;
          }

          currentAnalyser.getByteFrequencyData(currentBuffer);
          const nextWaveform = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
            const start = Math.floor((index * currentBuffer.length) / WAVEFORM_BAR_COUNT);
            const end = Math.max(
              start + 1,
              Math.floor(((index + 1) * currentBuffer.length) / WAVEFORM_BAR_COUNT)
            );

            let total = 0;
            for (let cursor = start; cursor < end; cursor += 1) {
              total += currentBuffer[cursor] ?? 0;
            }

            const average = total / (end - start) / 255;
            return Math.min(1, average * 1.8);
          });

          setWaveform(nextWaveform);
        };

        await audioContext.resume().catch(() => {
          // Ignore resume errors; sampling may still work on some browsers.
        });
        sampleWaveform();
        waveformTimerRef.current = setInterval(sampleWaveform, WAVEFORM_SAMPLE_INTERVAL_MS);
      } catch {
        stopWaveformCapture();
      }
    },
    [stopWaveformCapture]
  );

  const flushTranscript = useCallback(() => {
    const text = [...finalizedSegmentsRef.current, interimTranscriptRef.current]
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    resetTranscriptBuffer();
    if (text) {
      onTranscript(text);
    }
  }, [onTranscript, resetTranscriptBuffer]);

  const teardown = useCallback(
    (nextStatus: DeepgramStatus = "idle") => {
      clearStopTimer();
      stoppingRef.current = false;
      stopWaveformCapture();

      const recorder = mediaRef.current;
      mediaRef.current = null;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }

      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState < WebSocket.CLOSING) {
        ws.close();
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      setStatus(nextStatus);
    },
    [clearStopTimer, stopWaveformCapture]
  );

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) {
      teardown("idle");
      return;
    }

    if (stoppingRef.current) {
      return;
    }

    stoppingRef.current = true;
    setStatus("stopping");

    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
    mediaRef.current = null;

    clearStopTimer();
    stopTimerRef.current = setTimeout(() => {
      flushTranscript();
      teardown("idle");
    }, 1500);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CloseStream" }));
      return;
    }

    flushTranscript();
    teardown("idle");
  }, [clearStopTimer, flushTranscript, teardown]);

  const start = useCallback(async () => {
    if (wsRef.current) {
      stop();
      return;
    }

    clearStopTimer();
    resetTranscriptBuffer();
    stoppingRef.current = false;
    setStatus("connecting");

    let apiKey: string;
    try {
      const res = await api.getDeepgramKey();
      apiKey = res.apiKey;
    } catch {
      resetTranscriptBuffer();
      setStatus("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      void startWaveformCapture(stream);
    } catch {
      resetTranscriptBuffer();
      setStatus("error");
      return;
    }

    const lang = language || navigator.language?.split("-")[0] || "en";
    const params = new URLSearchParams({
      model: "nova-3",
      smart_format: "true",
      filler_words: "false",
      language: lang,
      punctuate: "true",
    });

    const ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${params.toString()}`,
      ["token", apiKey]
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("listening");

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      mediaRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      recorder.start(250); // Send audio chunks every 250ms
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (typeof transcript !== "string") {
          return;
        }

        const normalizedTranscript = transcript.trim();
        if (data.is_final) {
          if (normalizedTranscript) {
            finalizedSegmentsRef.current.push(normalizedTranscript);
          }
          interimTranscriptRef.current = "";
          return;
        }

        interimTranscriptRef.current = normalizedTranscript;
      } catch {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      if (!stoppingRef.current) {
        setStatus("error");
      }
    };

    ws.onclose = () => {
      flushTranscript();
      teardown("idle");
    };
  }, [clearStopTimer, flushTranscript, language, resetTranscriptBuffer, startWaveformCapture, stop, teardown]);

  const toggle = useCallback(() => {
    if (wsRef.current) {
      stop();
    } else {
      void start();
    }
  }, [start, stop]);

  useEffect(() => {
    return () => {
      teardown("idle");
    };
  }, [teardown]);

  return { status, toggle, stop, waveform };
}
