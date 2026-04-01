import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  typescript: {
    // lucide-react@1.7.0 ships broken .d.ts — skip lib type check during build
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
