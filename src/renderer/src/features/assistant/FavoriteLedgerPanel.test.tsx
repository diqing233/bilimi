import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'

describe('FavoriteLedgerPanel', () => {
  it('asks before scanning old favorites for personalized ledgers from 备册', async () => {
    const onEnsureLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:list', 'api:ledger:create:humor'],
      missingTargets: [],
      message: '册目已备齐。'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [{ name: '效率研究所', count: 2, share: 2 / 3 }],
        topTags: [{ name: 'AI', count: 2 }],
        topCategories: [{ name: '科技数码', count: 2 }],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers().slice(0, 2)}
        missingLedgerIds={['kichiku']}
        onEnsureLedgers={onEnsureLedgers}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    expect(screen.getByText('掌库')).toBeInTheDocument()
    expect(screen.getByText('尚缺 Bilimi·鬼畜。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    expect(onEnsureLedgers).not.toHaveBeenCalled()
    expect(screen.getByText('是否根据旧藏生成你的专属库房？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '扫描旧藏生成' }))

    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledOnce())
    expect(screen.getByText('基础数据')).toBeInTheDocument()
    expect(screen.getByText('默认收藏夹 3')).toBeInTheDocument()
    const toolbar = container.querySelector('.favorite-ledger-panel__toolbar')
    const status = container.querySelector('.favorite-ledger-panel__status')
    const editor = container.querySelector('.favorite-ledger-panel__editor')

    expect(toolbar?.compareDocumentPosition(status as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(status?.compareDocumentPosition(editor as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('syncs checked Bilibili categories and personalized candidates', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'Bilimi·动画',
            enabled: true,
            isDefault: true
          }),
          expect.objectContaining({
            displayName: 'Bilimi·人工智能',
            enabled: true,
            isDefault: true
          })
        ])
      )
    )
  })

  it('edits the active ledger from the highlighted ledger buttons', async () => {
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

    expect(screen.queryByText('Bilimi·见闻增广')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '暂歇' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '鬼畜' }))

    expect(screen.getByText('正在编辑：Bilimi·鬼畜')).toBeInTheDocument()
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('册名'), {
      target: { value: 'Bilimi·音MAD' }
    })
    fireEvent.change(editor.getByLabelText('关键词'), {
      target: { value: '音MAD、鬼畜, 调音 / 人力' }
    })
    fireEvent.click(editor.getByRole('button', { name: '删除末词' }))
    fireEvent.click(editor.getByRole('button', { name: '新增关键词' }))

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'kichiku',
            displayName: 'Bilimi·音MAD',
            keywords: ['音MAD', '鬼畜', '调音', '新关键词']
          })
        ])
      )
    )
  })

  it('deletes only Bilimi custom ledgers after 同步', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '光影留真' }))
    fireEvent.click(screen.getByRole('button', { name: '删除 Bilimi·光影留真' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()
    expect(screen.queryByText('Bilimi·光影留真')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '个人摄影夹' }))
    expect(screen.getByText('正在编辑：个人摄影夹')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 个人摄影夹' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

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

  it('scans old favorites and executes only checked append operations', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi·知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 102,
          title: '爆笑鬼畜合集',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'kichiku',
          targetFolderId: '9002',
          targetDisplayName: 'Bilimi·鬼畜',
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
    fireEvent.click(screen.getByLabelText('整理 爆笑鬼畜合集'))
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([preview.items[0]]))
  })

  it('runs 同步 even when local selections are unchanged', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })

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

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent('掌库已同步。')
  })

  it('shows sync failures instead of failing silently', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '动画' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    expect(await screen.findByRole('status')).toHaveTextContent('同步未完成：账号同步超时')
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

  it('shows old favorite insights and lets users add suggested ledgers without AI', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 6,
        topAuthors: [{ name: '效率研究所', count: 4, share: 4 / 6 }],
        topTags: [
          { name: 'AI', count: 4 },
          { name: '工具', count: 3 }
        ],
        topCategories: [{ name: '科技', count: 4 }],
        sourceFolders: [{ name: '默认收藏夹', count: 6 }],
        titleSeries: [{ name: 'AI工具效率教程', count: 4 }],
        candidateLedgers: [
          {
            kind: 'tag-cluster',
            sourceName: 'AI',
            displayName: 'Bilimi·AI工具',
            keywords: ['AI', '工具', '效率'],
            count: 4,
            confidence: 'high',
            reason: '高频标签“AI”出现 4 次，适合单独成册。',
            aiEnhanced: false
          }
        ]
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByText('基础数据')).toBeInTheDocument()
    expect(screen.getByText('共扫描 6 条旧藏')).toBeInTheDocument()
    expect(screen.getByText('效率研究所 4')).toBeInTheDocument()
    expect(screen.getByText('AI 4')).toBeInTheDocument()
    expect(screen.getByText('默认收藏夹 6')).toBeInTheDocument()
    expect(screen.getByText('Bilimi·AI工具')).toBeInTheDocument()
    expect(screen.getByText(/本地统计/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Bilimi·AI工具'))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'Bilimi·AI工具',
            keywords: ['AI', '工具', '效率'],
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('marks AI-enhanced ledger suggestions when DeepSeek improves the local candidates', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 4,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 4 }],
        topCategories: [],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster',
            sourceName: 'AI',
            displayName: 'Bilimi·AI效率工坊',
            keywords: ['AI', '效率', '工具'],
            count: 4,
            confidence: 'high',
            reason: 'AI、效率、工具共现明显，适合合并成一个工作流册目。',
            aiEnhanced: true
          }
        ]
      }
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

    expect(await screen.findByText('Bilimi·AI效率工坊')).toBeInTheDocument()
    expect(screen.getByText(/AI 增强/)).toBeInTheDocument()
  })
})
