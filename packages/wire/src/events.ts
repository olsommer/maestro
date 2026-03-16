import { z } from "zod";
import { AgentStatus } from "./agent.js";
import { KanbanColumn } from "./kanban.js";

// Server -> Client events
export const ServerEvents = {
  "agent:output": z.object({
    agentId: z.string(),
    data: z.string(),
  }),
  "agent:status": z.object({
    agentId: z.string(),
    status: AgentStatus,
    error: z.string().nullable().optional(),
  }),
  "kanban:updated": z.object({
    taskId: z.string(),
    column: KanbanColumn.optional(),
    assignedAgentId: z.string().nullable().optional(),
  }),
  "setup:output": z.object({
    data: z.string(),
  }),
  "setup:complete": z.object({}),
  "setup:url": z.object({
    url: z.string(),
  }),
  "setup:clear-url": z.object({}),
  "whatsapp:message": z.object({
    message: z.object({
      id: z.string(),
      chatJid: z.string(),
      messageId: z.string(),
      direction: z.enum(["incoming", "outgoing"]),
      senderName: z.string().nullable(),
      body: z.string(),
      status: z.enum(["queued", "processing", "completed", "failed"]),
      responseText: z.string().nullable(),
      error: z.string().nullable(),
      createdAt: z.string(),
      processedAt: z.string().nullable(),
    }),
  }),
  "whatsapp:status": z.object({
    status: z.enum(["disconnected", "connecting", "qr_pending", "connected"]),
  }),
  "whatsapp:qr": z.object({
    qrCode: z.string(),
  }),
} as const;

// Client -> Server events
export const ClientEvents = {
  "agent:input": z.object({
    agentId: z.string(),
    data: z.string(),
  }),
  "agent:resize": z.object({
    agentId: z.string(),
    cols: z.number(),
    rows: z.number(),
  }),
  "agent:subscribe": z.object({
    agentId: z.string(),
  }),
  "agent:unsubscribe": z.object({
    agentId: z.string(),
  }),
  "setup:input": z.object({
    data: z.string(),
  }),
  "setup:resize": z.object({
    cols: z.number(),
    rows: z.number(),
  }),
  "setup:subscribe": z.object({
    cols: z.number().optional(),
    rows: z.number().optional(),
  }),
  "setup:unsubscribe": z.object({}),
  "setup:restart": z.object({
    cols: z.number().optional(),
    rows: z.number().optional(),
  }),
  "whatsapp:subscribe": z.object({}),
  "whatsapp:unsubscribe": z.object({}),
} as const;

export type ServerEventMap = {
  [K in keyof typeof ServerEvents]: z.infer<(typeof ServerEvents)[K]>;
};

export type ClientEventMap = {
  [K in keyof typeof ClientEvents]: z.infer<(typeof ClientEvents)[K]>;
};
