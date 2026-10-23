import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.spec.ts'],
    typecheck: {
      checker: 'vue-tsc',
      include: ['test/**/*.spec.ts'],
    },
  },
})
