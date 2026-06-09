import type { TelegramClient } from "./types.js";
import type { LifeOSStore } from "@lifeos/db";

export async function triggerFinanceAlerts(
  store: LifeOSStore,
  telegram: TelegramClient | undefined,
  userId: string,
  today: string,
): Promise<void> {
  if (!telegram) return;

  try {
    const alerts = await store.processFinanceAlerts(userId, today);
    if (alerts.length > 0) {
      const telegramUserId = await store.getTelegramUserId(userId);
      if (telegramUserId) {
        for (const alert of alerts) {
          await telegram.sendMessage({
            chatId: telegramUserId,
            text: alert,
          });
        }
      }
    }
  } catch (error) {
    console.error("[finance] failed to process push alerts", error);
  }
}
