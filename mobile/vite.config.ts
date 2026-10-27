import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import uni from "@dcloudio/vite-plugin-uni";
import { publicEnvFallbackDefines } from "./build/public-env";
import { inspectMpPublicConfig } from "./build/mp-public-config.mjs";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, fileURLToPath(new URL("../", import.meta.url)), "VITE_");
  const clientEnv = loadEnv(mode, fileURLToPath(new URL("./", import.meta.url)), "VITE_");
  if (process.env.UNI_PLATFORM === "mp-weixin") {
    const report = inspectMpPublicConfig({ ...rootEnv, ...clientEnv, ...process.env });
    const invalid = report.errors.filter(error => !error.startsWith("缺少 VITE_API_ORIGIN"));
    if (invalid.length) throw new Error(invalid.join("\n"));
    if (!report.ready) console.warn("[mp-weixin] 未配置 VITE_API_ORIGIN，仅可编译静态预览；业务联调前请运行公开配置检查。");
  }
  return {
    define: publicEnvFallbackDefines(rootEnv, clientEnv, process.env),
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
  };
});
