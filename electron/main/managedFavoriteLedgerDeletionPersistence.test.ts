import { describe, expect, it, vi } from 'vitest'
import type { FavoriteAccountPreferences } from '../../src/shared/types'
import { persistConfirmedManagedFolderDeletion } from './managedFavoriteLedgerDeletionPersistence'

function preferences(favoriteLedgers: FavoriteAccountPreferences['favoriteLedgers']): FavoriteAccountPreferences {
  return { defaultFavoriteSystemEnabled: true, favoriteLedgers }
}

describe('persistConfirmedManagedFolderDeletion', () => {
  it('persists the default user-deleted marker only after Bilibili was actually deleted', async () => {
    const current = preferences([{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'bound', bilibiliFolderId: '9001'
    }])
    const save = vi.fn()
    const publish = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'music', remoteFolderIds: ['9001'], remoteDeleted: true
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

  it('keeps a custom right-side rule when left-side deletion also removed its Bilibili folder', async () => {
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
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('100', expect.objectContaining({
      favoriteLedgers: [expect.objectContaining({
        id: 'custom-work',
        displayName: 'bilimi·工作',
        keywords: [],
        enabled: true,
        bindingState: 'unbacked'
      })]
    }))
    const savedLedgers = save.mock.calls[0]?.[1].favoriteLedgers
    expect(savedLedgers?.[0]).not.toHaveProperty('bilibiliFolderId')
    expect(savedLedgers?.[0]).not.toHaveProperty('bilibiliFolderIds')
    expect(publish).toHaveBeenCalledOnce()
  })

  it('does not touch right-side rules or bindings when only the left library work folder is deleted', async () => {
    const current = preferences([{
      id: 'custom-work', displayName: 'bilimi·工作', keywords: [], enabled: true, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002', bilibiliFolderIds: ['9002', '9003']
    }])
    const save = vi.fn()
    const publish = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'custom-work', remoteFolderIds: [' 9003 ', '9002', '9002']
    }], {
      load: () => current, save, publish
    })).resolves.toBe(false)

    expect(save).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('does not persist the right-side rules when only the local library folder was deleted', async () => {
    const current = preferences([{
      id: 'custom-work', displayName: 'bilimi·工作', keywords: [], enabled: true, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002'
    }])
    const save = vi.fn(async () => { throw new Error('preferences unavailable') })
    const publish = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'custom-work', remoteFolderIds: ['9002'], remoteDeleted: false
    }], {
      load: () => current,
      save,
      publish
    })).resolves.toBe(false)

    expect(save).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})
