import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";
const path = (value: string) => fileURLToPath(new URL(value, import.meta.url));
export default defineConfig({
  root: path("./tests/browser"),
  publicDir: path("./public"),
  resolve: {
    alias: {
      "@": path("./src"),
      "next/navigation": path("./tests/browser/navigation.ts"),
      "next/dynamic": path("./tests/browser/dynamic.tsx"),
    },
  },
  css: { postcss: { plugins: [tailwind()] } },
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});
