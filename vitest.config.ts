import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@notes': resolve(__dirname, 'src/renderer/src/features/notes')
    }
  },
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '.worktrees/**'],
    setupFiles: ['./src/test/setup.ts']
  }
})
