import { describe, expect, it, vi } from 'vitest'
import { chooseVideoNoteExportDestination } from './videoNoteExportDestinationPicker'

describe('video note export destination picker', () => {
  it('passes the suggested final folder to the editable native directory-name input', async () => {
    const chooseDestination = vi.fn().mockResolvedValue({ canceled: false, filePath: 'C:\\Desktop\\bilimi文稿_2026-08-30_1900' })

    const result = await chooseVideoNoteExportDestination({
      desktopDirectory: 'C:\\Desktop',
      suggestedFolderName: 'bilimi文稿_2026-08-30_1900',
      chooseDestination
    })

    expect(chooseDestination).toHaveBeenCalledWith('C:\\Desktop\\bilimi文稿_2026-08-30_1900')
    expect(result).toBe('C:\\Desktop\\bilimi文稿_2026-08-30_1900')
  })

  it('returns no destination when the editable native directory-name input is canceled', async () => {
    const chooseDestination = vi.fn().mockResolvedValue({ canceled: true })

    const result = await chooseVideoNoteExportDestination({
      desktopDirectory: 'C:\\Desktop',
      suggestedFolderName: 'bilimi文稿_2026-08-30_1900',
      chooseDestination
    })

    expect(result).toBeUndefined()
  })
})
