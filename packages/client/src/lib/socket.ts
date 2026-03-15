"use client";

import { io, Socket } from "socket.io-client";
import { getAuthToken, getServerUrl } from "./auth";

let socket: Socket | null = null;
let socketKey: string | null = null;

export function getSocket(): Socket {
  const token = getAuthToken();
  const serverUrl = getServerUrl();
  const nextSocketKey = `${serverUrl}|${token ?? ""}`;

  if (!socket || socketKey !== nextSocketKey) {
    socket?.disconnect();
    socket = io(serverUrl, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth: token ? { token } : undefined,
    });
    socketKey = nextSocketKey;
  }
  return socket;
}

export function reconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socketKey = null;
  getSocket();
}
