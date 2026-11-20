import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/web",
  // Keep release builds bounded on the shared Debian host.
  experimental: { cpus: 1 },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "#lifeos-transport": path.resolve(
        process.cwd(),
        "lib/browser-transport.ts",
      ),
      "#lifeos-app-host": path.resolve(process.cwd(), "lib/browser-host.ts"),
    };
    // Core follows Node ESM conventions (.js imports beside TypeScript sources).
    // Resolve those source imports without rewriting the shared domain package.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
