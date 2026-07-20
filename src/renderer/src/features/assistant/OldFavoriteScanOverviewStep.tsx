import type { OldFavoriteWorkspaceView } from '@shared/oldFavoriteWorkspace'

type OldFavoriteScanOverviewStepProps = {
  snapshot: OldFavoriteWorkspaceView | null
  loading: boolean
  scanStarting: boolean
  scanStartFailure: string | null
  onRetry: () => void
  onRebuild: () => void
  onSelectSourceFolders: (folderIds: string[]) => void
}

function scanFailureGuidance(reason: string | null | undefined) {
  const normalized = reason?.trim() ?? ''
  if (/^(target-unavailable|target-navigated|remote-ambiguous|remote-api-)/.test(normalized)) {
    return '无法确认当前 B站页面，请保持已登录的 B站页面打开后重新扫描。'
  }
  return normalized || '请重新扫描。'
}

export function OldFavoriteScanOverviewStep({
  snapshot,
  loading,
  scanStarting,
  scanStartFailure,
  onRetry,
  onRebuild,
  onSelectSourceFolders
}: OldFavoriteScanOverviewStepProps) {
  const recovery = snapshot && 'recovery' in snapshot ? snapshot : null
  if (recovery) {
    return <section className="favorite-ledger-panel__scan-overview" aria-label="扫描概览">
      <h4>扫描概览</h4>
      <p>工作镜像损坏，已完成的收藏库结果不会丢失。</p>
      <button type="button" disabled={loading} onClick={onRebuild}>重建工作镜像并重新扫描</button>
    </section>
  }

  const folders = snapshot?.sourceFolders ?? []
  const selectedSourceIds = new Set(folders
    .filter((folder) => folder.selected && !folder.isBilimiWorkFolder)
    .map((folder) => folder.id))
  const scanFailed = Boolean(scanStartFailure) || snapshot?.scan.phase === 'failed'
  const scanning = scanStarting || snapshot?.status === 'scanning' || !snapshot
  const sourceSelectionLocked = Boolean(snapshot && !recovery && Object.keys(snapshot.classifications).length > 0)
  const guidance = scanStartFailure
    ? `扫描启动失败：${scanFailureGuidance(scanStartFailure)}`
    : snapshot?.scan.phase === 'failed'
      ? `扫描失败：${scanFailureGuidance(snapshot.scan.reason)}`
      : scanning
        ? '扫描概览：扫描中'
        : '扫描概览已完成，正在准备归档预览。'

  return <section className="favorite-ledger-panel__scan-overview" aria-label="扫描概览">
    <h4>扫描概览</h4>
    <p className="favorite-ledger-panel__scan-guidance" role={scanFailed ? 'alert' : undefined}>{guidance}</p>
    <div className="favorite-ledger-panel__scan-progress" aria-label="旧藏扫描进度">
      <progress aria-label="收藏夹概览进度" max={1} value={scanFailed || scanning ? 0 : 1} />
      <strong>{scanFailed ? '扫描失败' : scanning ? '正在扫描' : '已完成'}</strong>
    </div>
    {scanFailed ? <button type="button" disabled={loading || scanStarting} onClick={onRetry}>重新扫描</button> : null}
    <p>已发现 {folders.length} 个收藏夹，当前扫描 {snapshot?.continuationCount ?? 0} 条待续新增。</p>
    <ul className="favorite-ledger-panel__scan-folder-list" aria-label="扫描收藏夹列表">
      {folders.map((folder) => <li key={folder.id}>
        {folder.isBilimiWorkFolder
          ? <span>{folder.title} · {folder.itemCount} 条 · Bilimi 工作夹</span>
          : <label>
            <input
              type="checkbox"
              aria-label={`选择来源 ${folder.title}`}
              checked={selectedSourceIds.has(folder.id)}
              disabled={loading || sourceSelectionLocked}
              onChange={(event) => {
                const next = new Set(selectedSourceIds)
                if (event.currentTarget.checked) next.add(folder.id); else next.delete(folder.id)
                onSelectSourceFolders([...next])
              }}
            />
            {folder.title} · {folder.itemCount} 条
          </label>}
      </li>)}
    </ul>
  </section>
}
