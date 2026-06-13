import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@notes': resolve(__dirname, 'src/renderer/src/features/notes'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, '.worktrees/**'],
    globals: true,
    setupFiles: ['./src/test/setup.ts']
  }
})
