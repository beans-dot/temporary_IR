/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // 로컬 /logo.png 사용. 외부 도메인 필요 시 여기에 추가.
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
