import WebApp from "@twa-dev/sdk";

export interface TelegramBridge {
  initData: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  applyTheme(): void;
  hapticImpact(style?: "light" | "medium" | "heavy"): void;
}

function safeCall(callback: () => void): void {
  try {
    callback();
  } catch {
    // Telegram APIs are unavailable in plain browser development.
  }
}

export const telegram: TelegramBridge = {
  get initData() {
    return WebApp.initData ?? "";
  },
  get colorScheme() {
    return WebApp.colorScheme === "light" ? "light" : "dark";
  },
  ready() {
    safeCall(() => WebApp.ready());
  },
  expand() {
    safeCall(() => WebApp.expand());
  },
  applyTheme() {
    safeCall(() => {
      if (typeof document === "undefined") {
        return;
      }

      const root = document.documentElement;
      const params = WebApp.themeParams as unknown as Record<
        string,
        string | undefined
      >;
      const themeMap = {
        "--tg-theme-bg-color": params.bg_color,
        "--tg-theme-text-color": params.text_color,
        "--tg-theme-hint-color": params.hint_color,
        "--tg-theme-link-color": params.link_color,
        "--tg-theme-button-color": params.button_color,
        "--tg-theme-button-text-color": params.button_text_color,
        "--tg-theme-secondary-bg-color": params.secondary_bg_color,
        "--tg-theme-header-bg-color": params.header_bg_color,
      };

      for (const [name, value] of Object.entries(themeMap)) {
        if (value) {
          root.style.setProperty(name, value);
        }
      }

      root.dataset.telegramColorScheme = WebApp.colorScheme ?? "dark";
    });
  },
  hapticImpact(style = "light") {
    safeCall(() => WebApp.HapticFeedback.impactOccurred(style));
  },
};
