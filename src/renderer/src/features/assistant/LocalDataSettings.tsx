import { useState } from 'react'

type Account = { uid: string; nickname?: string; retained: boolean }
type Usage = {
  totalBytes: number
  calculatedAt: string
  categories?: Record<'accountPersistent' | 'deviceShared' | 'cache' | 'temporaryAudio' | 'logs', { bytes: number }>
}
type ImportPreview = { token?: string; accounts: Array<{ uid: string; action: string }> }
type CleanupLevel = 'cache' | 'current-account-temp' | 'current-account-data'
type Props = {
  userDataPath: string
  accounts: Account[]
  currentAccountUid?: string
  calculateUsage: () => Promise<Usage>
  onFullClear: () => Promise<void> | void
  onOpenPath?: () => void
  onExport?: (scope: 'current' | 'selected' | 'all', includeSharedSettings: boolean, uids?: string[]) => Promise<void> | void
  onImport?: () => Promise<ImportPreview | void>
  onApplyImport?: (previewToken: string, mode: 'merge' | 'overwrite') => Promise<void> | void
  onPreviewCleanup?: (level: CleanupLevel, uid?: string) => Promise<{ affectsBilibiliServerData: false }> | void
}

const formatBytes = (bytes: number) => bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`

export function LocalDataSettings({ userDataPath, accounts, currentAccountUid, calculateUsage, onFullClear, onOpenPath, onExport, onImport, onApplyImport, onPreviewCleanup }: Props) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [dangerOpen, setDangerOpen] = useState(false)
  const [exportScope, setExportScope] = useState<'current' | 'selected' | 'all'>('current')
  const [selectedUids, setSelectedUids] = useState<string[]>([])
  const [includeSharedSettings, setIncludeSharedSettings] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [cleanupPreview, setCleanupPreview] = useState('')
  const recalculate = async () => { setBusy(true); try { setUsage(await calculateUsage()) } finally { setBusy(false) } }
  const toggleUid = (uid: string) => setSelectedUids((current) => current.includes(uid) ? current.filter((item) => item !== uid) : [...current, uid])
  const applyImport = async (mode: 'merge' | 'overwrite') => {
    if (!importPreview?.token) return
    setMigrationProgress('正在导入')
    try {
      await onApplyImport?.(importPreview.token, mode)
      setImportPreview(null)
      setMigrationProgress('导入完成')
    } catch { setMigrationProgress('导入失败') }
  }
  const previewCleanup = async (level: CleanupLevel, uid?: string) => {
    setCleanupPreview('正在生成清理预览')
    try {
      await onPreviewCleanup?.(level, uid)
      setCleanupPreview('清理预览已就绪：不会修改 B 站服务器数据。')
    } catch { setCleanupPreview('清理预览失败') }
  }
  return <section aria-label="本地数据与迁移">
    <h2>本地数据与迁移</h2><p>用户数据位置：<code>{userDataPath}</code></p>
    <button type="button" onClick={onOpenPath}>打开文件位置</button>
    <button type="button" onClick={recalculate} disabled={busy}>{busy ? '正在计算' : '重新计算'}</button>
    {usage && <><p>磁盘使用：{formatBytes(usage.totalBytes)}；上次计算：{usage.calculatedAt}</p>{usage.categories ? <ul aria-label="磁盘使用分类"><li>账号持久数据：{formatBytes(usage.categories.accountPersistent.bytes)}</li><li>设备共享设置：{formatBytes(usage.categories.deviceShared.bytes)}</li><li>缓存：{formatBytes(usage.categories.cache.bytes)}</li><li>临时音频：{formatBytes(usage.categories.temporaryAudio.bytes)}</li><li>日志：{formatBytes(usage.categories.logs.bytes)}</li></ul> : null}</>}
    <h3>保留本地数据的账户</h3><ul>{accounts.map((account) => <li key={account.uid}><strong>{account.uid}</strong>{account.nickname ? `（${account.nickname}，仅显示）` : ''}</li>)}</ul>
    <fieldset><legend>导出范围</legend><label><input type="radio" name="migration-scope" checked={exportScope === 'current'} onChange={() => setExportScope('current')} />当前账户</label><label><input type="radio" name="migration-scope" checked={exportScope === 'selected'} onChange={() => setExportScope('selected')} />所选账户</label><label><input type="radio" name="migration-scope" checked={exportScope === 'all'} onChange={() => setExportScope('all')} />全部账户</label>{exportScope === 'selected' ? <div aria-label="选择导出账户">{accounts.map((account) => <label key={account.uid}><input type="checkbox" aria-label={`导出账户 ${account.uid}`} checked={selectedUids.includes(account.uid)} onChange={() => toggleUid(account.uid)} />{account.uid}</label>)}</div> : null}<label><input type="checkbox" checked={includeSharedSettings} onChange={(event) => setIncludeSharedSettings(event.target.checked)} />包含非敏感共享设置</label></fieldset>
    <button type="button" disabled={exportScope === 'selected' && !selectedUids.length} onClick={async () => { setMigrationProgress('正在导出'); try { if (exportScope === 'selected') await onExport?.(exportScope, includeSharedSettings, selectedUids); else await onExport?.(exportScope, includeSharedSettings); setMigrationProgress('导出完成') } catch { setMigrationProgress('导出失败') } }}>导出数据</button>
    <button type="button" onClick={async () => { setMigrationProgress('正在读取导入预览'); try { const preview = await onImport?.(); setImportPreview(preview ? { token: preview.token, accounts: preview.accounts ?? [] } : null); setMigrationProgress('导入预览已就绪') } catch { setMigrationProgress('导入预览失败') } }}>导入并预览</button>
    {migrationProgress && <p role="status">{migrationProgress}</p>}{importPreview && <><ul aria-label="导入预览">{importPreview.accounts.map((item) => <li key={item.uid}>{item.uid}：{item.action}</li>)}</ul><p>先校验并暂存；请选择导入方式。</p><button type="button" disabled={!importPreview.token} onClick={() => void applyImport('merge')}>按UID合并并保留较新记录</button><button type="button" disabled={!importPreview.token} onClick={() => void applyImport('overwrite')}>覆盖所选账户的本地数据</button></>}
    <fieldset><legend>安全清理预览</legend><button type="button" onClick={() => void previewCleanup('cache')}>预览清理缓存</button><button type="button" disabled={!currentAccountUid} onClick={() => void previewCleanup('current-account-temp', currentAccountUid)}>预览清理当前账户临时数据</button>{currentAccountUid ? <button type="button" onClick={() => void previewCleanup('current-account-data', currentAccountUid)}>预览删除当前账户本地数据</button> : null}</fieldset>
    {cleanupPreview && <p role="status">{cleanupPreview}</p>}
    <button type="button" onClick={() => setDangerOpen(true)}>清除全部用户数据</button>
    {dangerOpen && <details open><summary>危险操作</summary><p>不会改动 B 站服务器收藏；未知远程结果的对账记录也会丢失。</p><label>输入 全部清除 以确认<input aria-label="输入 全部清除 以确认" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button type="button" disabled={confirmation !== '全部清除'} onClick={() => void onFullClear()}>清除并退出</button></details>}
  </section>
}
