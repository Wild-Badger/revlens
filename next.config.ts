import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.LOCAL_WORKSPACE_MODE === "true" ? undefined : "standalone",
  distDir: process.env.LOCAL_WORKSPACE_MODE === "true" ? ".next-local" : ".next",
  transpilePackages: ["@portfolio/ui"],
};

export default nextConfig;
