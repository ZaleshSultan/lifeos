import type { Config } from "tailwindcss";
import mobile from "../tma/tailwind.config";

export default {
  presets: [mobile],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../tma/src/screens/**/*.{ts,tsx}",
    "../tma/src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        signal: { ...mobile.theme.extend.colors.pulse, violet: "#a78bfa" },
      },
    },
  },
  plugins: [],
} satisfies Config;
