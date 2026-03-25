import type { Server as SocketServer, Socket } from "socket.io";
import { ClientEvents, TerminalAttachResponse } from "@maestro/wire";
import {
  getTerminalAttachment,
  getBufferedTerminalOutputSince,
  persistTerminalSnapshot,
  sendTerminalInput,
  resizeTerminal,
} from "../agents/terminal-manager.js";
import { sendSetupInput, resizeSetupPty, getSetupOutputBuffer, isSetupDone, startSetupPty, isSetupRunning, resetSetup } from "../setup/setup-manager.js";

export function registerSocketHandlers(io: SocketServer) {
  io.on("connection", (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on("terminal:attach", (data, respond?: (payload: TerminalAttachResponse) => void) => {
      try {
        const { terminalId, cursor } = ClientEvents["terminal:attach"].parse(data);
        socket.join(`terminal:${terminalId}`);
        respond?.(TerminalAttachResponse.parse(getTerminalAttachment(terminalId, cursor)));
        console.log(`Client ${socket.id} attached to terminal ${terminalId}`);
      } catch {
        socket.emit("error", { message: "Invalid attach payload" });
      }
    });

    // Subscribe to terminal output stream
    socket.on("terminal:subscribe", (data) => {
      try {
        const { terminalId, sinceSeq } = ClientEvents["terminal:subscribe"].parse(data);
        socket.join(`terminal:${terminalId}`);

        if (sinceSeq !== undefined) {
          for (const chunk of getBufferedTerminalOutputSince(terminalId, sinceSeq)) {
            socket.emit("terminal:output", {
              terminalId,
              data: chunk.data,
              seq: chunk.seq,
            });
          }
        }

        console.log(`Client ${socket.id} subscribed to terminal ${terminalId}`);
      } catch {
        socket.emit("error", { message: "Invalid subscribe payload" });
      }
    });

    // Unsubscribe from terminal output stream
    socket.on("terminal:unsubscribe", (data) => {
      try {
        const { terminalId } = ClientEvents["terminal:unsubscribe"].parse(data);
        socket.leave(`terminal:${terminalId}`);
      } catch {
        socket.emit("error", { message: "Invalid unsubscribe payload" });
      }
    });

    socket.on("terminal:snapshot", (data) => {
      try {
        const { terminalId, ...snapshot } = ClientEvents["terminal:snapshot"].parse(data);
        persistTerminalSnapshot(terminalId, snapshot);
      } catch {
        socket.emit("error", { message: "Invalid snapshot payload" });
      }
    });

    // Forward keyboard input to terminal PTY
    socket.on("terminal:input", (data) => {
      try {
        const { terminalId, data: inputData } =
          ClientEvents["terminal:input"].parse(data);
        sendTerminalInput(terminalId, inputData);
      } catch {
        socket.emit("error", { message: "Invalid input payload" });
      }
    });

    // Resize terminal viewport
    socket.on("terminal:resize", (data) => {
      try {
        const { terminalId, cols, rows } =
          ClientEvents["terminal:resize"].parse(data);
        resizeTerminal(terminalId, cols, rows);
      } catch {
        socket.emit("error", { message: "Invalid resize payload" });
      }
    });

    // Setup terminal handlers
    socket.on("setup:subscribe", (data) => {
      socket.join("setup");
      console.log(`Client ${socket.id} subscribed to setup`);

      // If PTY is already running or done, replay buffered output
      const buffer = getSetupOutputBuffer();
      if (buffer.length > 0) {
        for (const chunk of buffer) {
          socket.emit("setup:output", { data: chunk });
        }
      }
      if (isSetupDone()) {
        socket.emit("setup:complete", {});
      }

      // Auto-start PTY if not already running/done, using client dimensions
      if (!isSetupRunning() && !isSetupDone()) {
        const cols = (data as { cols?: number })?.cols;
        const rows = (data as { rows?: number })?.rows;
        startSetupPty(io, cols, rows);
      }
    });

    socket.on("setup:unsubscribe", () => {
      socket.leave("setup");
    });

    socket.on("setup:input", (data) => {
      try {
        const { data: inputData } = ClientEvents["setup:input"].parse(data);
        sendSetupInput(inputData);
      } catch {
        socket.emit("error", { message: "Invalid setup input payload" });
      }
    });

    socket.on("setup:resize", (data) => {
      try {
        const { cols, rows } = ClientEvents["setup:resize"].parse(data);
        resizeSetupPty(cols, rows);
      } catch {
        socket.emit("error", { message: "Invalid setup resize payload" });
      }
    });

    socket.on("setup:restart", (data) => {
      try {
        const { cols, rows } = ClientEvents["setup:restart"].parse(data);
        console.log(`[setup] Restart requested by ${socket.id}`);
        resetSetup();
        startSetupPty(io, cols, rows);
      } catch {
        socket.emit("error", { message: "Invalid setup restart payload" });
      }
    });

    // WhatsApp handlers
    socket.on("whatsapp:subscribe", () => {
      socket.join("whatsapp");
      console.log(`Client ${socket.id} subscribed to whatsapp`);
    });

    socket.on("whatsapp:unsubscribe", () => {
      socket.leave("whatsapp");
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}
