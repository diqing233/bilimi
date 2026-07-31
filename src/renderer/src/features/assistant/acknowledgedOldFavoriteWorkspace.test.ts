import { describe, expect, it, vi } from 'vitest'
import {
  acknowledgeOldFavoriteWorkspace,
  loadAcknowledgedOldFavoriteWorkspaces,
  saveAcknowledgedOldFavoriteWorkspaces
} from './acknowledgedOldFavoriteWorkspace'

describe('acknowledgedOldFavoriteWorkspace', () => {
  it('keeps one durable completed workspace acknowledgement per account', () => {
    const acknowledged = acknowledgeOldFavoriteWorkspace(
      { '100': 'workspace-old' },
      '200',
      'workspace-200'
    )
    const setItem = vi.fn()
    saveAcknowledgedOldFavoriteWorkspaces(acknowledged, { setItem })

    expect(acknowledged).toEqual({ '100': 'workspace-old', '200': 'workspace-200' })
    expect(setItem).toHaveBeenCalledWith(
      'bilimi:acknowledged-old-favorite-workspaces',
      JSON.stringify(acknowledged)
    )
    expect(loadAcknowledgedOldFavoriteWorkspaces({
      getItem: () => JSON.stringify({ '100': 'workspace-old', invalid: 3 })
    })).toEqual({ '100': 'workspace-old' })
  })
})
