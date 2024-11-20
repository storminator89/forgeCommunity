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

  // Production Build Konfiguration
  output: 'standalone',
  images: {
    unoptimized: true,
    domains: [
      'lh3.googleusercontent.com',
      'avatars.githubusercontent.com',
      'github.com',
      'res.cloudinary.com'
    ],
  },

  // Experimentelle Features
  experimental: {
    optimizeCss: {
      enabled: true
    }
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