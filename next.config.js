/** @type {import('next').NextConfig} */
const nextConfig = {
  // Entwicklungsmodus schneller machen
  reactStrictMode: false,

  // Build-Optimierungen
  swcMinify: true,

  // TypeScript & ESLint Checks lockern
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Experimentelle Features
  experimental: {
    optimizeCss: {
      enabled: true
    }
  },

  // Production Build Konfiguration
  output: 'standalone',
  images: {
    unoptimized: true
  },

  // Webpack-Optimierungen
  webpack: (config, { dev }) => {
    if (dev) {
      config.devtool = 'eval-source-map';
    }
    return config;
  },
};

module.exports = nextConfig;