import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Decodifica HEIC con libheif en WebAssembly: se carga con require de Node, sin empaquetarlo.
  serverExternalPackages: ["heic-convert"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
