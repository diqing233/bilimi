import { mkdir, open } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { Packer } from 'docx'
import type { VideoNoteArchiveEntry } from '../../src/shared/types'
import { createVideoNoteMarkdown, createVideoNoteWord, type VideoNoteCurrentContent, type VideoNoteExportScope } from '../../src/shared/videoNoteExport'

export type VideoNoteArchiveExportSelection = {
  archiveId: string
  versionId: string
  scope: VideoNoteExportScope
  currentContent?: VideoNoteCurrentContent
  includeNotes?: boolean
}

export function resolveSavedVideoNoteArchiveExport(
  archives: VideoNoteArchiveEntry[],
  selection: VideoNoteArchiveExportSelection
) {
  const archive = archives.find((candidate) => candidate.id === selection.archiveId)
  if (!archive) throw new Error('The selected archive no longer exists.')
  if (!archive.versions.some((candidate) => candidate.id === selection.versionId)) {
    throw new Error('The selected archive version no longer exists.')
  }
  return { archive, ...selection }
}

export type VideoNoteMarkdownExportRequest = {
  archive: VideoNoteArchiveEntry
  versionId: string
  scope: VideoNoteExportScope
  currentContent?: VideoNoteCurrentContent
  includeNotes?: boolean
  destinationPath: string
}

export type VideoNoteWordExportRequest = VideoNoteMarkdownExportRequest

export type VideoNoteBatchExportFormat = 'markdown' | 'word'
export type VideoNoteBatchExportItemResult = {
  archiveId: string
  versionId: string
  title?: string
  status: 'succeeded' | 'skipped' | 'failed' | 'canceled'
  files: string[]
  error?: string
}
type BatchWriteOutcome = { files: string[]; errors: Array<{ format: VideoNoteBatchExportFormat; message: string }>; canceled?: boolean }
type BatchWriteInput = { saved: ReturnType<typeof resolveSavedVideoNoteArchiveExport>; folderPath: string; formats: VideoNoteBatchExportFormat[]; shouldContinue?: () => Promise<boolean> }
type BatchExportInternals = {
  /** Test-only writer substitution; it is deliberately kept out of the IPC request contract. */
  writeItem?: (input: BatchWriteInput) => Promise<string[] | BatchWriteOutcome>
  /** Test-only per-format writer, used to verify cancellation between Markdown and Word. */
  writeFormat?: (input: { saved: ReturnType<typeof resolveSavedVideoNoteArchiveExport>; destinationPath: string; format: VideoNoteBatchExportFormat }) => Promise<string>
}
type FileExportInternals = { openFile?: typeof open }
export type VideoNoteBatchExportRequest = {
  archives: VideoNoteArchiveEntry[]
  selections: Array<Pick<VideoNoteArchiveExportSelection, 'archiveId' | 'versionId'>>
  destinationDirectory: string
  formats: VideoNoteBatchExportFormat[]
  scope: VideoNoteExportScope
  currentContent?: VideoNoteCurrentContent
  includeNotes?: boolean
  signal?: AbortSignal
  /** Checked between sequential items so account changes cannot continue an old batch. */
  isCurrentAccount?: () => Promise<boolean>
  onProgress?: (event: { selectedCount: number; completedCount: number; succeededCount: number; skippedCount: number; failedCount: number }) => void
}

async function writeBatchItem(input: BatchWriteInput, internals: BatchExportInternals) {
  const stem = safeFileStem(input.saved.archive)
  const outcome: BatchWriteOutcome = { files: [], errors: [] }
  for (const format of input.formats) {
    if (input.shouldContinue && !await input.shouldContinue()) return { ...outcome, canceled: true }
    const destinationPath = join(input.folderPath, `${stem}.${format === 'markdown' ? 'md' : 'docx'}`)
    try {
      outcome.files.push(internals.writeFormat
        ? await internals.writeFormat({ saved: input.saved, destinationPath, format })
        : format === 'markdown'
          ? await writeVideoNoteMarkdownExport({ ...input.saved, destinationPath })
          : await writeVideoNoteWordExport({ ...input.saved, destinationPath }))
    } catch (error) {
      outcome.errors.push({ format, message: error instanceof Error ? error.message : 'Unable to write export file.' })
    }
  }
  return outcome
}

function normalizedWriteOutcome(value: string[] | BatchWriteOutcome): BatchWriteOutcome {
  return Array.isArray(value) ? { files: value, errors: [] } : value
}

function safeFileStem(archive: VideoNoteArchiveEntry) {
  const identity = archive.source.bvid ?? (archive.source.aid ? `AV${archive.source.aid}` : 'AVunknown')
  const title = (archive.source.title || 'bilimi-note').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'bilimi-note'
  return `${title.slice(0, 120)}_${identity}`
}

