/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // 로컬 /logo.png 사용. 외부 도메인 필요 시 여기에 추가.
    remotePatterns: [],
  },
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';
    return [
      {
        source: '/api/backend/:path*',
        destination: `${api}/:path*`,
      },
    ];
  },
};

export default nextConfig;
