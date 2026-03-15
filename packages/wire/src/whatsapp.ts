import { z } from "zod";

export const WhatsAppConnectionStatus = z.enum([
  "disconnected",
  "connecting",
  "qr_pending",
  "connected",
]);
export type WhatsAppConnectionStatus = z.infer<typeof WhatsAppConnectionStatus>;

export const WhatsAppStatusResponse = z.object({
  status: WhatsAppConnectionStatus,
  qrCode: z.string().nullable().optional(),
  phoneNumber: z.string().nullable().optional(),
});
export type WhatsAppStatusResponse = z.infer<typeof WhatsAppStatusResponse>;

export const WhatsAppMessageDirection = z.enum(["incoming", "outgoing"]);
export type WhatsAppMessageDirection = z.infer<typeof WhatsAppMessageDirection>;

export const WhatsAppMessageStatus = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);
export type WhatsAppMessageStatus = z.infer<typeof WhatsAppMessageStatus>;

export const WhatsAppMessage = z.object({
  id: z.string(),
  chatJid: z.string(),
  messageId: z.string(),
  direction: WhatsAppMessageDirection,
  senderName: z.string().nullable(),
  body: z.string(),
  status: WhatsAppMessageStatus,
  responseText: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
export type WhatsAppMessage = z.infer<typeof WhatsAppMessage>;