export function createVideoNoteBatchExportFolderName(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `bilimi文稿_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}

async function createNumberedFolder(destinationDirectory: string) {
  const parentDirectory = dirname(destinationDirectory)
  const baseName = basename(destinationDirectory)
  for (let index = 1; index < 10_000; index++) {
    const candidate = join(parentDirectory, index === 1 ? baseName : `${baseName} (${index})`)
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error('Unable to create a safe export folder.')
}

/** Sequentially exports only saved archive identities; invalid items are skipped without placeholder files. */
export async function exportVideoNoteArchiveBatch(request: VideoNoteBatchExportRequest, internals: BatchExportInternals = {}) {
  if (!request.formats.length || request.formats.some((format) => format !== 'markdown' && format !== 'word')) throw new Error('At least one export format is required.')
  const formats = [...new Set(request.formats)]
  const canContinue = async () => !request.signal?.aborted && (!request.isCurrentAccount || await request.isCurrentAccount())
  if (!await canContinue()) {
    return { folderPath: undefined, selectedCount: request.selections.length, exportableCount: 0, succeededCount: 0, skippedCount: 0, failedCount: 0, canceled: true, files: [] as string[], items: request.selections.map((selection) => ({ ...selection, status: 'canceled' as const, files: [] })) }
  }
  const initialExportable = request.selections.some((selection) => {
    try {
      resolveSavedVideoNoteArchiveExport(request.archives, { ...selection, scope: request.scope, currentContent: request.currentContent, includeNotes: request.includeNotes })
      return true
    } catch {
      return false
    }
  })
  if (!initialExportable) {
    const items = request.selections.map((selection) => ({ ...selection, status: 'skipped' as const, files: [], error: 'Saved archive or version is unavailable.' }))
    request.onProgress?.({ selectedCount: request.selections.length, completedCount: request.selections.length, succeededCount: 0, skippedCount: request.selections.length, failedCount: 0 })
    return { folderPath: undefined, selectedCount: request.selections.length, exportableCount: 0, succeededCount: 0, skippedCount: request.selections.length, failedCount: 0, canceled: false, files: [] as string[], items }
  }
  const folderPath = await createNumberedFolder(request.destinationDirectory)
  const result = { folderPath, selectedCount: request.selections.length, exportableCount: 0, succeededCount: 0, skippedCount: 0, failedCount: 0, canceled: false, files: [] as string[], items: [] as VideoNoteBatchExportItemResult[] }
  const publish = () => request.onProgress?.({ selectedCount: result.selectedCount, completedCount: result.succeededCount + result.skippedCount + result.failedCount, succeededCount: result.succeededCount, skippedCount: result.skippedCount, failedCount: result.failedCount })
  for (let index = 0; index < request.selections.length; index++) {
    const selection = request.selections[index]!
    if (!await canContinue()) {
      result.canceled = true
      for (const remaining of request.selections.slice(index)) result.items.push({ ...remaining, status: 'canceled', files: [] })
      break
    }
    let saved: ReturnType<typeof resolveSavedVideoNoteArchiveExport>
    try { saved = resolveSavedVideoNoteArchiveExport(request.archives, { ...selection, scope: request.scope, currentContent: request.currentContent, includeNotes: request.includeNotes }) } catch {
      result.skippedCount++
      result.items.push({ ...selection, status: 'skipped', files: [], error: 'Saved archive or version is unavailable.' })
      publish(); continue
    }
    result.exportableCount++
    try {
      const outcome = normalizedWriteOutcome(await (internals.writeItem
        ? internals.writeItem({ saved, folderPath, formats, shouldContinue: canContinue })
        : writeBatchItem({ saved, folderPath, formats, shouldContinue: canContinue }, internals)))
      result.files.push(...outcome.files)
      if (outcome.canceled) {
        result.canceled = true
        result.items.push({ ...selection, title: saved.archive.source.title, status: 'canceled', files: outcome.files })
        for (const remaining of request.selections.slice(index + 1)) result.items.push({ ...remaining, status: 'canceled', files: [] })
        break
      } else if (outcome.errors.length) {
        result.failedCount++
        result.items.push({ ...selection, title: saved.archive.source.title, status: 'failed', files: outcome.files, error: outcome.errors.map((error) => error.message).join('; ') })
      } else {
        result.succeededCount++
        result.items.push({ ...selection, title: saved.archive.source.title, status: 'succeeded', files: outcome.files })
      }
    } catch (error) {
      result.failedCount++
      result.items.push({ ...selection, title: saved.archive.source.title, status: 'failed', files: [], error: error instanceof Error ? error.message : 'Unable to write export files.' })
    }
    publish()
  }
  return result
}

function numberedPath(path: string, index: number, fallbackExtension: '.md' | '.docx' = '.md') {
  const extension = extname(path) || fallbackExtension
  const stem = basename(path, extension)
  return join(dirname(path), index === 1 ? `${stem}${extension}` : `${stem} (${index})${extension}`)
}

/** Uses exclusive creation so an existing user export is never overwritten. */
export async function writeVideoNoteMarkdownExport(request: VideoNoteMarkdownExportRequest, internals: FileExportInternals = {}) {
  const version = request.archive.versions.find((candidate) => candidate.id === request.versionId)
  if (!version) throw new Error('The selected archive version no longer exists.')
  const markdown = createVideoNoteMarkdown({ archive: request.archive, version, scope: request.scope, currentContent: request.currentContent, includeNotes: request.includeNotes })
  for (let index = 1; index < 10_000; index++) {
    const candidate = numberedPath(request.destinationPath, index)
    try {
      const file = await (internals.openFile ?? open)(candidate, 'wx')
      try {
        await file.writeFile(markdown, 'utf8')
      } finally {
        await file.close()
      }
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error('Unable to find a safe export filename.')
}

/** Generates the .docx in the main process and exclusively creates a safe destination file. */
export async function writeVideoNoteWordExport(request: VideoNoteWordExportRequest, internals: FileExportInternals = {}) {
  const version = request.archive.versions.find((candidate) => candidate.id === request.versionId)
  if (!version) throw new Error('The selected archive version no longer exists.')
  const document = createVideoNoteWord({ archive: request.archive, version, scope: request.scope, currentContent: request.currentContent, includeNotes: request.includeNotes })
  const buffer = await Packer.toBuffer(document)
  for (let index = 1; index < 10_000; index++) {
    const candidate = numberedPath(request.destinationPath, index, '.docx')
    try {
      const file = await (internals.openFile ?? open)(candidate, 'wx')
      try {
        await file.writeFile(buffer)
      } finally {
        await file.close()
      }
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error('Unable to find a safe export filename.')
}
