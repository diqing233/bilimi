import type { LocalDataCleanupLevel, LocalDataService } from './localDataService'

type IpcEvent = { sender: { id: number } }
type IpcMain = { handle(channel: string, handler: (event: IpcEvent, ...args: never[]) => unknown): void }

function account(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value.trim()) || BigInt(value.trim()) === 0n) throw new Error('Local data account is invalid.')
  return BigInt(value.trim()).toString()
}

function cleanup(value: unknown): LocalDataCleanupLevel {
  if (value === 'cache' || value === 'current-account-temp' || value === 'current-account-data' || value === 'all-user-data') return value
  throw new Error('Local data cleanup level is invalid.')
}

/** Registers narrow migration actions; the renderer never receives arbitrary paths or filesystem access. */
export function registerLocalDataIpc(options: {
  ipcMain: IpcMain
  service: LocalDataService
  isTrustedSender: (senderId: number) => boolean
  getCurrentAccountMid: () => Promise<string>
  getCurrentAccount: () => Promise<{ mid: string; nickname?: string }>
  userDataPath: string
  chooseExportPath: () => Promise<string | undefined>
  chooseImportPath: () => Promise<string | undefined>
  openUserDataPath: () => Promise<void>
  onCurrentAccountDataClear?: (accountMid: string, clearLocalData: () => Promise<void>) => Promise<void>
  onAccountDataCleared?: (accountMid: string) => void
}) {
  const trusted = (event: IpcEvent) => {
    if (!options.isTrustedSender(event.sender.id)) throw new Error('Local data request came from an untrusted renderer.')
  }
  const current = async () => account(await options.getCurrentAccountMid())
  options.ipcMain.handle('local-data:get-info', async (event) => {
    trusted(event)
    const accounts = await options.service.listAccounts()
    const currentAccount: { mid: string; nickname?: string } = await options.getCurrentAccount().catch(() => ({ mid: '', nickname: undefined }))
    const currentUid = /^\d+$/u.test(currentAccount.mid) && BigInt(currentAccount.mid) > 0n ? BigInt(currentAccount.mid).toString() : undefined
    const nickname = currentAccount.nickname?.trim()
    return {
      path: options.userDataPath,
      accounts: accounts.map((item) => item.uid === currentUid && nickname ? { ...item, nickname } : item)
    }
  })
  options.ipcMain.handle('local-data:calculate-usage', async (event) => { trusted(event); return options.service.calculateUsage() })
  options.ipcMain.handle('local-data:open-path', async (event) => { trusted(event); await options.openUserDataPath() })
  options.ipcMain.handle('local-data:export', async (event, input: { scope?: unknown; uids?: unknown }) => {
    trusted(event)
    const destination = await options.chooseExportPath()
    if (!destination) return { cancelled: true }
    const scope = input?.scope
    const all = await options.service.listAccounts()
    const uids = scope === 'all' ? all.map((item) => item.uid)
      : scope === 'selected' && Array.isArray(input?.uids) && input.uids.length
        ? input.uids.map(account)
        : scope === 'current' ? [await current()] : (() => { throw new Error('Local data export scope is invalid.') })()
    return options.service.exportArchive({ uids, outputPath: destination })
  })
  options.ipcMain.handle('local-data:preview-import', async (event) => {
    trusted(event)
    const source = await options.chooseImportPath()
    return source ? options.service.previewImport(source) : { cancelled: true }
  })
  options.ipcMain.handle('local-data:apply-import', async (event, preview: unknown, mode: unknown) => {
    trusted(event)
    if ((mode !== 'merge' && mode !== 'overwrite') || typeof preview !== 'string' || !preview.trim()) throw new Error('Local data import request is invalid.')
    return options.service.applyImport({ token: preview }, { mode })
  })
  options.ipcMain.handle('local-data:preview-cleanup', async (event, level: unknown, requestedUid?: unknown, confirmation?: unknown) => {
    trusted(event)
    const parsed = cleanup(level)
    const uid = parsed === 'cache' || parsed === 'all-user-data' ? undefined : requestedUid === undefined ? await current() : account(requestedUid)
    return options.service.previewCleanup({ level: parsed, ...(uid ? { uid } : {}), ...(typeof confirmation === 'string' ? { confirmation } : {}) })
  })
  options.ipcMain.handle('local-data:apply-cleanup', async (event, level: unknown, requestedUid?: unknown, confirmation?: unknown) => {
    trusted(event)
    const parsed = cleanup(level)
    const uid = parsed === 'cache' || parsed === 'all-user-data' ? undefined : requestedUid === undefined ? await current() : account(requestedUid)
    const clearLocalData = () => options.service.applyCleanup({ level: parsed, ...(uid ? { uid } : {}), ...(typeof confirmation === 'string' ? { confirmation } : {}) })
    const currentUid = parsed === 'current-account-data' && uid
      ? await options.getCurrentAccountMid().then(account).catch(() => '')
      : ''
    const result = parsed === 'current-account-data' && uid === currentUid && options.onCurrentAccountDataClear
      ? await options.onCurrentAccountDataClear(uid, clearLocalData)
      : await clearLocalData()
    if (parsed === 'current-account-data' && uid) options.onAccountDataCleared?.(uid)
    return result
  })
}
