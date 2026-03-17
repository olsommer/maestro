// Shared
export { buildAppendSections } from "./system-prompt.js";

// WhatsApp
export { startWhatsApp, stopWhatsApp, getWhatsAppStatus, sendWhatsAppMessage, onWhatsAppMessage } from "./channels/whatsapp/whatsapp.js";
export { startWhatsAppQueue, stopWhatsAppQueue } from "./channels/whatsapp/queue.js";
export { registerWhatsAppRoutes } from "./channels/whatsapp/routes.js";
export type { WhatsAppMessageRow } from "./channels/whatsapp/store.js";

// Telegram
export { startTelegram, stopTelegram, getTelegramStatus, sendTelegramMessage, onTelegramMessage } from "./channels/telegram/telegram.js";
export { startTelegramQueue, stopTelegramQueue } from "./channels/telegram/queue.js";
export { registerTelegramRoutes } from "./channels/telegram/routes.js";
export type { TelegramMessageRow } from "./channels/telegram/store.js";
