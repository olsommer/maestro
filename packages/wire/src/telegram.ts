import { z } from "zod";

export const TelegramConnectionStatus = z.enum([
  "disconnected",
  "connecting",
  "connected",
  "error",
]);
export type TelegramConnectionStatus = z.infer<typeof TelegramConnectionStatus>;

export const TelegramStatusResponse = z.object({
  status: TelegramConnectionStatus,
  botUsername: z.string().nullable().optional(),
});
export type TelegramStatusResponse = z.infer<typeof TelegramStatusResponse>;

export const TelegramMessageDirection = z.enum(["incoming", "outgoing"]);
export type TelegramMessageDirection = z.infer<typeof TelegramMessageDirection>;

export const TelegramMessageStatus = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);
export type TelegramMessageStatus = z.infer<typeof TelegramMessageStatus>;

export const TelegramMessage = z.object({
  id: z.string(),
  chatId: z.string(),
  messageId: z.string(),
  direction: TelegramMessageDirection,
  senderName: z.string().nullable(),
  body: z.string(),
  status: TelegramMessageStatus,
  responseText: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
export type TelegramMessage = z.infer<typeof TelegramMessage>;
