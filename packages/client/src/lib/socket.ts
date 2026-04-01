"use client";

import { io, Socket } from "socket.io-client";
import { getAuthToken, getServerUrl } from "./auth";

let socket: Socket | null = null;
let socketKey: string | null = null;
let outputListenerAttached = false;

type TerminalOutputPayload = {
  terminalId: string;
  data: string;
  seq: number;
};

const terminalOutputSubscribers = new Map<
  string,
  Set<(payload: TerminalOutputPayload) => void>
>();

function handleTerminalOutput(payload: TerminalOutputPayload): void {
  const subscribers = terminalOutputSubscribers.get(payload.terminalId);
  if (!subscribers) {
    return;
  }

  for (const subscriber of subscribers) {
    subscriber(payload);
  }
}

function ensureSocketListeners(target: Socket): void {
  if (outputListenerAttached) {
    return;
  }

  target.on("terminal:output", handleTerminalOutput);
  outputListenerAttached = true;
}

export function getSocket(): Socket {
  const token = getAuthToken();
  const serverUrl = getServerUrl();
  const nextSocketKey = `${serverUrl}|${token ?? ""}`;

  if (!socket || socketKey !== nextSocketKey) {
    if (socket && outputListenerAttached) {
      socket.off("terminal:output", handleTerminalOutput);
      outputListenerAttached = false;
    }
    socket?.disconnect();
    socket = io(serverUrl, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth: token ? { token } : undefined,
    });
    socketKey = nextSocketKey;
  }

  ensureSocketListeners(socket);
  return socket;
}

export function subscribeToTerminalOutput(
  terminalId: string,
  listener: (payload: TerminalOutputPayload) => void
): () => void {
  const target = getSocket();
  ensureSocketListeners(target);

  let subscribers = terminalOutputSubscribers.get(terminalId);
  if (!subscribers) {
    subscribers = new Set();
    terminalOutputSubscribers.set(terminalId, subscribers);
  }
  subscribers.add(listener);

  return () => {
    const currentSubscribers = terminalOutputSubscribers.get(terminalId);
    if (!currentSubscribers) {
      return;
    }
    currentSubscribers.delete(listener);
    if (currentSubscribers.size === 0) {
      terminalOutputSubscribers.delete(terminalId);
    }
  };
}

export function reconnectSocket(): void {
  if (socket && outputListenerAttached) {
    socket.off("terminal:output", handleTerminalOutput);
    outputListenerAttached = false;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socketKey = null;
  getSocket();
}
