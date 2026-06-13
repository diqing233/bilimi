import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'

describe('FavoriteLedgerPanel', () => {
  it('shows missing ledgers and creates them through 备册', async () => {
    const onEnsureLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:list', 'api:ledger:create:humor'],
      missingTargets: [],
      message: '册目已备齐。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers().slice(0, 2)}
        missingLedgerIds={['humor']}
        onClose={vi.fn()}
        onEnsureLedgers={onEnsureLedgers}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    expect(screen.getByText('掌库')).toBeInTheDocument()
    expect(screen.getByText('Bilimi·茶余解颐')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    await waitFor(() => expect(onEnsureLedgers).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('册目已备齐。')
  })

  it('adds a custom ledger from a recommended name and saves keywords', () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onClose={vi.fn()}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('新增主题'), { target: { value: '摄影' } })
    fireEvent.click(screen.getByRole('button', { name: '荐名' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bilimi·光影留真' }))
    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '摄影,镜头,构图' } })
    fireEvent.click(screen.getByRole('button', { name: '新增册目' }))

    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Bilimi·光影留真',
          keywords: ['摄影', '镜头', '构图'],
          enabled: true,
          isDefault: false
        })
      ])
    )
  })

  it('deletes custom ledgers without removing default ledgers', () => {
    const onSaveLedgers = vi.fn()
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真',
        keywords: ['摄影'],
        enabled: true,
        priority: 100,
        isDefault: false
      }
    ]

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onClose={vi.fn()}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '删除 Bilimi·光影留真' }))

    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        expect.objectContaining({
          id: 'custom-photo'
        })
      ])
    )
    expect(screen.queryByRole('button', { name: '删除 Bilimi·见闻增广' })).not.toBeInTheDocument()
  })

  it('scans old favorites before executing append operations', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·见闻增广',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: '旧藏整理已毕。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onClose={vi.fn()}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await screen.findByText('机器学习科普教程')
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认归册' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith(preview.items))
  })
})
