import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发期将 /api/v1 反向代理至本机 NestJS（生产由 nginx 承担，02 册 5.2 环境规划）
export default defineConfig({
  plugins: [vue()],
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
    // 发布目录与 web/、mobile/ 同级；后续 H5 产物在 PC 构建完成后合并至 dist/mobile/。
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
