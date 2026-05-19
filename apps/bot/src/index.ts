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
});
