import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    base: env.VITE_BASE_PATH || "/",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: ["lifeostma-production.up.railway.app"],
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: ["lifeostma-production.up.railway.app"],
    },
  };
});
