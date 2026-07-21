import type { OldFavoriteWorkspaceView } from '@shared/oldFavoriteWorkspace'

type OldFavoriteScanOverviewStepProps = {
  snapshot: OldFavoriteWorkspaceView | null
  loading: boolean
  scanStarting: boolean
  scanStartFailure: string | null
  onRetry: () => void
  onRetryDirect: () => void
  onRebuild: () => void
  onSelectSourceFolders: (folderIds: string[]) => void
  onPauseTagEnrichment: () => void
  onResumeTagEnrichment: () => void
  onAcceptCurrentTags: () => void
}

function scanFailureGuidance(reason: string | null | undefined) {
  const normalized = reason?.trim() ?? ''
  if (/^(target-unavailable|target-navigated|remote-ambiguous|remote-api-)/.test(normalized)) {
    return '无法确认当前 B站页面，请保持已登录的 B站页面打开后重新扫描。'
  }
  if (normalized === 'page-execution-failed') {
    return '无法读取当前 B站页面，请保持已登录的 B站页面打开并等待页面加载完成后重新扫描。'
  }
  if (normalized === 'network-failure') {
    return 'B 站网络连接中断。请检查网络或使用本次直连后重新扫描。'
  }
  return normalized || '请重新扫描。'
}

export function OldFavoriteScanOverviewStep({
  snapshot,
  loading,
  scanStarting,
  scanStartFailure,
  onRetry,
  onRetryDirect,
  onRebuild,
  onSelectSourceFolders
  ,onPauseTagEnrichment
  ,onResumeTagEnrichment
  ,onAcceptCurrentTags
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
  const totalItemCount = snapshot?.scan.totalItemCount ?? 0
  const scannedItemCount = Math.min(snapshot?.scan.scannedItemCount ?? 0, totalItemCount)
  const taggedItemCount = Math.min(snapshot?.scan.taggedItemCount ?? 0, scannedItemCount)
  const untaggedItemCount = Math.max(0, snapshot?.scan.untaggedItemCount ?? scannedItemCount - taggedItemCount)
  const tagEnrichment = snapshot?.tagEnrichment
  const failedTagItemCount = Math.min(tagEnrichment?.failedItemCount ?? 0, untaggedItemCount)
  const confirmedUntaggedItemCount = Math.max(0, untaggedItemCount - failedTagItemCount)
  const sourceSelectionLocked = Boolean(snapshot && !recovery && Object.keys(snapshot.classifications).length > 0)
  const guidance = scanStartFailure
    ? `扫描启动失败：${scanFailureGuidance(scanStartFailure)}`
    : snapshot?.scan.phase === 'failed'
      ? `扫描失败：${scanFailureGuidance(snapshot.scan.reason)}`
      : scanning
        ? '扫描概览：扫描中'
        : '扫描概览已完成，请选择下一步继续整理。'

  return <section className="favorite-ledger-panel__scan-overview" aria-label="扫描概览">
    <h4>扫描概览</h4>
    <p className="favorite-ledger-panel__scan-guidance" role={scanFailed ? 'alert' : undefined}>{guidance}</p>
    <div className="favorite-ledger-panel__scan-progress" aria-label="旧藏扫描进度">
      <div>
        <span>扫描进度</span>
        <progress aria-label="旧藏扫描进度" max={Math.max(totalItemCount, 1)} value={scanFailed ? 0 : scanning ? scannedItemCount : Math.max(totalItemCount, 1)} />
        <span>{scanning && totalItemCount ? `${scannedItemCount} / ${totalItemCount} 条` : null}</span>
        <strong>{scanFailed ? '扫描失败' : scanning ? '正在扫描' : '已完成'}</strong>
      </div>
      {scannedItemCount ? <div>
        <span>已获取标签</span>
        <progress aria-label="标签识别进度" max={Math.max(scannedItemCount, 1)} value={taggedItemCount} />
        <span>已获取标签 {taggedItemCount} / {scannedItemCount} 条</span>
        <strong>{untaggedItemCount ? `${untaggedItemCount} 条尚未取得标签` : '已识别'}</strong>
      </div> : null}
    </div>
    {tagEnrichment ? <div className="favorite-ledger-panel__scan-enrichment-status" role="status">
      <p>标签补取{tagEnrichment.status === 'paused' ? '已暂停' : tagEnrichment.pendingItemCount > 0 ? '进行中' : '已完成'}：已处理 {tagEnrichment.completedItemCount} / {tagEnrichment.totalItemCount} 条。</p>
      <p>已获取标签 {taggedItemCount} 条；确认无标签 {confirmedUntaggedItemCount} 条；读取失败 {failedTagItemCount} 条。</p>
      {tagEnrichment.pendingItemCount > 0 ? <>
        {tagEnrichment.status === 'paused'
          ? <button type="button" disabled={loading} onClick={onResumeTagEnrichment}>继续补取标签</button>
          : <button type="button" disabled={loading} onClick={onPauseTagEnrichment}>暂停补取标签</button>}
        <button type="button" disabled={loading} onClick={onAcceptCurrentTags}>采用当前标签</button>
      </> : null}
    </div> : null}
    {tagEnrichment?.status === 'accepted' ? <p role="status">已采用当前标签。</p> : null}
    {scanFailed ? <>
      <button type="button" disabled={loading || scanStarting} onClick={onRetry}>重新扫描</button>
      {snapshot?.scan.reason === 'network-failure'
        ? <button type="button" disabled={loading || scanStarting} onClick={onRetryDirect}>本次直连后重新扫描</button>
        : null}
    </> : null}
    <p>已发现 {folders.length} 个收藏夹，当前扫描 {snapshot?.continuationCount ?? 0} 条待续新增。</p>
    {snapshot?.mode === 'incremental' && snapshot.protectedAidCount
      ? <p role="status">增量扫描已跳过 {snapshot.protectedAidCount} 条已保护视频。</p>
      : null}
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
