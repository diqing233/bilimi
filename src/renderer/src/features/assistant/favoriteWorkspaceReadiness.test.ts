import { describe, expect, it } from 'vitest'
import type { FavoriteLedger } from '@shared/types'
import { hasMissingFavoriteLedgerBindings, favoriteWorkspaceReadinessMessage } from './FloatingAssistantApp'

describe('favoriteWorkspaceReadinessMessage', () => {
  it('tells a user already in the ledger that the local template still needs Bilibili backup', () => {
    expect(favoriteWorkspaceReadinessMessage({
      hasBilibiliPageOpen: true,
      hasMissingFavoriteLedgers: true,
      activeTab: 'ledger'
    })).toBe('当前只有本地默认收藏夹模板，请点击“备册”创建并绑定 bilimi 收藏夹。')
  })

  it('uses the active account bindings instead of the global default template', () => {
    const activeAccountLedgers: FavoriteLedger[] = [{
      id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], enabled: true,
      priority: 10, isDefault: true, bilibiliFolderId: '4099454311'
    }]

    expect(hasMissingFavoriteLedgerBindings(activeAccountLedgers, null)).toBe(false)
  })
})
