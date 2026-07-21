import { describe, expect, it } from 'vitest'
import { favoriteWorkspaceReadinessMessage } from './FloatingAssistantApp'

describe('favoriteWorkspaceReadinessMessage', () => {
  it('tells a user already in the ledger that the local template still needs Bilibili backup', () => {
    expect(favoriteWorkspaceReadinessMessage({
      hasBilibiliPageOpen: true,
      hasMissingFavoriteLedgers: true,
      activeTab: 'ledger'
    })).toBe('当前只有本地默认收藏夹模板，请点击“备册”创建并绑定 bilimi 收藏夹。')
  })
})
