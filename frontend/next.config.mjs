import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 저장소 루트에도 lockfile이 있다. 트레이싱이 그쪽으로 올라가면 Services 번들이 깨진다.
  outputFileTracingRoot: frontendRoot,
  reactStrictMode: true,
  images: {
    // Services 배포에서는 /_next/image 가 404다. public 파일을 그대로 쓴다.
    unoptimized: true,
    remotePatterns: [],
  },
  async rewrites() {
    // next dev 전용. Vercel에서는 루트 vercel.json이 /api를 backend 서비스로 먼저 보낸다.
    const api = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';
    return [
      {
        source: '/api/:path*',
        destination: `${api}/:path*`,
      },
    ];
  },
};

export default nextConfig;
