/** @type {import('next').NextConfig} */
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

  // Webpack-Optimierungen
  webpack: (config) => {
    return config;
  },
};

module.exports = nextConfig;