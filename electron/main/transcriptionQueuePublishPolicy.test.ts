import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')

describe('transcription queue publishing', () => {
  it('keeps library refreshes for lifecycle changes but not throttled progress-only updates', () => {
    expect(indexSource).toContain('publishVideoAudioTranscriptionQueueChanged(snapshot, true)')
    expect(indexSource).toContain('publishVideoAudioTranscriptionQueueChanged(latest, false)')
    expect(indexSource).toContain("if (notifyFavoriteLibrary && target === mainWindow) target.webContents.send('favorite-library:transcription-changed')")
  })

  it('projects every queue event to the current account before it reaches a renderer', () => {
    expect(indexSource).toContain('filterTranscriptionQueueSnapshotForAccount(snapshot, accountMid)')
    expect(indexSource).toContain("target.webContents.send('video-audio:transcription-queue-changed', scopedSnapshot)")
  })
})
