import { describe, expect, it } from 'vitest'
import { favoriteLedgerBackupState, favoriteLedgerBackupStateLabel } from './favoriteLedgerBackupState'
import type { FavoriteLedger } from './types'

const ledger: FavoriteLedger = {
  id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true,
  priority: 10, isDefault: true, bilibiliFolderId: 'game-1', bindingState: 'bound'
}

describe('favoriteLedgerBackupState', () => {
  it('reports unresolved evidence alongside a formal shard as partial instead of backed', () => {
    expect(favoriteLedgerBackupState(ledger, { unboundLedgerIds: ['game'] })).toBe('partial')
    expect(favoriteLedgerBackupStateLabel(ledger, { unboundLedgerIds: ['game'] })).toBe('部分已备册 · 仍待绑定')
  })

  it('keeps a user-deleted rule unbacked until the current directory exposes a candidate', () => {
    const deletedLedger = {
      ...ledger,
      bilibiliFolderId: undefined,
      bilibiliFolderIds: undefined,
      bindingState: 'unbound' as const,
      managedFolderDeletedByUser: true
    }

    expect(favoriteLedgerBackupState(deletedLedger, { hasFormalPhysicalBinding: false })).toBe('unbacked')
    expect(favoriteLedgerBackupState(deletedLedger, {
      hasFormalPhysicalBinding: false,
      unboundLedgerIds: ['game']
    })).toBe('unbound')
  })

  it('reports a mixed physical-shard summary as partial', () => {
    expect(favoriteLedgerBackupState(ledger, { hasFormalPhysicalBinding: false })).toBe('unbacked')
    expect(favoriteLedgerBackupState(ledger, { hasFormalPhysicalBinding: true, missingLedgerIds: ['game'] })).toBe('partial')
    expect(favoriteLedgerBackupState(ledger, { hasFormalPhysicalBinding: false, hasPartialPhysicalBinding: true })).toBe('partial')
  })
})
