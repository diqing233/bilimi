type ArchiveIdentity = {
  id: string
  source: { accountMid?: string }
  versions: Array<{ id: string; note?: { userMemo: string; annotations: unknown[] } }>
}
import { randomUUID } from 'node:crypto'
import type { VideoNoteArchiveEntry } from '../../src/shared/types'

type Sender = { id: number; once?: (event: 'destroyed', listener: () => void) => void }
type IpcMain = { handle(channel: string, handler: (event: { sender: Sender }, ...args: never[]) => unknown): void }
type Request = { batchId?: unknown; accountMid?: unknown; selections?: unknown; formats?: unknown; scope?: unknown; currentContent?: unknown; includeNotes?: unknown }
type CompletedFolder = { accountMid: string; folderPath: string }
const MAX_BATCH_SELECTIONS = 10_000

function parse(request: Request, archives: ArchiveIdentity[]) {
  if (!request || typeof request !== 'object' || typeof request.accountMid !== 'string' || !/^\d+$/.test(request.accountMid) || !Array.isArray(request.selections) || !request.selections.length || request.selections.length > MAX_BATCH_SELECTIONS || !Array.isArray(request.formats) || !request.formats.length || request.formats.some((format) => format !== 'markdown' && format !== 'word')) throw new Error('Batch export request or format is invalid.')
  const selections = request.selections.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Batch export archive identity is invalid.')
    const item = value as { archiveId?: unknown; versionId?: unknown }
    if (typeof item.archiveId !== 'string' || typeof item.versionId !== 'string') throw new Error('Batch export archive identity is invalid.')
    const archive = archives.find((candidate) => candidate.id === item.archiveId)
    // Missing saved records are ordinary stale selections: the batch reports them as skips.
    // A record owned by another account remains a forged identity and must be rejected here.
    if (archive && archive.source.accountMid !== request.accountMid) throw new Error('Batch export archive identity is stale.')
    return { archiveId: item.archiveId, versionId: item.versionId }
  })
  const currentContents = ['plain', 'timed', 'summary', 'summary-precise', 'summary-outline', 'summary-polished'] as const
  if (request.currentContent !== undefined && !currentContents.includes(String(request.currentContent) as typeof currentContents[number])) throw new Error('Batch export current content is invalid.')
  return { selections, formats: [...new Set(request.formats as ('markdown' | 'word')[])], scope: request.scope === 'current' ? 'current' as const : 'complete' as const, ...(typeof request.currentContent === 'string' ? { currentContent: request.currentContent as typeof currentContents[number] } : {}), includeNotes: request.includeNotes === true }
}

