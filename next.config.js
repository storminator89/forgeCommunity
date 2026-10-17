import { fileURLToPath } from 'node:url';

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: { unoptimized: true },
  turbopack: {
    resolveAlias: {
      'framer-motion': fileURLToPath(new URL('./lib/motion.tsx', import.meta.url)),
    },
  },
  async headers() {
    return [
      { source: '/h5p-runtime/:path*', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
      { source: '/:path*', headers: securityHeaders },
    ];
  },
};

export default nextConfig;
