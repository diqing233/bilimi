import { describe, expect, it } from 'vitest'
import { projectFavoriteLedgersFromPhysicalShards } from './favoriteLedgerBindingProjection'

describe('projectFavoriteLedgersFromPhysicalShards', () => {
  it('projects every formally bound physical shard back to the account rule', () => {
    const [ledger] = projectFavoriteLedgersFromPhysicalShards([
      {
        id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], enabled: true,
        priority: 10, isDefault: true, bindingState: 'unbound', bilibiliFolderId: '4099023854',
        bilibiliFolderIds: ['4099023854']
      }
    ], [
      {
        logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
        remoteFolderId: '4099023854', remoteTitle: 'bilimi·游戏专区', bindingState: 'bound'
      },
      {
        logicalLedgerId: 'game', folderId: 'bilimi:game:002', shardNumber: 2,
        remoteFolderId: '4051127554', remoteTitle: 'bilimi·游戏专区', bindingState: 'bound'
      }
    ])

    expect(ledger).toMatchObject({
      id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], enabled: true,
      bindingState: 'bound', bilibiliFolderId: '4099023854',
      bilibiliFolderIds: ['4099023854', '4051127554']
    })
  })

  it('ignores pending or unbound shards and leaves rules without formal bindings unchanged', () => {
    const ledgers = [{
      id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], enabled: false,
      priority: 10, isDefault: true, bindingState: 'unbound' as const
    }]

    expect(projectFavoriteLedgersFromPhysicalShards(ledgers, [
      {
        logicalLedgerId: 'game', folderId: 'bilimi:game:001', shardNumber: 1,
        remoteTitle: 'bilimi·游戏专区', bindingState: 'pending-reconcile'
      }
    ])).toEqual(ledgers)
  })

  it('clears stale account binding fields when the authoritative repository has no bound shard', () => {
    const [ledger] = projectFavoriteLedgersFromPhysicalShards([
      {
        id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], enabled: true,
        priority: 10, isDefault: true, bindingState: 'bound', bilibiliFolderId: '4099023854',
        bilibiliFolderIds: ['4099023854'], bilibiliFolderTitle: 'bilimi·游戏专区',
        bilibiliFolderVideoCount: 12
      }
    ], [])

    expect(ledger).toEqual({
      id: 'game', displayName: 'bilimi·游戏专区', keywords: ['游戏'], enabled: true,
      priority: 10, isDefault: true, bindingState: 'unbacked'
    })
  })

  it('keeps a rule formally bound when its Bilibili shard remains after its local work folder is removed', () => {
    const [ledger] = projectFavoriteLedgersFromPhysicalShards([{
      id: 'work', displayName: 'bilimi·工作', keywords: [], enabled: true,
      priority: 10, isDefault: false, bindingState: 'bound' as const, bilibiliFolderId: '91'
    }], [{
      logicalLedgerId: 'work', folderId: 'bilimi:work:001', shardNumber: 1,
      remoteFolderId: '91', remoteTitle: 'bilimi·工作', bindingState: 'bound' as const
    }])

    expect(ledger).toMatchObject({
      id: 'work', bindingState: 'bound', bilibiliFolderId: '91', bilibiliFolderIds: ['91']
    })
  })

  it('recovers a deleted default ledger only from its user-confirmed replacement id', () => {
    const ledgers = [{
      id: 'music', displayName: 'bilimi·音乐', keywords: ['音乐'], enabled: true,
      priority: 10, isDefault: true, bindingState: 'unbound' as const,
      managedFolderDeletedByUser: true,
      confirmedDeletedRemoteFolderIds: ['old-music', 'new-music'],
      pendingRemoteBinding: true,
      pendingRemoteFolderId: 'new-music'
    }]
    const shards = [{
      logicalLedgerId: 'music', folderId: 'bilimi:music:001', shardNumber: 1,
      remoteFolderId: 'new-music', remoteTitle: 'bilimi·音乐', bindingState: 'bound' as const,
      userConfirmedAdoption: true
    }]

    expect(projectFavoriteLedgersFromPhysicalShards(ledgers, shards)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'music', managedFolderDeletedByUser: true,
        confirmedDeletedRemoteFolderIds: ['old-music', 'new-music']
      })
    ]))
    expect(projectFavoriteLedgersFromPhysicalShards(ledgers, shards, {
      recoverUserConfirmedAdoptions: true
    })).toEqual([expect.objectContaining({
      id: 'music', bindingState: 'bound', bilibiliFolderId: 'new-music',
      bilibiliFolderIds: ['new-music'], confirmedDeletedRemoteFolderIds: ['old-music']
    })])
    expect(projectFavoriteLedgersFromPhysicalShards(ledgers, shards, {
      recoverUserConfirmedAdoptions: true
    })[0]).not.toHaveProperty('managedFolderDeletedByUser')
  })
})
