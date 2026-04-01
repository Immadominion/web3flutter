import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  typescript: {
    // lucide-react@1.7.0 ships broken .d.ts — skip lib type check during build
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      // Vanity URLs → /docs/[slug]
      { source: "/solana", destination: "/docs/solana-package", permanent: false },
      { source: "/borsh", destination: "/docs/borsh", permanent: false },
      { source: "/coral", destination: "/docs/coral-xyz", permanent: false },
      { source: "/coral-xyz", destination: "/docs/coral-xyz", permanent: false },
      { source: "/mobile", destination: "/docs/solana-mobile", permanent: false },
      { source: "/tokens", destination: "/docs/token-ops", permanent: false },
      { source: "/nft", destination: "/docs/nft-dev", permanent: false },
      { source: "/defi", destination: "/docs/defi-patterns", permanent: false },
      { source: "/wallet", destination: "/docs/wallet-ux", permanent: false },
      { source: "/walrus", destination: "/docs/dartus", permanent: false },
      { source: "/dartus", destination: "/docs/dartus", permanent: false },
      { source: "/bls", destination: "/docs/bls-dart", permanent: false },
      { source: "/zk", destination: "/docs/light-sdk", permanent: false },
      { source: "/light", destination: "/docs/light-sdk", permanent: false },
      { source: "/tld", destination: "/docs/tld-parser", permanent: false },
      { source: "/domains", destination: "/docs/tld-parser", permanent: false },
    ];
  },
};

export default nextConfig;
