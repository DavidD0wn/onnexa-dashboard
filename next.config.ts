import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling Node.js-native modules used in API routes
  serverExternalPackages: ["exceljs", "xlsx"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