export function registerVideoNoteBatchExportIpc(options: {
  ipcMain: IpcMain
  isTrustedSender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  archives: () => ArchiveIdentity[]
  chooseParentDirectory: () => Promise<string | undefined>
  start: (request: { archives: VideoNoteArchiveEntry[]; parentDirectory: string; selections: Array<{ archiveId: string; versionId: string }>; formats: Array<'markdown' | 'word'>; scope: 'current' | 'complete'; currentContent?: import('../../src/shared/videoNoteBatchExport').VideoNoteBatchExportCurrentContent; includeNotes: boolean; signal: AbortSignal; isCurrentAccount: () => Promise<boolean>; onProgress: (event: unknown) => void }) => Promise<unknown>
  openFolder: (path: string) => Promise<unknown> | unknown
  send?: (senderId: number, channel: string, value: unknown) => void
  completedFolderLimit?: number
}) {
  const active = new Map<number, { batchId: string; accountMid: string; controller: AbortController }>()
  const completedFolders = new Map<number, Map<string, CompletedFolder>>()
  const sessionListeners = new Set<number>()
  const configuredFolderLimit = options.completedFolderLimit ?? 8
  const completedFolderLimit = Number.isFinite(configuredFolderLimit) && configuredFolderLimit > 0
    ? Math.max(1, Math.floor(configuredFolderLimit))
    : 8
  const trusted = (event: { sender: Sender }) => { if (!options.isTrustedSender(event.sender.id)) throw new Error('Batch export came from an untrusted renderer.') }
  const assertCurrentAccount = async (accountMid: unknown) => {
    if (typeof accountMid !== 'string' || !/^\d+$/.test(accountMid)) throw new Error('Batch export account is invalid.')
    if (await options.getCurrentAccountMid() !== accountMid) throw new Error('Batch export request does not belong to the current account.')
  }
  const clearSender = (senderId: number) => {
    active.get(senderId)?.controller.abort()
    active.delete(senderId)
    completedFolders.delete(senderId)
    sessionListeners.delete(senderId)
  }
  const clearCompletedFoldersForAccount = (accountMid: string) => {
    for (const [senderId, activeBatch] of active) if (activeBatch.accountMid === accountMid) {
      activeBatch.controller.abort()
      active.delete(senderId)
    }
    for (const [senderId, folders] of completedFolders) {
      for (const [batchId, completed] of folders) if (completed.accountMid === accountMid) folders.delete(batchId)
      if (!folders.size) completedFolders.delete(senderId)
    }
  }
  const clearAll = () => {
    for (const activeBatch of active.values()) activeBatch.controller.abort()
    active.clear()
    completedFolders.clear()
  }
  const bindSenderSession = (sender: Sender) => {
    if (sessionListeners.has(sender.id)) return
    sessionListeners.add(sender.id)
    sender.once?.('destroyed', () => clearSender(sender.id))
  }
  const preview = async (event: { sender: Sender }, request: Request) => {
    trusted(event)
    await assertCurrentAccount(request.accountMid)
    const archives = options.archives()
    const parsed = parse(request, archives)
    await assertCurrentAccount(request.accountMid)
    return {
      selectedCount: parsed.selections.length,
      exportableCount: parsed.selections.filter((selection) => archives.some((archive) => archive.id === selection.archiveId && archive.source.accountMid === request.accountMid && archive.versions.some((version) => version.id === selection.versionId))).length,
      skippedCount: parsed.selections.filter((selection) => !archives.some((archive) => archive.id === selection.archiveId && archive.source.accountMid === request.accountMid && archive.versions.some((version) => version.id === selection.versionId))).length,
      hasNotes: parsed.selections.some((selection) => archives.find((archive) => archive.id === selection.archiveId)?.versions.some((version) => {
      const note = version.note
        return version.id === selection.versionId && Boolean(note && (note.userMemo.trim() || note.annotations.length > 0))
      }))
    }
  }
  options.ipcMain.handle('video-note-archives:batch-preview', preview)
  options.ipcMain.handle('video-note-archives:batch-start', async (event, request: Request) => {
    trusted(event); await assertCurrentAccount(request.accountMid); const archives = options.archives(); const parsed = parse(request, archives)
    const previous = active.get(event.sender.id)
    if (previous) {
      if (previous.accountMid === request.accountMid) throw new Error('A batch export is already active for this renderer.')
      previous.controller.abort()
      active.delete(event.sender.id)
    }
    const batchId = typeof request.batchId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(request.batchId) ? request.batchId : randomUUID()
    if (completedFolders.get(event.sender.id)?.has(batchId)) throw new Error('A batch export ID cannot be reused in this renderer session.')
    const controller = new AbortController()
    const activeBatch = { batchId, accountMid: request.accountMid as string, controller }
    active.set(event.sender.id, activeBatch); bindSenderSession(event.sender)
    try {
      const parentDirectory = await options.chooseParentDirectory()
      if (!parentDirectory || controller.signal.aborted) return undefined
      try { await assertCurrentAccount(activeBatch.accountMid) } catch (reason) { controller.abort(); throw reason }
      // The native directory chooser is asynchronous; use the current saved archive set for writes.
      const currentArchives = options.archives()
      // Revalidate against the refreshed snapshot: a reused ID must never cross accounts.
      const refreshed = parse(request, currentArchives)
      const result = await options.start({ archives: currentArchives as VideoNoteArchiveEntry[], parentDirectory, ...refreshed, signal: controller.signal,
        isCurrentAccount: async () => !controller.signal.aborted && await options.getCurrentAccountMid() === activeBatch.accountMid,
        onProgress: (value) => options.send?.(event.sender.id, 'video-note-archives:batch-progress', { batchId, ...(value as object) }) })
      const folderPath = (result as { folderPath?: unknown } | undefined)?.folderPath
      try { await assertCurrentAccount(activeBatch.accountMid) } catch (reason) { controller.abort(); throw reason }
      if (active.get(event.sender.id) === activeBatch && typeof folderPath === 'string' && folderPath) {
        const folders = completedFolders.get(event.sender.id) ?? new Map<string, CompletedFolder>()
        folders.set(batchId, { accountMid: request.accountMid as string, folderPath })
        while (folders.size > completedFolderLimit) folders.delete(folders.keys().next().value as string)
        completedFolders.set(event.sender.id, folders)
      }
      return { ...(result as object), batchId }
    } finally { if (active.get(event.sender.id) === activeBatch) active.delete(event.sender.id) }
  })
  options.ipcMain.handle('video-note-archives:batch-cancel', async (event: { sender: Sender }, input: unknown) => {
    trusted(event)
    const { batchId, accountMid } = input as { batchId?: unknown; accountMid?: unknown } ?? {}
    await assertCurrentAccount(accountMid)
    const current = active.get(event.sender.id)
    if (typeof batchId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(batchId) || !current || batchId !== current.batchId) return false
    if (current.accountMid !== accountMid) return false
    current.controller.abort()
    return true
  })
  options.ipcMain.handle('video-note-archives:batch-open-folder', async (event: { sender: Sender }, input: unknown) => {
    trusted(event)
    const { batchId, accountMid } = input as { batchId?: unknown; accountMid?: unknown } ?? {}
    if (typeof batchId !== 'string' || !batchId || typeof accountMid !== 'string' || !/^\d+$/.test(accountMid)) throw new Error('Batch export folder is invalid.')
    await assertCurrentAccount(accountMid)
    const completed = completedFolders.get(event.sender.id)?.get(batchId)
    if (!completed || completed.accountMid !== accountMid) throw new Error('Batch export folder is invalid.')
    return options.openFolder(completed.folderPath)
  })
  return { clearAll, clearCompletedFoldersForAccount }
}
