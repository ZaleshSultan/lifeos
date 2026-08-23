import { loadBotConfig } from "./config.js";
import { createBotDependencies } from "./dependencies.js";
import { createBotServer } from "./server.js";
import { TelegramHttpClient } from "./telegram/client.js";

const config = loadBotConfig();
const dependencies = createBotDependencies();
const telegram = config.telegramBotToken
  ? new TelegramHttpClient(config.telegramBotToken)
  : undefined;
const server = createBotServer({
  config,
  store: dependencies.store,
  telegram,
  dependencies: {
    supabaseConfigured: Boolean(dependencies.supabase),
    telegramConfigured: Boolean(telegram),
  },
});

server.listen(config.port, config.host, () => {
  console.info(
    `lifeos bot backend listening on http://${config.host}:${config.port}`,
  );

  if (dependencies.store?.syncFinanceExchangeRates) {
    const syncRates = () => {
      void dependencies
        .store!.syncFinanceExchangeRates()
        .then((count) => {
          if (count > 0) {
            console.info(`[finance] synced ${count} exchange rate quotes`);
          }
        })
        .catch((error: unknown) => {
          console.error("[finance] exchange rate sync failed", {
            errorType: error instanceof Error ? error.name : typeof error,
          });
        });
    };

    syncRates();
    setInterval(syncRates, 24 * 60 * 60 * 1000);
  }
});
