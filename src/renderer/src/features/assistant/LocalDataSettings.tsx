import { useState } from 'react'

type Account = { uid: string; nickname?: string; retained: boolean }
type Usage = { totalBytes: number; calculatedAt: string }
type Props = { userDataPath: string; accounts: Account[]; calculateUsage: () => Promise<Usage>; onFullClear: () => void; onOpenPath?: () => void; onExport?: () => void; onImport?: () => void }
const formatBytes = (bytes: number) => bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`

export function LocalDataSettings({ userDataPath, accounts, calculateUsage, onFullClear, onOpenPath, onExport, onImport }: Props) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [dangerOpen, setDangerOpen] = useState(false)
  const recalculate = async () => { setBusy(true); try { setUsage(await calculateUsage()) } finally { setBusy(false) } }
  return <section aria-label="本地数据与迁移">
    <h2>本地数据与迁移</h2><p>用户数据位置：<code>{userDataPath}</code></p>
    <button type="button" onClick={onOpenPath}>打开文件位置</button>
    <button type="button" onClick={recalculate} disabled={busy}>{busy ? '正在计算' : '重新计算'}</button>
    {usage && <p>磁盘使用：{formatBytes(usage.totalBytes)}；上次计算：{usage.calculatedAt}</p>}
    <h3>保留本地数据的账户</h3><ul>{accounts.map((account) => <li key={account.uid}><strong>{account.uid}</strong>{account.nickname ? `（${account.nickname}，仅显示）` : ''}</li>)}</ul>
    <button type="button" onClick={onExport}>导出所选账户</button><button type="button" onClick={onImport}>导入并预览</button>
    <button type="button" onClick={() => setDangerOpen(true)}>清除全部用户数据</button>
    {dangerOpen && <details open><summary>危险操作</summary><p>不会改动 B 站服务器收藏；未知远程结果的对账记录也会丢失。</p><label>输入 全部清除 以确认<input aria-label="输入 全部清除 以确认" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button type="button" disabled={confirmation !== '全部清除'} onClick={onFullClear}>清除并退出</button></details>}
  </section>
}
