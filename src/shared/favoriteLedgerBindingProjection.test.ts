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
})
