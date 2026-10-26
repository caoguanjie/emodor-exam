import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import uni from "@dcloudio/vite-plugin-uni";
import { publicEnvFallbackDefines } from "./build/public-env";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: publicEnvFallbackDefines(
    loadEnv(mode, fileURLToPath(new URL("../", import.meta.url)), "VITE_"),
    loadEnv(mode, fileURLToPath(new URL("./", import.meta.url)), "VITE_"),
    process.env,
  ),
  plugins: [uni()],
  base: "/mobile/",
  build: {
    ...(process.env.RULEEXAM_BUILD_OUT_DIR
      ? { outDir: process.env.RULEEXAM_BUILD_OUT_DIR, emptyOutDir: true }
      : {}),
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api/v1": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
}));
