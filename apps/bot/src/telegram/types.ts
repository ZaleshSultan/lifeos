import type { LifeOSStore } from "@lifeos/db";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel" | string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  web_app?: {
    url: string;
  };
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface SendMessageInput {
  chatId: number;
  text: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramClient {
  sendMessage(input: SendMessageInput): Promise<void>;
}

export interface TelegramBotRuntime {
  telegram: TelegramClient;
  store?: LifeOSStore;
  tmaUrl?: string;
  defaultUserId?: string;
  defaultTelegramUserId?: number;
  now?: () => Date;
}
