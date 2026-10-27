import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons';

export default defineConfig({
  plugins: [vue(), createSvgIconsPlugin({
    iconDirs: [fileURLToPath(new URL('./src/components/Tiptap/icons', import.meta.url))],
    symbolId: 'icon-[name]',
  })],
  css: { preprocessorOptions: { scss: { api: 'modern' } } },
  test: {
    environment: 'jsdom',
    include: [
      'src/services/__tests__/**/*.spec.ts',
      'src/components/Tiptap/__tests__/**/*.spec.ts',
      'src/components/question-designers/__tests__/**/*.spec.ts',
      'src/utils/__tests__/**/*.spec.ts',
      'src/components/__tests__/**/*.spec.ts',
      'src/composables/__tests__/**/*.spec.ts',
      'src/api/__tests__/**/*.spec.ts',
    ],
    setupFiles: ['./src/test/setup.ts'],
  },
});
