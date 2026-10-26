import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons';
import { publicEnvFallbackDefines } from './build/public-env';

// 开发期将 /api/v1 反向代理至本机 NestJS（生产由 nginx 承担，02 册 5.2 环境规划）
export default defineConfig(({ mode }) => ({
  // Keep web/.env.* and explicit process variables authoritative. Root .env
  // supplies only absent public fields; backend COS credentials never become defines.
  define: publicEnvFallbackDefines(
    loadEnv(mode, fileURLToPath(new URL('../', import.meta.url)), 'VITE_'),
    loadEnv(mode, fileURLToPath(new URL('./', import.meta.url)), 'VITE_'),
    process.env,
  ),
  plugins: [vue(), createSvgIconsPlugin({
    iconDirs: [fileURLToPath(new URL('./src/components/Tiptap/icons', import.meta.url))],
    symbolId: 'icon-[name]',
  })],
  css: { preprocessorOptions: { scss: { api: 'modern' } } },
  server: {
    // 监听所有网卡，允许局域网设备访问开发服务器
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 统一脚本传入同盘临时目录；直接运行 Vite 也不能清掉 dist/mobile/。
    outDir: process.env.RULEEXAM_BUILD_OUT_DIR || '../dist',
    emptyOutDir: Boolean(process.env.RULEEXAM_BUILD_OUT_DIR),
    chunkSizeWarningLimit: 2000,
  },
}));
