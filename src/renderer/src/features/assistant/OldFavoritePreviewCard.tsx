import type { FavoriteLedger } from '@shared/types'
import type { OldFavoriteWorkspaceClassification, OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'

type PreviewItem = NonNullable<OldFavoriteWorkspaceSnapshot['currentSegment']>['items'][number]

type OldFavoritePreviewCardProps = {
  item: PreviewItem
  sourceFolderTitles: string[]
  classification?: OldFavoriteWorkspaceClassification
  ledgers: FavoriteLedger[]
  loading: boolean
  onApplyManualClassification: (aid: number, targetLedgerIds: string[]) => void
}

const sourceLabels: Record<OldFavoriteWorkspaceClassification['source'], string> = {
  manual: '人工调整',
  deepseek: 'DeepSeek',
  'system-high': '高置信度自动分类',
  'system-low': '低置信度自动分类'
}

export function OldFavoritePreviewCard({
  item,
  sourceFolderTitles,
  classification,
  ledgers,
  loading,
  onApplyManualClassification
}: OldFavoritePreviewCardProps) {
  const title = item.title?.trim() || `视频 ${item.aid}`
  const targetLedgerId = classification?.targetLedgerIds[0] ?? ''
  const targetLedger = ledgers.find((ledger) => ledger.id === targetLedgerId)

  return <article className="favorite-ledger-panel__preview-item-shell">
    <div className="favorite-ledger-panel__preview-video favorite-ledger-panel__preview-video--pending" data-selected="false">
      <strong>{title}</strong>
      <p>UP：{item.author?.trim() || '未知 UP'}</p>
      <p>来源：{sourceFolderTitles.join('、') || '未记录'}</p>
      <p>{classification ? `分类来源：${sourceLabels[classification.source]}` : '未分类'}</p>
      <p>目标收藏夹：{targetLedger?.displayName || '未分类'}</p>
    </div>
    <label>
      <span>归类</span>
      <select
        aria-label={`归类 ${title}`}
        value={targetLedgerId}
        disabled={loading}
        onChange={(event) => onApplyManualClassification(item.aid, event.currentTarget.value ? [event.currentTarget.value] : [])}
      >
        <option value="">未分类</option>
        {ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.displayName}</option>)}
      </select>
    </label>
  </article>
}
