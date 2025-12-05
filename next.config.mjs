/** @type {import('next').NextConfig} */
const nextConfig = {
  webpackDevMiddleware: (config) => {
    config.watchOptions = {
      poll: 1000,          // 1秒ごとにチェック
      aggregateTimeout: 300,
    };
    return config;
  },
};

export default nextConfig;