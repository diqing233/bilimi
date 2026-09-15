import { useState } from 'react'
import { BilimiModal } from '../../components/BilimiModal'
import { formatUserVisibleErrorMessage } from './userVisibleErrorMessage'

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
  onExport?: (scope: 'current' | 'selected' | 'all', uids?: string[]) => Promise<void> | void
  onImport?: () => Promise<ImportPreview | void>
  onApplyImport?: (previewToken: string, mode: 'merge' | 'overwrite') => Promise<void> | void
  onPreviewCleanup?: (level: CleanupLevel, uid?: string) => Promise<{ affectsBilibiliServerData: false; releasableBytes: number }> | void
  onApplyCleanup?: (level: CleanupLevel, uid?: string) => Promise<void> | void
  onDataChanged?: () => Promise<void> | void
}

const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`
const accountLabel = (account: Account) => account.nickname?.trim() ? `${account.nickname.trim()}（${account.uid}）` : account.uid

export function LocalDataSettings({ userDataPath, accounts, currentAccountUid, calculateUsage, onFullClear, onOpenPath, onExport, onImport, onApplyImport, onPreviewCleanup, onApplyCleanup, onDataChanged }: Props) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [busy, setBusy] = useState(false)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [exportScope, setExportScope] = useState<'current' | 'selected' | 'all'>('current')
  const [selectedUids, setSelectedUids] = useState<string[]>([])
  const [migrationProgress, setMigrationProgress] = useState('')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [cleanupPreview, setCleanupPreview] = useState('')
  const [approvedCleanup, setApprovedCleanup] = useState<{ level: Extract<CleanupLevel, 'cache' | 'current-account-temp'>; uid?: string } | null>(null)
  const [pendingDeletion, setPendingDeletion] = useState<'current' | 'all' | null>(null)
  const [selectedCleanupUid, setSelectedCleanupUid] = useState<string>()
  const currentStoredAccount = accounts.find((account) => account.uid === currentAccountUid)
  const cleanupAccount = currentStoredAccount ?? accounts.find((account) => account.uid === selectedCleanupUid) ?? accounts[0]
  const cleanupAccountUid = cleanupAccount?.uid
  const cleanupAccountLabel = cleanupAccount ? accountLabel(cleanupAccount) : currentAccountUid ? `当前账号（${currentAccountUid}）` : '当前账号'
  const deletingSignedInAccount = Boolean(cleanupAccountUid && cleanupAccountUid === currentAccountUid)
  const cleanupButtonLabel = currentStoredAccount ? '预览删除当前账号本地数据' : cleanupAccount ? `预览删除${cleanupAccountLabel}本地数据` : ''
  const deletionConfirmationLabel = deletingSignedInAccount ? '确认删除当前账号本地数据' : `确认删除${cleanupAccountLabel}本地数据`
  const recalculate = async () => { setBusy(true); try { setUsage(await calculateUsage()) } finally { setBusy(false) } }
  const toggleUid = (uid: string) => setSelectedUids((current) => current.includes(uid) ? current.filter((item) => item !== uid) : [...current, uid])
  const applyImport = async (mode: 'merge' | 'overwrite') => {
    if (!importPreview?.token) return
    setMigrationProgress('正在导入')
    try { await onApplyImport?.(importPreview.token, mode); await onDataChanged?.(); setImportPreview(null); setMigrationProgress('导入完成') } catch { setMigrationProgress('导入失败') }
  }
  const previewCleanup = async (level: Extract<CleanupLevel, 'cache' | 'current-account-temp'>, uid?: string) => {
    setCleanupPreview('正在生成清理预览'); setApprovedCleanup(null)
    try {
      const preview = await onPreviewCleanup?.(level, uid)
      setApprovedCleanup({ level, ...(uid ? { uid } : {}) })
      setCleanupPreview(`预计释放 ${formatBytes(preview?.releasableBytes ?? 0)}；不会修改 B 站服务器数据。`)
    } catch { setCleanupPreview('清理预览失败') }
  }
  const applyCleanup = async () => {
    if (!approvedCleanup) return
    setCleanupPreview('正在清理')
    try { await onApplyCleanup?.(approvedCleanup.level, approvedCleanup.uid); await onDataChanged?.(); setApprovedCleanup(null); setCleanupPreview('清理完成') } catch (error) { setCleanupPreview(formatUserVisibleErrorMessage(error, '清理失败，请重试。')) }
  }
  const exportData = async () => {
    setMigrationProgress('正在导出')
    try { if (exportScope === 'selected') await onExport?.(exportScope, selectedUids); else await onExport?.(exportScope); setMigrationProgress('导出完成') } catch { setMigrationProgress('导出失败') }
  }
  const previewImport = async () => {
    setMigrationProgress('正在读取导入预览')
    try { const preview = await onImport?.(); setImportPreview(preview ? { token: preview.token, accounts: preview.accounts ?? [] } : null); setMigrationProgress('导入预览已就绪') } catch { setMigrationProgress('导入预览失败') }
  }
  const confirmDeletion = async () => {
    const deletion = pendingDeletion
    setPendingDeletion(null)
    setCleanupPreview('正在清理')
    try {
      if (deletion === 'current' && cleanupAccountUid) await onApplyCleanup?.('current-account-data', cleanupAccountUid)
      if (deletion === 'all') await onFullClear()
      if (deletion !== 'all' && cleanupAccountUid !== currentAccountUid) await onDataChanged?.()
      setCleanupPreview('清理完成')
    } catch (error) {
      setCleanupPreview(formatUserVisibleErrorMessage(error, '清理失败，请重试。'))
    }
  }

  return <section className="local-data-settings" aria-label="本地数据与迁移">
    <section className="local-data-settings__section" aria-labelledby="local-data-heading">
      <h2 id="local-data-heading" className="local-data-settings__heading">本地数据</h2>
      <div className="local-data-settings__line"><span>数据路径</span><code>{userDataPath}</code><button type="button" onClick={onOpenPath}>打开文件位置</button></div>
      <div className="local-data-settings__line"><span>占用空间</span><p>{usage ? `磁盘使用：${formatBytes(usage.totalBytes)}` : '尚未计算'}</p><button type="button" onClick={recalculate} disabled={busy}>{busy ? '正在计算' : '重新计算'}</button></div>
      {usage?.categories ? <ul className="local-data-settings__usage" aria-label="磁盘使用分类"><li>账号持久数据：{formatBytes(usage.categories.accountPersistent.bytes)}</li><li>设备共享设置：{formatBytes(usage.categories.deviceShared.bytes)}</li><li>缓存：{formatBytes(usage.categories.cache.bytes)}</li><li>临时音频：{formatBytes(usage.categories.temporaryAudio.bytes)}</li><li>日志：{formatBytes(usage.categories.logs.bytes)}</li></ul> : null}
      <div className="local-data-settings__accounts"><span>本机保存 {accounts.length} 个账号的数据</span><button type="button" aria-expanded={accountsOpen} onClick={() => setAccountsOpen((open) => !open)}>{accountsOpen ? '收起账号列表' : '查看账号列表'}</button></div>
      {accountsOpen ? <ul className="local-data-settings__account-list">{accounts.map((account) => <li key={account.uid}>{accountLabel(account)}</li>)}</ul> : null}
    </section>
    <section className="local-data-settings__section" aria-labelledby="migration-heading">
      <h2 id="migration-heading" className="local-data-settings__heading">数据迁移</h2><p>导出本机账号数据以备份或迁移；导入前会先生成预览，不会立即覆盖现有数据。</p>
      <div className="local-data-settings__segmented" role="radiogroup" aria-label="导出范围"><label><input type="radio" name="migration-scope" checked={exportScope === 'current'} onChange={() => setExportScope('current')} />当前账号</label><label><input type="radio" name="migration-scope" checked={exportScope === 'selected'} onChange={() => setExportScope('selected')} />所选账号</label><label><input type="radio" name="migration-scope" checked={exportScope === 'all'} onChange={() => setExportScope('all')} />全部账号</label></div>
      {exportScope === 'selected' ? <div className="local-data-settings__selected-accounts" aria-label="选择导出账号">{accounts.map((account) => <label key={account.uid}><input type="checkbox" aria-label={`导出账号 ${accountLabel(account)}`} checked={selectedUids.includes(account.uid)} onChange={() => toggleUid(account.uid)} />{accountLabel(account)}</label>)}</div> : null}
      <div className="local-data-settings__actions"><button type="button" className="local-data-settings__primary" disabled={exportScope === 'selected' && !selectedUids.length} onClick={() => void exportData()}>导出数据</button><button type="button" onClick={() => void previewImport()}>导入并预览</button></div>
      {migrationProgress && <p role="status">{migrationProgress}</p>}{importPreview && <div className="local-data-settings__preview"><ul aria-label="导入预览">{importPreview.accounts.map((item) => <li key={item.uid}>{item.uid}：{item.action}</li>)}</ul><p>先校验并暂存；请选择导入方式。</p><button type="button" disabled={!importPreview.token} onClick={() => void applyImport('merge')}>按 UID 合并并保留较新记录</button><button type="button" disabled={!importPreview.token} onClick={() => void applyImport('overwrite')}>覆盖所选账号的本地数据</button></div>}
    </section>
    <section className="local-data-settings__section" aria-labelledby="data-management-heading">
      <h2 id="data-management-heading" className="local-data-settings__heading"><button type="button" className="local-data-settings__section-toggle" onClick={() => setCleanupOpen((open) => !open)} aria-expanded={cleanupOpen}>管理数据<svg className="local-data-settings__section-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button></h2><p>清理不会修改 B 站服务器数据。先查看预估范围，确认后才会执行。</p>
      {cleanupOpen ? <><div className="local-data-settings__actions"><button type="button" onClick={() => void previewCleanup('cache')}>预览清理缓存</button><button type="button" disabled={!cleanupAccountUid} onClick={() => void previewCleanup('current-account-temp', cleanupAccountUid)}>预览清理当前账号临时数据</button></div>{!currentStoredAccount && accounts.length > 1 ? <label className="local-data-settings__check">选择要删除的账号<select aria-label="选择要删除的账号" value={cleanupAccountUid ?? ''} onChange={(event) => setSelectedCleanupUid(event.target.value)}>{accounts.map((account) => <option key={account.uid} value={account.uid}>{accountLabel(account)}</option>)}</select></label> : null}{!cleanupAccountUid ? <p className="local-data-settings__empty">本机没有可删除的账号数据。</p> : null}{cleanupPreview && <p role="status">{cleanupPreview}</p>}{approvedCleanup && <button type="button" onClick={() => void applyCleanup()}>执行{approvedCleanup.level === 'cache' ? '清理缓存' : '清理当前账号临时数据'}</button>}<div className="local-data-settings__danger-actions">{cleanupAccountUid ? <button type="button" className="local-data-settings__danger-button" onClick={() => setPendingDeletion('current')}>{cleanupButtonLabel}</button> : null}<button type="button" className="local-data-settings__danger-button" onClick={() => setPendingDeletion('all')}>清除全部用户数据</button></div></> : null}
      {pendingDeletion ? <BilimiModal title={pendingDeletion === 'current' ? deletionConfirmationLabel : '确认清除全部本地数据'} tone="danger" className="local-data-settings__confirmation" onClose={() => setPendingDeletion(null)} actions={<><button type="button" onClick={() => setPendingDeletion(null)}>取消</button><button type="button" data-variant="danger" className="local-data-settings__danger-button" onClick={() => void confirmDeletion()}>{pendingDeletion === 'current' ? deletionConfirmationLabel : '确认清除全部本地数据'}</button></>}><p>{pendingDeletion === 'current' ? `将删除 ${cleanupAccountLabel} 在本机保存的收藏库、设置、归档、转写和操作记录${deletingSignedInAccount ? '，并退出当前 B 站登录' : ''}，不会删除 B 站服务器数据。` : '将删除这台电脑中所有 bilimi 账号数据、登录状态和缓存，不会删除 B 站服务器数据。'}</p></BilimiModal> : null}
    </section>
  </section>
}
