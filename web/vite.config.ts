import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发期将 /api/v1 反向代理至本机 NestJS（生产由 nginx 承担，02 册 5.2 环境规划）
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
