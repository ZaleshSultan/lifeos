import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cyan: {
          50: "#eff4ff",
          100: "#dde7ff",
          200: "#c2d3ff",
          300: "#a9c1ff",
          400: "#89aaff",
          500: "#7196f3",
          600: "#5375c7",
          700: "#405b9e",
          800: "#304577",
          900: "#232f50",
          950: "#161c2c",
        },
        graphite: {
          950: "#0c0c0e",
          900: "#151517",
          850: "#19191c",
          800: "#1e1e21",
          700: "#29292e",
        },
        pulse: {
          mint: "#4ade80",
          cyan: "#89aaff",
          amber: "#fbbf24",
          rose: "#fb7185",
        },
      },
      boxShadow: {
        glow: "0 0 32px rgba(34, 211, 238, 0.16)",
        panel: "none",
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
