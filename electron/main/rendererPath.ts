import { join } from 'node:path'

export function createRendererFilePath(mainOutputDir: string) {
  return join(mainOutputDir, '../renderer/index.html')
}
