import type { Server as SocketServer, Socket } from "socket.io";
import { ClientEvents } from "@maestro/wire";
import { sendInput, resizeAgent } from "../agents/agent-manager.js";
import { sendSetupInput, resizeSetupPty, getSetupOutputBuffer, isSetupDone, startSetupPty, isSetupRunning } from "../setup/setup-manager.js";

export function registerSocketHandlers(io: SocketServer) {
  io.on("connection", (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Subscribe to agent output stream
    socket.on("agent:subscribe", (data) => {
      try {
        const { agentId } = ClientEvents["agent:subscribe"].parse(data);
        socket.join(`agent:${agentId}`);
        console.log(`Client ${socket.id} subscribed to agent ${agentId}`);
      } catch {
        socket.emit("error", { message: "Invalid subscribe payload" });
      }
    });

    // Unsubscribe from agent output stream
    socket.on("agent:unsubscribe", (data) => {
      try {
        const { agentId } = ClientEvents["agent:unsubscribe"].parse(data);
        socket.leave(`agent:${agentId}`);
      } catch {
        socket.emit("error", { message: "Invalid unsubscribe payload" });
      }
    });

    // Forward keyboard input to agent PTY
    socket.on("agent:input", (data) => {
      try {
        const { agentId, data: inputData } =
          ClientEvents["agent:input"].parse(data);
        sendInput(agentId, inputData);
      } catch {
        socket.emit("error", { message: "Invalid input payload" });
      }
    });

    // Resize agent terminal
    socket.on("agent:resize", (data) => {
      try {
        const { agentId, cols, rows } =
          ClientEvents["agent:resize"].parse(data);
        resizeAgent(agentId, cols, rows);
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
