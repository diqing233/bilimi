import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import type { VideoNoteArchiveEntry } from '../../src/shared/types'
import {
  createVideoNoteBatchExportFolderName,
  exportVideoNoteArchiveBatch,
  resolveSavedVideoNoteArchiveExport,
  writeVideoNoteMarkdownExport,
  writeVideoNoteWordExport
} from './videoNoteExportService'

const archive: VideoNoteArchiveEntry = {
  id: 'archive-1', source: { title: 'Export', tags: [], url: 'https://www.bilibili.com/video/BV1export' }, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z',
  versions: [{ id: 'v1', createdAt: '2026-07-27T00:00:00.000Z', plainTranscript: 'Saved transcript', summaryText: '', note: { id: 'note-1', source: { title: 'Export', tags: [], url: 'https://www.bilibili.com/video/BV1export' }, transcriptSource: 'audio', transcript: [], chapters: [], overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '', createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' } }]
}

function selectedDestination(parentDirectory: string) {
  return join(parentDirectory, 'bilimi文稿_2026-07-27_1234')
}

describe('video note export service', () => {
  it('formats the suggested batch folder with local calendar time', () => {
    expect(createVideoNoteBatchExportFolderName(new Date(2026, 6, 27, 12, 34, 56))).toBe('bilimi文稿_2026-07-27_1234')
  })

  it('writes into the selected final folder without nesting another timestamp folder', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-destination-'))
    const destinationDirectory = join(parentDirectory, 'bilimi文稿_2026-07-27_1234')

    const result = await exportVideoNoteArchiveBatch({
      archives: [archive],
      selections: [{ archiveId: 'archive-1', versionId: 'v1' }],
      destinationDirectory,
      formats: ['markdown'],
      scope: 'complete'
    })

    expect(result.folderPath).toBe(destinationDirectory)
    expect(await readdir(destinationDirectory)).toEqual(['Export_AVunknown.md'])
    expect(await readdir(parentDirectory)).toEqual(['bilimi文稿_2026-07-27_1234'])
  })

  it('exports one saved archive as Markdown and Word into the selected final folder', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-parent-'))
    const destinationDirectory = selectedDestination(parentDirectory)

    const result = await exportVideoNoteArchiveBatch({
      archives: [archive],
      selections: [{ archiveId: 'archive-1', versionId: 'v1' }],
      destinationDirectory,
      formats: ['markdown', 'word'],
      scope: 'complete'
    })

    expect(result).toMatchObject({ selectedCount: 1, exportableCount: 1, succeededCount: 1, skippedCount: 0, failedCount: 0 })
    expect(result.folderPath).toBe(destinationDirectory)
    expect(await readdir(result.folderPath!)).toEqual(['Export_AVunknown.docx', 'Export_AVunknown.md'])
  })

  it('preserves a selected export folder by creating a numbered sibling on collision', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-folder-collision-'))
    const destinationDirectory = selectedDestination(parentDirectory)
    await writeFile(destinationDirectory, 'reserved by another export', 'utf8')

    const result = await exportVideoNoteArchiveBatch({
      archives: [archive],
      selections: [{ archiveId: 'archive-1', versionId: 'v1' }],
      destinationDirectory,
      formats: ['markdown'],
      scope: 'complete'
    })

    expect(result.folderPath).toBe(`${destinationDirectory} (2)`)
    expect(await readFile(destinationDirectory, 'utf8')).toBe('reserved by another export')
    expect(await readdir(result.folderPath!)).toEqual(['Export_AVunknown.md'])
  })

  it('skips unresolved archives and cancels remaining sequential exports while retaining completed files', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-cancel-'))
    const controller = new AbortController()
    const progress: string[] = []
    const result = await exportVideoNoteArchiveBatch({
      archives: [archive],
      selections: [{ archiveId: 'missing', versionId: 'v1' }, { archiveId: 'archive-1', versionId: 'v1' }, { archiveId: 'archive-1', versionId: 'v1' }],
      destinationDirectory: selectedDestination(parentDirectory), formats: ['markdown'], scope: 'complete', signal: controller.signal,
      onProgress: (event) => { progress.push(`${event.completedCount}/${event.selectedCount}`); if (event.succeededCount === 1) controller.abort() }
    })

    expect(result).toMatchObject({ selectedCount: 3, succeededCount: 1, skippedCount: 1, canceled: true })
    expect(result.files).toHaveLength(1)
    expect(progress).toEqual(['1/3', '2/3'])
  })

  it('records every unstarted selection as canceled while preserving completed files', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-cancel-details-'))
    const controller = new AbortController()
    const result = await exportVideoNoteArchiveBatch({
      archives: [archive],
      selections: [{ archiveId: 'archive-1', versionId: 'v1' }, { archiveId: 'archive-1', versionId: 'v1' }],
      destinationDirectory: selectedDestination(parentDirectory), formats: ['markdown'], scope: 'complete', signal: controller.signal
    }, { writeItem: vi.fn().mockImplementation(async () => { controller.abort(); return ['C:\\exports\\first.md'] }) })

    expect(result).toMatchObject({ canceled: true, succeededCount: 1, files: ['C:\\exports\\first.md'] })
    expect(result.items).toEqual([
      expect.objectContaining({ status: 'succeeded' }),
      expect.objectContaining({ status: 'canceled', files: [] })
    ])
  })

  it('stops remaining writes when the owning account is no longer current', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-account-change-'))
    let current = true
    const writeItem = vi.fn().mockImplementation(async () => {
      current = false
      return ['C:\\exports\\first.md']
    })

    const result = await exportVideoNoteArchiveBatch({
      archives: [archive], selections: [{ archiveId: 'archive-1', versionId: 'v1' }, { archiveId: 'archive-1', versionId: 'v1' }],
      destinationDirectory: selectedDestination(parentDirectory), formats: ['markdown'], scope: 'complete', isCurrentAccount: async () => current
    }, { writeItem })

    expect(writeItem).toHaveBeenCalledTimes(1)
    expect(result.items).toEqual([expect.objectContaining({ status: 'succeeded' }), expect.objectContaining({ status: 'canceled', files: [] })])
  })

  it('does not create a folder or write the second format after the account becomes stale', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-format-account-change-'))
    let current = true
    const writeFormat = vi.fn(async ({ format }: { format: 'markdown' | 'word' }) => {
      if (format === 'markdown') current = false
      return `C:\\exports\\first.${format === 'markdown' ? 'md' : 'docx'}`
    })

    const result = await exportVideoNoteArchiveBatch({
      archives: [archive], selections: [{ archiveId: 'archive-1', versionId: 'v1' }], destinationDirectory: selectedDestination(parentDirectory),
      formats: ['markdown', 'word'], scope: 'complete', isCurrentAccount: async () => current
    }, { writeFormat })

    expect(writeFormat).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ canceled: true, files: ['C:\\exports\\first.md'] })
    expect(result.items).toEqual([expect.objectContaining({ status: 'canceled', files: ['C:\\exports\\first.md'] })])
  })

  it('does not create an output folder when the account is stale before work begins', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-stale-before-folder-'))
    const result = await exportVideoNoteArchiveBatch({
      archives: [archive], selections: [{ archiveId: 'archive-1', versionId: 'v1' }], destinationDirectory: selectedDestination(parentDirectory),
      formats: ['markdown'], scope: 'complete', isCurrentAccount: async () => false
    })

    expect(result).toMatchObject({ folderPath: undefined, canceled: true })
    expect(await readdir(parentDirectory)).toEqual([])
  })

  it('returns all stale selections as skips without leaving an empty output folder', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-stale-selections-'))
    const result = await exportVideoNoteArchiveBatch({
      archives: [], selections: [{ archiveId: 'missing', versionId: 'v1' }], destinationDirectory: selectedDestination(parentDirectory),
      formats: ['markdown'], scope: 'complete'
    })

    expect(result).toMatchObject({ folderPath: undefined, exportableCount: 0, skippedCount: 1, canceled: false })
    expect(result.items).toEqual([expect.objectContaining({ status: 'skipped' })])
    expect(await readdir(parentDirectory)).toEqual([])
  })

  it('continues after one item write fails and returns settled batch details', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-failure-'))
    const writeItem = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(['C:\\exports\\second.md'])
    const result = await exportVideoNoteArchiveBatch({
      archives: [archive],
      selections: [{ archiveId: 'archive-1', versionId: 'v1' }, { archiveId: 'archive-1', versionId: 'v1' }],
      destinationDirectory: selectedDestination(parentDirectory), formats: ['markdown'], scope: 'complete'
    }, { writeItem })

    expect(result).toMatchObject({ selectedCount: 2, exportableCount: 2, succeededCount: 1, skippedCount: 0, failedCount: 1, canceled: false })
    expect(result.files).toEqual(['C:\\exports\\second.md'])
    expect(result.folderPath).toContain('bilimi文稿_')
  })

  it('preserves an already written format and records its item failure when a later format fails', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'bilimi-export-partial-'))
    const result = await exportVideoNoteArchiveBatch({
      archives: [archive], selections: [{ archiveId: 'archive-1', versionId: 'v1' }],
      destinationDirectory: selectedDestination(parentDirectory), formats: ['markdown', 'word'], scope: 'complete'
    }, { writeItem: vi.fn().mockResolvedValue({ files: ['C:\\exports\\first.md'], errors: [{ format: 'word', message: 'disk full' }] } as never) })

    expect(result).toMatchObject({ succeededCount: 0, failedCount: 1, files: ['C:\\exports\\first.md'] })
    expect(result.items).toEqual([expect.objectContaining({ archiveId: 'archive-1', versionId: 'v1', status: 'failed', files: ['C:\\exports\\first.md'], error: 'disk full' })])
  })

  it('resolves export content from the saved archive identity instead of renderer content', () => {
    const resolved = resolveSavedVideoNoteArchiveExport([archive], {
      archiveId: 'archive-1', versionId: 'v1', scope: 'complete'
    })

    expect(resolved.archive).toBe(archive)
    expect(() => resolveSavedVideoNoteArchiveExport([archive], {
      archiveId: 'missing', versionId: 'v1', scope: 'complete'
    })).toThrow('The selected archive no longer exists.')
    expect(() => resolveSavedVideoNoteArchiveExport([archive], {
      archiveId: 'archive-1', versionId: 'missing', scope: 'complete'
    })).toThrow('The selected archive version no longer exists.')
  })

  it('preserves an existing export and writes a numbered UTF-8 Markdown filename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bilimi-export-'))
    const requested = join(directory, 'Export.md')
    await writeFile(requested, 'existing', 'utf8')

    const result = await writeVideoNoteMarkdownExport({ archive, versionId: 'v1', scope: 'complete', destinationPath: requested })

    expect(result).toBe(join(directory, 'Export (2).md'))
    expect(await readFile(requested, 'utf8')).toBe('existing')
    expect(await readFile(result, 'utf8')).toContain('Saved transcript')
  })

  it('preserves an existing Word export and writes a numbered .docx document from saved content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bilimi-export-'))
    const requested = join(directory, 'Export.docx')
    await writeFile(requested, 'existing', 'utf8')

    const result = await writeVideoNoteWordExport({ archive, versionId: 'v1', scope: 'complete', destinationPath: requested })
    const buffer = await readFile(result)
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('string')

    expect(result).toBe(join(directory, 'Export (2).docx'))
    expect(await readFile(requested, 'utf8')).toBe('existing')
    expect(xml).toContain('Saved transcript')
  })

  it('uses the .docx extension when a Word destination has no extension', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bilimi-export-'))
    const result = await writeVideoNoteWordExport({ archive, versionId: 'v1', scope: 'current', destinationPath: join(directory, 'Export') })

    expect(result).toBe(join(directory, 'Export.docx'))
  })

  it('closes an exclusively opened Markdown handle when writing it fails', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const openFile = vi.fn().mockResolvedValue({ writeFile: vi.fn().mockRejectedValue(new Error('disk full')), close } as never)

    await expect(writeVideoNoteMarkdownExport({ archive, versionId: 'v1', scope: 'complete', destinationPath: join(tmpdir(), 'locked.md') }, { openFile })).rejects.toThrow('disk full')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes an exclusively opened Word handle when writing it fails', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const openFile = vi.fn().mockResolvedValue({ writeFile: vi.fn().mockRejectedValue(new Error('disk full')), close } as never)

    await expect(writeVideoNoteWordExport({ archive, versionId: 'v1', scope: 'complete', destinationPath: join(tmpdir(), 'locked.docx') }, { openFile })).rejects.toThrow('disk full')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
