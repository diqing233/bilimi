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

  it('adds a custom ledger from a recommended name only after 保存', async () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
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

    expect(onSaveLedgers).not.toHaveBeenCalled()
    expect(screen.getByText('Bilimi·光影留真')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
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
    )
  })

  it('deletes only Bilimi custom ledgers after 保存', async () => {
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
      },
      {
        id: 'custom-personal',
        displayName: '个人摄影夹',
        keywords: ['摄影'],
        enabled: true,
        priority: 101,
        isDefault: false
      }
    ]

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '删除 Bilimi·光影留真' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()
    expect(screen.queryByText('Bilimi·光影留真')).not.toBeInTheDocument()
    expect(screen.getByText('个人摄影夹')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除 个人摄影夹' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.not.arrayContaining([
          expect.objectContaining({
            id: 'custom-photo'
          })
        ])
      )
    )
    expect(screen.queryByRole('button', { name: '删除 Bilimi·见闻增广' })).not.toBeInTheDocument()
  })

  it('does not render the old close-only 合卷 button', () => {
    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: '合卷' })).not.toBeInTheDocument()
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

  it('explains 保存 when there are no draft changes', async () => {
    const onSaveLedgers = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('暂无未保存调整。')
  })

  it('shows save failures instead of failing silently', async () => {
    const onSaveLedgers = vi.fn().mockRejectedValue(new Error('账号同步超时'))

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: '暂歇' })[0])
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('status')).toHaveTextContent('保存未完成：账号同步超时')
  })

  it('shows old favorite scan failures instead of an empty preview', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      ok: false,
      message: '未能读取登录凭据，无法整理旧藏。',
      items: [],
      skippedSourceFolderTitles: []
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '整理旧藏未完成：未能读取登录凭据，无法整理旧藏。'
    )
    expect(screen.queryByText('旧藏预览')).not.toBeInTheDocument()
  })
})
