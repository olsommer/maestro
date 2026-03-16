export { startWhatsApp, stopWhatsApp, getWhatsAppStatus, sendWhatsAppMessage, onWhatsAppMessage } from "./whatsapp.js";
export { startWhatsAppQueue, stopWhatsAppQueue } from "./queue.js";
export { registerWhatsAppRoutes } from "./routes.js";
export type { WhatsAppMessageRow } from "./store.js";

export { startTelegram, stopTelegram, getTelegramStatus, sendTelegramMessage, onTelegramMessage } from "./telegram.js";
export { startTelegramQueue, stopTelegramQueue } from "./telegram-queue.js";
export { registerTelegramRoutes } from "./telegram-routes.js";
export type { TelegramMessageRow } from "./telegram-store.js";
