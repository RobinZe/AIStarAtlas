/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['*']
    },
    // 确保部署产物包含本机扩展与星历数据
    outputFileTracingIncludes: {
      '/api/astrology': [
        './node_modules/swisseph/build/Release/swisseph.node',
        './node_modules/swisseph/ephe/**'
      ]
    }
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 不将 swisseph 打进包，由 Node 在运行时按 commonjs 方式加载
      config.externals = config.externals || [];
      config.externals.push({ swisseph: 'commonjs swisseph' });
    }
    return config;
  }
};

export default nextConfig;