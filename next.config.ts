// --- START OF FILE next.config.ts ---
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
  async rewrites() {
    // FIX: Proxy internal /api calls to the external FastAPI backend
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const baseUrl = apiUrl.replace(/\/api\/v1\/?$/, '');
    
    return [
      {
        source: '/api/:path*',
        destination: `${baseUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;