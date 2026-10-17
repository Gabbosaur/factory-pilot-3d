import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // three.js ecosystem ships ESM that benefits from transpilation in the app bundle
  transpilePackages: ['three'],
};

export default nextConfig;
