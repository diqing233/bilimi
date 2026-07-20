import type { FavoriteLedger, FavoriteLedgerSaveOptions } from '@shared/types'
import { useState } from 'react'

type FavoriteLedgerOverviewProps = {
  ledgers: FavoriteLedger[]
  missingLedgerIds: string[]
  onEnsureLedgers: () => Promise<unknown>
  onSaveLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => Promise<unknown> | void
  onOpenFavoritePage?: () => Promise<unknown> | void
  onCreateLocalLedger: (title: string) => Promise<unknown> | void
}

export function FavoriteLedgerOverview({
  ledgers,
  missingLedgerIds,
  onEnsureLedgers,
  onSaveLedgers,
  onOpenFavoritePage,
  onCreateLocalLedger
}: FavoriteLedgerOverviewProps) {
  const [newLedgerName, setNewLedgerName] = useState('')

  const addLocalLedger = async () => {
    const title = newLedgerName.trim()
    if (!title) return
    await onCreateLocalLedger(title)
    setNewLedgerName('')
  }

  return <section className="favorite-ledger-panel__ledger-list" aria-label="收藏夹">
    <div className="favorite-ledger-panel__workspace">
      <div className="favorite-ledger-panel__editor-title">
        <div><h3>收藏夹</h3><p>管理本地收藏夹规则，并在整理完成后保存。</p></div>
      </div>
      {missingLedgerIds.length > 0 ? <p className="favorite-ledger-panel__notice" role="alert">部分 Bilimi 收藏夹尚未备册。</p> : null}
      <div className="favorite-ledger-panel__editor">
        <p className="favorite-ledger-panel__editor-empty">当前有 {ledgers.length} 个收藏夹规则。</p>
        <label>新增收藏夹
          <input aria-label="新增收藏夹名称" value={newLedgerName} onChange={(event) => setNewLedgerName(event.currentTarget.value)} />
        </label>
        <div className="favorite-ledger-panel__editor-actions">
          <button type="button" disabled={!newLedgerName.trim()} onClick={() => void addLocalLedger()}>新增并重新归类</button>
          <button type="button" onClick={() => void onSaveLedgers(ledgers)}>保存收藏夹规则</button>
        </div>
        {onOpenFavoritePage ? <button type="button" onClick={() => void onOpenFavoritePage()}>打开 B 站收藏夹</button> : null}
      </div>
    </div>
  </section>
}
