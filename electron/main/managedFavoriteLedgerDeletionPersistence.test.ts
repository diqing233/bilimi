import { describe, expect, it, vi } from 'vitest'
import type { FavoriteAccountPreferences } from '../../src/shared/types'
import { persistConfirmedManagedFolderDeletion } from './managedFavoriteLedgerDeletionPersistence'

function preferences(favoriteLedgers: FavoriteAccountPreferences['favoriteLedgers']): FavoriteAccountPreferences {
  return { defaultFavoriteSystemEnabled: true, favoriteLedgers }
}

describe('persistConfirmedManagedFolderDeletion', () => {
  it('persists the default user-deleted marker only after a confirmed managed-folder deletion', async () => {
    const current = preferences([{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'bound', bilibiliFolderId: '9001'
    }])
    const save = vi.fn()
    const publish = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'music', remoteFolderIds: ['9001'], remoteDeleted: false
    }], {
      load: () => current, save, publish
    })).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith('100', expect.objectContaining({
      favoriteLedgers: [expect.objectContaining({
        id: 'music', enabled: false, bindingState: 'unbound', managedFolderDeletedByUser: true
      })]
    }))
    expect(publish).toHaveBeenCalledOnce()
  })

  it('removes a confirmed custom managed-folder rule and does not publish a no-op deletion', async () => {
    const current = preferences([{
      id: 'custom-work', displayName: 'bilimi·工作', keywords: [], enabled: true, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002'
    }])
    const save = vi.fn()
    const publish = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'custom-work', remoteFolderIds: ['9002'], remoteDeleted: true
    }], {
      load: () => current, save, publish
    })).resolves.toBe(true)
    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'not-present', remoteFolderIds: [], remoteDeleted: false
    }], {
      load: () => current, save, publish
    })).resolves.toBe(false)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('100', expect.objectContaining({ favoriteLedgers: [] }))
    expect(publish).toHaveBeenCalledOnce()
  })

  it('marks a locally deleted custom binding for rediscovery only after a later explicit backup', async () => {
    const current = preferences([{
      id: 'custom-work', displayName: 'bilimi·工作', keywords: [], enabled: true, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002', bilibiliFolderIds: ['9002', '9003']
    }])
    const save = vi.fn()
    const publish = vi.fn()
    const markRemoteDraftRediscoveryPending = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'custom-work', remoteFolderIds: [' 9003 ', '9002', '9002']
    }], {
      load: () => current, save, publish, markRemoteDraftRediscoveryPending
    })).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith('100', expect.objectContaining({ favoriteLedgers: [] }))
    expect(markRemoteDraftRediscoveryPending).toHaveBeenCalledWith('100', ['9002', '9003'])
    expect(publish).toHaveBeenCalledOnce()
  })

  it('does not mark remote rediscovery after a confirmed Bilibili folder deletion', async () => {
    const current = preferences([{
      id: 'custom-work', displayName: 'bilimi·工作', keywords: [], enabled: true, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002'
    }])
    const markRemoteDraftRediscoveryPending = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'custom-work', remoteFolderIds: ['9002'], remoteDeleted: true
    }], {
      load: () => current, save: vi.fn(), publish: vi.fn(), markRemoteDraftRediscoveryPending
    })).resolves.toBe(true)

    expect(markRemoteDraftRediscoveryPending).not.toHaveBeenCalled()
  })

  it('does not mark rediscovery when saving the local deletion state fails', async () => {
    const current = preferences([{
      id: 'custom-work', displayName: 'bilimi·工作', keywords: [], enabled: true, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002'
    }])
    const markRemoteDraftRediscoveryPending = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'custom-work', remoteFolderIds: ['9002'], remoteDeleted: false
    }], {
      load: () => current,
      save: vi.fn(async () => { throw new Error('preferences unavailable') }),
      publish: vi.fn(),
      markRemoteDraftRediscoveryPending
    })).rejects.toThrow('preferences unavailable')

    expect(markRemoteDraftRediscoveryPending).not.toHaveBeenCalled()
  })
})
