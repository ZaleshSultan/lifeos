import type { TelegramBridge } from "../../tma/src/telegram-sdk";

// The Web dashboard uses its browser session and native controls.
export const telegram: TelegramBridge = {
  initData: "",
  colorScheme: "dark",
  ready() {},
  expand() {},
  applyTheme() {},
  hapticImpact() {},
};
