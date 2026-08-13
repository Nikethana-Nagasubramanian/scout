import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: ["better-sqlite3", "pdfkit"],
};

export default nextConfig;
