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
  onApplyCleanup?: (level: CleanupLevel, uid?: string) => Promise<void> | void
}

const formatBytes = (bytes: number) => bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`

export function LocalDataSettings({ userDataPath, accounts, currentAccountUid, calculateUsage, onFullClear, onOpenPath, onExport, onImport, onApplyImport, onPreviewCleanup, onApplyCleanup }: Props) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [dangerOpen, setDangerOpen] = useState(false)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [exportScope, setExportScope] = useState<'current' | 'selected' | 'all'>('current')
  const [selectedUids, setSelectedUids] = useState<string[]>([])
  const [includeSharedSettings, setIncludeSharedSettings] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [cleanupPreview, setCleanupPreview] = useState('')
  const [approvedCleanup, setApprovedCleanup] = useState<{ level: CleanupLevel; uid?: string } | null>(null)
  const recalculate = async () => { setBusy(true); try { setUsage(await calculateUsage()) } finally { setBusy(false) } }
  const toggleUid = (uid: string) => setSelectedUids((current) => current.includes(uid) ? current.filter((item) => item !== uid) : [...current, uid])
  const applyImport = async (mode: 'merge' | 'overwrite') => {
    if (!importPreview?.token) return
    setMigrationProgress('正在导入')
    try { await onApplyImport?.(importPreview.token, mode); setImportPreview(null); setMigrationProgress('导入完成') } catch { setMigrationProgress('导入失败') }
  }
  const previewCleanup = async (level: CleanupLevel, uid?: string) => {
    setCleanupPreview('正在生成清理预览'); setApprovedCleanup(null)
    try { await onPreviewCleanup?.(level, uid); setApprovedCleanup({ level, ...(uid ? { uid } : {}) }); setCleanupPreview('清理预览已就绪：不会修改 B 站服务器数据。') } catch { setCleanupPreview('清理预览失败') }
  }
  const applyCleanup = async () => {
    if (!approvedCleanup) return
    setCleanupPreview('正在清理')
    try { await onApplyCleanup?.(approvedCleanup.level, approvedCleanup.uid); setApprovedCleanup(null); setCleanupPreview('清理完成') } catch { setCleanupPreview('清理失败') }
  }
  const exportData = async () => {
    setMigrationProgress('正在导出')
    try { if (exportScope === 'selected') await onExport?.(exportScope, includeSharedSettings, selectedUids); else await onExport?.(exportScope, includeSharedSettings); setMigrationProgress('导出完成') } catch { setMigrationProgress('导出失败') }
  }
  const previewImport = async () => {
    setMigrationProgress('正在读取导入预览')
    try { const preview = await onImport?.(); setImportPreview(preview ? { token: preview.token, accounts: preview.accounts ?? [] } : null); setMigrationProgress('导入预览已就绪') } catch { setMigrationProgress('导入预览失败') }
  }

  return <section className="local-data-settings" aria-label="本地数据与迁移">
    <section className="local-data-settings__section" aria-labelledby="local-data-heading">
      <h2 id="local-data-heading">本地数据</h2>
      <div className="local-data-settings__line"><span>数据路径</span><code>{userDataPath}</code><button type="button" onClick={onOpenPath}>打开文件位置</button></div>
      <div className="local-data-settings__line"><span>占用空间</span><p>{usage ? `磁盘使用：${formatBytes(usage.totalBytes)}` : '尚未计算'}</p><button type="button" onClick={recalculate} disabled={busy}>{busy ? '正在计算' : '重新计算'}</button></div>
      {usage?.categories ? <ul className="local-data-settings__usage" aria-label="磁盘使用分类"><li>账号持久数据：{formatBytes(usage.categories.accountPersistent.bytes)}</li><li>设备共享设置：{formatBytes(usage.categories.deviceShared.bytes)}</li><li>缓存：{formatBytes(usage.categories.cache.bytes)}</li><li>临时音频：{formatBytes(usage.categories.temporaryAudio.bytes)}</li><li>日志：{formatBytes(usage.categories.logs.bytes)}</li></ul> : null}
      <div className="local-data-settings__accounts"><span>本机保存 {accounts.length} 个账号的数据</span><button type="button" aria-expanded={accountsOpen} onClick={() => setAccountsOpen((open) => !open)}>{accountsOpen ? '收起账号列表' : '查看账号列表'}</button></div>
      {accountsOpen ? <ul className="local-data-settings__account-list">{accounts.map((account) => <li key={account.uid}><strong>{account.uid}</strong>{account.nickname ? `（${account.nickname}）` : ''}</li>)}</ul> : null}
    </section>
    <section className="local-data-settings__section" aria-labelledby="migration-heading">
      <h2 id="migration-heading">数据迁移</h2><p>导出本机数据以备份或迁移；导入前会先生成预览，不会立即覆盖现有数据。</p>
      <div className="local-data-settings__segmented" role="radiogroup" aria-label="导出范围"><label><input type="radio" name="migration-scope" checked={exportScope === 'current'} onChange={() => setExportScope('current')} />当前账户</label><label><input type="radio" name="migration-scope" checked={exportScope === 'selected'} onChange={() => setExportScope('selected')} />所选账户</label><label><input type="radio" name="migration-scope" checked={exportScope === 'all'} onChange={() => setExportScope('all')} />全部账户</label></div>
      {exportScope === 'selected' ? <div className="local-data-settings__selected-accounts" aria-label="选择导出账户">{accounts.map((account) => <label key={account.uid}><input type="checkbox" aria-label={`导出账户 ${account.uid}`} checked={selectedUids.includes(account.uid)} onChange={() => toggleUid(account.uid)} />{account.uid}</label>)}</div> : null}
      <label className="local-data-settings__check"><input type="checkbox" checked={includeSharedSettings} onChange={(event) => setIncludeSharedSettings(event.target.checked)} />包含非敏感共享设置</label>
      <div className="local-data-settings__actions"><button type="button" className="local-data-settings__primary" disabled={exportScope === 'selected' && !selectedUids.length} onClick={() => void exportData()}>导出数据</button><button type="button" onClick={() => void previewImport()}>导入并预览</button></div>
      {migrationProgress && <p role="status">{migrationProgress}</p>}{importPreview && <div className="local-data-settings__preview"><ul aria-label="导入预览">{importPreview.accounts.map((item) => <li key={item.uid}>{item.uid}：{item.action}</li>)}</ul><p>先校验并暂存；请选择导入方式。</p><button type="button" disabled={!importPreview.token} onClick={() => void applyImport('merge')}>按UID合并并保留较新记录</button><button type="button" disabled={!importPreview.token} onClick={() => void applyImport('overwrite')}>覆盖所选账户的本地数据</button></div>}
    </section>
    <section className="local-data-settings__section local-data-settings__section--danger" aria-labelledby="danger-heading">
      <h2 id="danger-heading">危险操作</h2><p>清理不会修改 B 站服务器数据。先查看预估范围，确认后才会执行。</p>
      <div className="local-data-settings__actions"><button type="button" onClick={() => void previewCleanup('cache')}>预览清理缓存</button><button type="button" onClick={() => setCleanupOpen((open) => !open)} aria-expanded={cleanupOpen}>管理数据…</button></div>
      {cleanupOpen ? <div className="local-data-settings__cleanup"><button type="button" disabled={!currentAccountUid} onClick={() => void previewCleanup('current-account-temp', currentAccountUid)}>预览清理当前账户临时数据</button>{currentAccountUid ? <button type="button" onClick={() => void previewCleanup('current-account-data', currentAccountUid)}>预览删除当前账户本地数据</button> : null}</div> : null}
      {cleanupPreview && <p role="status">{cleanupPreview}</p>}{approvedCleanup && <button type="button" onClick={() => void applyCleanup()}>执行{approvedCleanup.level === 'cache' ? '清理缓存' : approvedCleanup.level === 'current-account-temp' ? '清理当前账户临时数据' : '删除当前账户本地数据'}</button>}
      <button type="button" className="local-data-settings__danger-button" onClick={() => setDangerOpen(true)}>清除全部用户数据</button>
      {dangerOpen && <div className="local-data-settings__confirmation" role="alertdialog" aria-label="确认清除全部数据"><p>不会改动 B 站服务器收藏；未知远程结果的对账记录也会丢失。</p><label>输入 全部清除 以确认<input aria-label="输入 全部清除 以确认" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button type="button" disabled={confirmation !== '全部清除'} onClick={() => void onFullClear()}>清除并退出</button></div>}
    </section>
  </section>
}
