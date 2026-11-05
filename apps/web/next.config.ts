import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/web",
  // Keep release builds bounded on the shared Debian host.
  experimental: { cpus: 1 },
  webpack(config) {
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
