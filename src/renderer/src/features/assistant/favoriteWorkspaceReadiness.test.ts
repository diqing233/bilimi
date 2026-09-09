import { describe, expect, it } from 'vitest'
import type { FavoriteLedger } from '@shared/types'
import {
  hasMissingFavoriteLedgerBindings,
  hasMissingCurrentFavoriteLedgerBinding,
  favoriteWorkspaceReadinessMessage
} from './FloatingAssistantApp'

describe('favoriteWorkspaceReadinessMessage', () => {
  it('tells a user already in the ledger that the local template still needs Bilibili backup', () => {
    expect(favoriteWorkspaceReadinessMessage({
      hasBilibiliPageOpen: true,
      hasMissingFavoriteLedgers: true,
      activeTab: 'ledger'
    })).toBe('当前收藏夹只保存在 bilimi 本地。点击“备册”后，会在 B 站创建对应收藏夹，之后才能同步批阅和整理结果。')
  })

  it('directs non-ledger workspaces to complete backup before reviewing or organizing', () => {
    expect(favoriteWorkspaceReadinessMessage({
      hasBilibiliPageOpen: true,
      hasMissingFavoriteLedgers: true,
      activeTab: 'review'
    })).toBe('请先到掌库点击“备册”，完成后即可开始批阅和其他整理操作。')
  })

  it('uses the active account bindings instead of the global default template', () => {
    const activeAccountLedgers: FavoriteLedger[] = [{
      id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], enabled: true,
      priority: 10, isDefault: true, bilibiliFolderId: '4099454311'
    }]

    expect(hasMissingFavoriteLedgerBindings(activeAccountLedgers, null)).toBe(false)
  })

  it('checks only the current matched ledger when deciding the video hint', () => {
    const currentLedger: FavoriteLedger = {
      id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true,
      priority: 10, isDefault: true, bilibiliFolderId: '101', bindingState: 'bound'
    }
    const unrelatedMissingLedger: FavoriteLedger = {
      id: 'entertainment', displayName: 'bilimi·搞笑杂谈', keywords: [], enabled: true,
      priority: 20, isDefault: true, bindingState: 'unbacked'
    }
    const status = {
      ok: false,
      verified: true,
      ledgers: [currentLedger, unrelatedMissingLedger],
      missingLedgerIds: ['entertainment'],
      unboundLedgerIds: [],
      message: '发现尚未备册的 bilimi 收藏夹。'
    }

    expect(hasMissingCurrentFavoriteLedgerBinding('game', status)).toBe(false)
    expect(hasMissingCurrentFavoriteLedgerBinding('entertainment', status)).toBe(true)
    expect(hasMissingCurrentFavoriteLedgerBinding('entertainment', { ...status, verified: false })).toBe(false)
  })
})
