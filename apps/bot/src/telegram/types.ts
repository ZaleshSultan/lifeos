import type { LifeOSStore } from "@lifeos/db";

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

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
  caption?: string;
  photo?: TelegramPhotoSize[];
  web_app_data?: {
    data: string;
    button_text?: string;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: Record<string, unknown>;
}

export interface TelegramCallbackQuery {
  id?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: {
    url: string;
  };
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  is_persistent?: boolean;
}

export interface AnswerCallbackQueryInput {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}

export interface SendMessageInput {
  chatId: number;
  text: string;
  replyMarkup?: TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;
}

export interface TelegramClient {
  sendMessage(input: SendMessageInput): Promise<void>;
  answerCallbackQuery(input: AnswerCallbackQueryInput): Promise<void>;
  getFileUrl(fileId: string): Promise<string>;
}

export interface TelegramBotRuntime {
  telegram: TelegramClient;
  store?: LifeOSStore;
  tmaUrl?: string;
  defaultUserId?: string;
  defaultTelegramUserId?: number;
  adminTelegramUserIds?: number[];
  signupMode?: "pending_approval";
  financeAi?: {
    enabled: boolean;
    openRouterApiKey?: string;
    model?: string;
  };
  now?: () => Date;
}
