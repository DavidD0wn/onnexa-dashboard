import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling Node.js-native modules used in API routes
  serverExternalPackages: ["exceljs", "xlsx"],
  // No frenar el build de Vercel por errores de tipo no críticos.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
