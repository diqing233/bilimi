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
  if (normalized === 'page-execution-failed') {
    return '无法读取当前 B站页面，请保持已登录的 B站页面打开并等待页面加载完成后重新扫描。'
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
  const userFolders = folders.filter((folder) => !folder.isBilimiWorkFolder)
  const bilimiFolders = folders.filter((folder) => folder.isBilimiWorkFolder)
  const selectedSourceIds = new Set(userFolders
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
      <div>
        <span>收藏夹概览</span>
        <progress aria-label="收藏夹概览进度" max={1} value={scanFailed || scanning ? 0 : 1} />
        <strong>{scanFailed ? '扫描失败' : scanning ? '正在扫描' : '已完成'}</strong>
      </div>
    </div>
    {scanFailed ? <button type="button" disabled={loading || scanStarting} onClick={onRetry}>重新扫描</button> : null}
    <p>已发现 {folders.length} 个收藏夹，当前扫描 {snapshot?.continuationCount ?? 0} 条待续新增。</p>
    {userFolders.length ? <div className="favorite-ledger-panel__source-table" role="table" aria-label="用户收藏夹">
      <div role="row" className="favorite-ledger-panel__source-header favorite-ledger-panel__source-header--user">
        <span role="columnheader" aria-label="选择" /><span role="columnheader">用户收藏夹</span>
        <span role="columnheader">总数</span><span role="columnheader">本轮待整理</span>
      </div>
      <ul role="rowgroup" className="favorite-ledger-panel__source-list">
        {userFolders.map((folder) => <li key={folder.id} role="row" className="favorite-ledger-panel__source-row favorite-ledger-panel__source-row--user">
          <label className="favorite-ledger-panel__source-row-content">
            <span role="cell"><input type="checkbox" aria-label={`选择来源 ${folder.title}`} checked={selectedSourceIds.has(folder.id)}
              disabled={loading || sourceSelectionLocked} onChange={(event) => {
                const next = new Set(selectedSourceIds)
                if (event.currentTarget.checked) next.add(folder.id); else next.delete(folder.id)
                onSelectSourceFolders([...next])
              }} /></span>
            <span role="cell" className="favorite-ledger-panel__source-name" title={folder.title}>{folder.title}</span>
            <span role="cell" className="favorite-ledger-panel__source-count">{folder.itemCount}</span>
            <span role="cell" className="favorite-ledger-panel__source-count">{selectedSourceIds.has(folder.id) ? folder.itemCount : 0}</span>
          </label>
        </li>)}
      </ul>
    </div> : null}
    {bilimiFolders.length ? <div className="favorite-ledger-panel__source-table favorite-ledger-panel__source-table--bilimi" role="table" aria-label="bilimi 工作夹">
      <div role="row" className="favorite-ledger-panel__source-header favorite-ledger-panel__source-header--bilimi">
        <span role="columnheader" aria-label="选择" /><span role="columnheader">bilimi 工作夹</span>
        <span role="columnheader">已有</span><span role="columnheader">本轮待整理</span>
      </div>
      <ul role="rowgroup" className="favorite-ledger-panel__source-list">
        {bilimiFolders.map((folder) => <li key={folder.id} role="row" className="favorite-ledger-panel__source-row favorite-ledger-panel__source-row--bilimi">
          <span role="cell" /><span role="cell" className="favorite-ledger-panel__source-name" title={folder.title}>{folder.title}</span>
          <span role="cell" className="favorite-ledger-panel__source-count">{folder.itemCount}</span>
          <span role="cell" className="favorite-ledger-panel__source-count">0</span>
        </li>)}
      </ul>
    </div> : null}
  </section>
}
