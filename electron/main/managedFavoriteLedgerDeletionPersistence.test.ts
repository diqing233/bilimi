import { describe, expect, it, vi } from 'vitest'
import type { FavoriteAccountPreferences } from '../../src/shared/types'
import {
  consumeLocalManagedFolderHiddenIds,
  persistConfirmedManagedFolderDeletion,
  persistLocalManagedFolderHiddenIds
} from './managedFavoriteLedgerDeletionPersistence'

function preferences(favoriteLedgers: FavoriteAccountPreferences['favoriteLedgers']): FavoriteAccountPreferences {
  return { defaultFavoriteSystemEnabled: true, favoriteLedgers }
}

describe('persistConfirmedManagedFolderDeletion', () => {
  it('persists a local managed-folder visibility hide and rolls back only IDs added by this deletion', async () => {
    let current = preferences([{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false
    }])
    current = { ...current, hiddenFavoriteLibraryManagedLedgerIds: ['game'] }
    const save = vi.fn(async (_accountMid: string, saved: FavoriteAccountPreferences) => { current = saved })
    const publish = vi.fn()

    const rollback = await persistLocalManagedFolderHiddenIds('100', ['music', 'music'], {
      load: () => current, save, publish
    })

    expect(current.hiddenFavoriteLibraryManagedLedgerIds).toEqual(['game', 'music'])
    await rollback?.()
    expect(current.hiddenFavoriteLibraryManagedLedgerIds).toEqual(['game'])
  })

  it('preserves Unicode and encoded logical IDs in the local visibility hide', async () => {
    let current = preferences([{
      id: 'custom-音乐-456', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false
    }])
    const save = vi.fn(async (_accountMid: string, saved: FavoriteAccountPreferences) => { current = saved })
    await persistLocalManagedFolderHiddenIds('100', ['custom-音乐-456', 'custom-remote-404%2F1'], {
      load: () => current, save, publish: vi.fn()
    })
    expect(current.hiddenFavoriteLibraryManagedLedgerIds).toEqual(['custom-remote-404%2F1', 'custom-音乐-456'])
  })

  it('rolls back a newly persisted local visibility hide when publishing the change fails', async () => {
    let current = preferences([{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false
    }])
    const save = vi.fn(async (_accountMid: string, saved: FavoriteAccountPreferences) => { current = saved })
    const publish = vi.fn(async () => { throw new Error('window broadcast unavailable') })

    await expect(persistLocalManagedFolderHiddenIds('100', ['music'], { load: () => current, save, publish }))
      .rejects.toThrow('window broadcast unavailable')

    expect(current.hiddenFavoriteLibraryManagedLedgerIds).toBeUndefined()
  })

  it('consumes only the recovered local managed-folder visibility hide', async () => {
    let current = {
      ...preferences([{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]),
      hiddenFavoriteLibraryManagedLedgerIds: ['game', 'music']
    }
    const save = vi.fn(async (_accountMid: string, saved: FavoriteAccountPreferences) => { current = saved })

    await expect(consumeLocalManagedFolderHiddenIds('100', ['music'], {
      load: () => current, save, publish: vi.fn()
    })).resolves.toBe(true)

    expect(current.hiddenFavoriteLibraryManagedLedgerIds).toEqual(['game'])
  })

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
        id: 'music', enabled: true, bindingState: 'unbacked', managedFolderDeletedByUser: true
      })]
    }))
    expect(publish).toHaveBeenCalledOnce()
  })

  it('persists a default unbound rule as unbacked after a fresh directory confirms no remote candidate exists', async () => {
    const current = preferences([{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'unbound'
    }])
    const save = vi.fn()
    const publish = vi.fn()
    const confirmedAbsence = {
      logicalLedgerId: 'music', remoteFolderIds: [], remoteDeleted: false, remoteConfirmedAbsent: true
    } as never

    await expect(persistConfirmedManagedFolderDeletion('100', [confirmedAbsence], {
      load: () => current, save, publish
    })).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith('100', expect.objectContaining({
      favoriteLedgers: [expect.objectContaining({
        id: 'music', bindingState: 'unbacked', managedFolderDeletedByUser: true
      })]
    }))
    expect(publish).toHaveBeenCalledOnce()
  })

  it('persists an unbound default rule as unbacked after an acknowledged same-title deletion', async () => {
    const current = preferences([{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'unbound'
    }])
    const save = vi.fn()
    const publish = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'music', remoteFolderIds: ['unbound-music'], remoteDeleted: true
    }], {
      load: () => current, save, publish
    })).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith('100', expect.objectContaining({
      favoriteLedgers: [expect.objectContaining({
        id: 'music', bindingState: 'unbacked', managedFolderDeletedByUser: true,
        confirmedDeletedRemoteFolderIds: ['unbound-music']
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

  it('keeps remaining Bilibili bindings when only one of a multi-folder rule was deleted', async () => {
    const current = preferences([{
      id: 'custom-work', displayName: 'bilimi·工作', keywords: [], enabled: true, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002',
      bilibiliFolderIds: ['9002', '9003'], bilibiliFolderTitle: 'bilimi·工作·1', bilibiliFolderVideoCount: 12
    }])
    const save = vi.fn()
    const publish = vi.fn()

    await expect(persistConfirmedManagedFolderDeletion('100', [{
      logicalLedgerId: 'custom-work', remoteFolderIds: ['9002'], remoteDeleted: true
    }], {
      load: () => current, save, publish
    })).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith('100', expect.objectContaining({
      favoriteLedgers: [expect.objectContaining({
        id: 'custom-work', bindingState: 'bound', bilibiliFolderId: '9003', bilibiliFolderIds: ['9003']
      })]
    }))
    const savedLedger = save.mock.calls[0]?.[1].favoriteLedgers[0]
    expect(savedLedger).not.toHaveProperty('bilibiliFolderTitle')
    expect(savedLedger).not.toHaveProperty('bilibiliFolderVideoCount')
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
