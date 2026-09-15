import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@notes': resolve(import.meta.dirname, 'src/renderer/src/features/notes'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      '@shared': resolve(import.meta.dirname, 'src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    // Large repository fixtures contend for Windows temp-directory I/O when
    // files run together, causing false timeout and cleanup failures.
    fileParallelism: false,
    exclude: [...configDefaults.exclude, '.worktrees/**'],
    globals: true,
    setupFiles: ['./src/test/setup.ts']
  }
})
