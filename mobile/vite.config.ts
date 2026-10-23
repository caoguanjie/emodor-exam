import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// https://vitejs.dev/config/
export default defineConfig({
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
});
