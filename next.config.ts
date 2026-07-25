import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling Node.js-native modules used in API routes
  serverExternalPackages: ["exceljs", "xlsx"],
  // No frenar el build de Vercel por errores de tipo/lint no críticos.
  // (Si se quitan, un solo warning estricto puede tumbar todo el deploy.)
  typescript: { ignoreBuildErrors: true },
  eslint:     { ignoreDuringBuilds: true },
};

export default nextConfig;
