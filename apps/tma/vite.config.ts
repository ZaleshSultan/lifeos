import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    base: env.VITE_BASE_PATH || "/",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts,
    },
    preview: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts,
    },
  };
});
