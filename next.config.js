/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['*']
    },
    outputFileTracingIncludes: {
      '/api/astrology': [
        './node_modules/swisseph/build/Release/**',
        './node_modules/swisseph/ephe/**'
      ]
    }
  },
  webpack: (config) => {
    config.externals = config.externals || [];
    if (Array.isArray(config.externals)) {
      config.externals.push({ swisseph: 'commonjs swisseph' });
    }
    return config;
  }
};
export default nextConfig;