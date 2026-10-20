import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "demo"),
  base: "/revlens/",
  resolve: {
    alias: [
      { find: "next/link", replacement: path.resolve(__dirname, "demo/navigation.tsx") },
      { find: "next/navigation", replacement: path.resolve(__dirname, "demo/navigation.tsx") },
      { find: "next-auth/react", replacement: path.resolve(__dirname, "demo/session.tsx") },
      { find: "@", replacement: __dirname },
    ],
  },
  define: {
    "process.env.NEXT_PUBLIC_DEMO_MODE": '"true"',
    "process.env.NEXT_PUBLIC_STATIC_DEMO": '"true"',
  },
  build: { outDir: path.resolve(__dirname, "dist-demo"), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 3102, strictPort: true },
  preview: { host: "127.0.0.1", port: 3102, strictPort: true },
});
