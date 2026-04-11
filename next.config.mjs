/** @type {import('next').NextConfig} */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  allowedDevOrigins: ['app.cowork.is'],
  serverExternalPackages: ['@libsql/sqlite3', 'sqlite3'],
  turbopack: {
    resolveAlias: {
      '@paperclipai/adapter-utils': path.resolve(__dirname, 'src/lib/adapter-utils/dist/index.js'),
      '@paperclipai/adapter-utils/server-utils': path.resolve(__dirname, 'src/lib/adapter-utils/dist/server-utils.js'),
    },
  },
  webpack: (config) => {
    config.resolve.alias['@paperclipai/adapter-utils'] = path.resolve(__dirname, 'src/lib/adapter-utils/dist/index.js');
    config.resolve.alias['@paperclipai/adapter-utils/server-utils'] = path.resolve(__dirname, 'src/lib/adapter-utils/dist/server-utils.js');
    return config;
  },
};

export default nextConfig;
