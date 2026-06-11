/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @fx/shared ships TS-compiled JS; transpile so Next can consume the workspace package.
  transpilePackages: ["@fx/shared"],
};

export default nextConfig;
