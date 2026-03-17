"use client";

import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";

export type DeepgramStatus = "idle" | "connecting" | "listening" | "error";

interface UseDeepgramOptions {
  onTranscript: (text: string) => void;
  language?: string;
}

export function useDeepgram({ onTranscript, language }: UseDeepgramOptions) {
  const [status, setStatus] = useState<DeepgramStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    mediaRef.current?.stop();
    mediaRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (wsRef.current) {
      stop();
      return;
    }

    setStatus("connecting");

    let apiKey: string;
    try {
      const res = await api.getDeepgramKey();
      apiKey = res.apiKey;
    } catch {
      setStatus("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch {
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
        if (transcript && data.is_final) {
          onTranscript(transcript);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      stop();
      setStatus("error");
    };

    ws.onclose = () => {
      if (mediaRef.current) {
        mediaRef.current.stop();
        mediaRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      wsRef.current = null;
      setStatus("idle");
    };
  }, [onTranscript, language, stop]);

  const toggle = useCallback(() => {
    if (wsRef.current) {
      // Send close signal to Deepgram to get final transcript
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
      }
      stop();
    } else {
      void start();
    }
  }, [start, stop]);

  return { status, toggle, stop };
}
