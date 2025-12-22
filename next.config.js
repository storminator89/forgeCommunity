/** @type {import('next').NextConfig} */

// Security Headers
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin'
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()'
  }
];

const nextConfig = {
  // Entwicklungsmodus schneller machen
  reactStrictMode: false,

  // TypeScript Checks lockern
  typescript: {
    ignoreBuildErrors: true,
  },

  // Experimentelle Features
  experimental: {
    optimizeCss: true
  },

  // Turbopack config (leere Config um Warnung zu unterdrücken)
  turbopack: {},

  // Production Build Konfiguration
  output: 'standalone',
  images: {
    unoptimized: true
  },

  // Security Headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },

  // Webpack-Optimierungen
  webpack: (config) => {
    return config;
  },
};

module.exports = nextConfig;