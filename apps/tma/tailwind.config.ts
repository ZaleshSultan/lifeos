import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "#05070b",
          900: "#090d14",
          850: "#0d131d",
          800: "#111927",
          700: "#1c293b",
        },
        pulse: {
          mint: "#4ade80",
          cyan: "#22d3ee",
          amber: "#fbbf24",
          rose: "#fb7185",
        },
      },
      boxShadow: {
        glow: "0 0 32px rgba(34, 211, 238, 0.16)",
        panel: "0 24px 80px rgba(0, 0, 0, 0.28)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
