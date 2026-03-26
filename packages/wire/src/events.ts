import { z } from "zod";
import { AgentStatus } from "./agent";
import { KanbanColumn } from "./kanban";

export const TerminalOutputChunk = z.object({
  seq: z.number().int().nonnegative(),
  data: z.string(),
});

export const TerminalAttachResponse = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("snapshot"),
    terminalId: z.string(),
    output: z.array(z.string()),
    cursor: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal("replay"),
    terminalId: z.string(),
    chunks: z.array(TerminalOutputChunk),
    cursor: z.number().int().nonnegative(),
  }),
]);

// Server -> Client events
export const ServerEvents = {
  "terminal:output": z.object({
    terminalId: z.string(),
    ...TerminalOutputChunk.shape,
  }),
  "terminal:status": z.object({
    terminalId: z.string(),
    status: AgentStatus,
    error: z.string().nullable().optional(),
    recentInputs: z.array(z.string()).optional(),
  }),
  "kanban:updated": z.object({
    taskId: z.string(),
    column: KanbanColumn.optional(),
    assignedTerminalId: z.string().nullable().optional(),
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
  "telegram:message": z.object({
    message: z.object({
      id: z.string(),
      chatId: z.string(),
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
  "telegram:status": z.object({
    status: z.enum(["disconnected", "connecting", "connected", "error"]),
  }),
} as const;

// Client -> Server events
export const ClientEvents = {
  "terminal:input": z.object({
    terminalId: z.string(),
    data: z.string(),
  }),
  "terminal:resize": z.object({
    terminalId: z.string(),
    cols: z.number(),
    rows: z.number(),
  }),
  "terminal:attach": z.object({
    terminalId: z.string(),
    cursor: z.number().int().nonnegative().optional(),
  }),
  "terminal:subscribe": z.object({
    terminalId: z.string(),
    sinceSeq: z.number().int().nonnegative().optional(),
  }),
  "terminal:unsubscribe": z.object({
    terminalId: z.string(),
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
  "telegram:subscribe": z.object({}),
  "telegram:unsubscribe": z.object({}),
} as const;

export type ServerEventMap = {
  [K in keyof typeof ServerEvents]: z.infer<(typeof ServerEvents)[K]>;
};

export type ClientEventMap = {
  [K in keyof typeof ClientEvents]: z.infer<(typeof ClientEvents)[K]>;
};

export type TerminalAttachResponse = z.infer<typeof TerminalAttachResponse>;
