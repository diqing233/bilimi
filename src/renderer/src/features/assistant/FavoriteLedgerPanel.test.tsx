import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FavoriteLedgerPreview } from '../favorites/favoriteLedgerPreview'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'

describe('FavoriteLedgerPanel', () => {
  const safetyNote =
    '使用bilimi第一件事就是备册，生成专属收藏夹，同一个视频可以同时保存在不同的收藏夹里，小咪不会删除主人的旧收藏哦，安心使用吧'

  function renderPanel(overrides: Partial<Parameters<typeof FavoriteLedgerPanel>[0]> = {}) {
    return render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
        {...overrides}
      />
    )
  }

  it('does not render the standalone pending queue panel', () => {
    const onScanOldFavorites = vi.fn()

    renderPanel({
      onScanOldFavorites
    })

    expect(screen.queryByRole('region', { name: '待分类队列' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清空待分类队列' })).not.toBeInTheDocument()
    expect(onScanOldFavorites).not.toHaveBeenCalled()
  })

  it('shows clear toolbar descriptions for preparing and organizing ledgers', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: '备册' })).toHaveTextContent(
      '一键生成 bilimi 收藏夹，用于归类收藏和整理'
    )
    expect(screen.getByRole('button', { name: '整理旧藏' })).toHaveTextContent(
      '扫描旧藏，确认后整理到 bilimi 收藏夹里'
    )
  })

  it('shows only unresolved old favorites in a top pending section in archive preview', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 1,
          title: '真正待分类',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: true,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        },
        {
          aid: 2,
          title: '已经对号入座',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: true,
          selected: false,
          targets: []
        },
        {
          aid: 3,
          title: '自动归档视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'knowledge',
              folderId: '9001',
              displayName: 'bilimi·学吧你就',
              keywords: ['学习'],
              alreadyInTarget: false,
              selected: true
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const pendingGroup = screen.getByRole('group', { name: '未匹配到合适分类 1 条' })
    expect(pendingGroup).toBeInTheDocument()
    expect(within(pendingGroup).getByText('真正待分类')).toBeInTheDocument()
    expect(within(pendingGroup).queryByText('已经对号入座')).not.toBeInTheDocument()
    expect(within(pendingGroup).queryByText('自动归档视频')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })).toBeInTheDocument()
  })

  it('opens a pending old favorite for manual classification without removing it from the round', async () => {
    const onOpenOldFavoriteVideo = vi.fn()
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 242,
          title: '手动分类旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ onScanOldFavorites, onOpenOldFavoriteVideo })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    fireEvent.click(screen.getByRole('button', { name: '手动分类 手动分类旧藏' }))

    expect(onOpenOldFavoriteVideo).toHaveBeenCalledWith('https://www.bilibili.com/video/av242')
    expect(screen.getByRole('group', { name: '未匹配到合适分类 1 条' })).toBeInTheDocument()
    expect(screen.getByText('手动分类旧藏')).toBeInTheDocument()
  })

  it('adds a pending old favorite to staging for this round when requested', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 243,
          title: '暂存旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '存入暂存 暂存旧藏' }))

    const stagingGroup = screen.getByRole('group', { name: 'bilimi·暂存 1 条' })
    expect(within(stagingGroup).getByRole('button', { name: /暂存旧藏/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
  })

  it('selects all unmatched old favorites for inbox staging from the pending header', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 248,
          title: '暂存旧藏一',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        },
        {
          aid: 249,
          title: '暂存旧藏二',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全部存入暂存' }))

    const stagingGroup = screen.getByRole('group', { name: 'bilimi·暂存 2 条' })
    expect(within(stagingGroup).getByRole('button', { name: /暂存旧藏一/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(stagingGroup).getByRole('button', { name: /暂存旧藏二/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 2 条归档任务')).toBeInTheDocument()
  })

  it('keeps retry judgment available for pending old favorites without a usable target', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 246,
          title: '无法补判旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getByRole('button', { name: '手动分类 无法补判旧藏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '存入暂存 无法补判旧藏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再次判断 无法补判旧藏' })).toBeInTheDocument()
  })

  it('moves a pending old favorite into a matched ledger after retry judgment uses edited keywords', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'music' ? { ...ledger, bilibiliFolderId: '9006' } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 247,
          title: '很喜欢草根逆袭的故事',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '音乐舞台' }))
    fireEvent.change(screen.getByLabelText('关键词'), {
      target: { value: '歌曲、MV、草根逆袭' }
    })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '再次判断 很喜欢草根逆袭的故事' }))

    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·音乐舞台 1 条' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
  })

  it('refreshes a pending old favorite before rejudging without staging the matched target', async () => {
    const onRejudgeOldFavorite = vi.fn().mockResolvedValue({
      aid: 250,
      title: '用户刚补了标签',
      sourceFolderTitle: '默认收藏夹',
      targetLedgerId: 'game',
      targetFolderId: '9002',
      targetDisplayName: 'bilimi·游戏专区',
      reviewRequired: false,
      alreadyInTarget: false,
      selected: false,
      tags: ['原神'],
      targets: [
        {
          ledgerId: 'game',
          folderId: '9002',
          displayName: 'bilimi·游戏专区',
          keywords: ['原神'],
          alreadyInTarget: false,
          selected: true
        }
      ]
    })
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? { ...ledger, bilibiliFolderId: '9002', keywords: ['原神'] } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 250,
          title: '用户刚补了标签',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          tags: [],
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites, onRejudgeOldFavorite })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '再次判断 用户刚补了标签' }))

    await waitFor(() => expect(onRejudgeOldFavorite).toHaveBeenCalledWith(expect.objectContaining({ aid: 250 })))
    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 0 条归档任务')).toBeInTheDocument()
  })

  it('moves a pending old favorite into a candidate target group after further judgment', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 244,
          title: '原神旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:原神',
              ledgerId: 'custom-tag-cluster-原神',
              displayName: 'bilimi·原神',
              keywords: ['原神']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: '原神', count: 1 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: '原神',
            displayName: 'bilimi·原神',
            keywords: ['原神'],
            count: 1,
            confidence: 'medium' as const,
            reason: '原神标签适合单独成册。'
          }
        ]
      }
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '再次判断 原神旧藏' }))

    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·原神 1 条' })).toBeInTheDocument()
  })

  it('selects an existing candidate target when further judgment uses preview targets', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 245,
          title: 'UP 主旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          candidateTargets: [
            {
              candidateKey: 'author:老番茄',
              ledgerId: 'custom-author-老番茄',
              displayName: 'bilimi·老番茄',
              keywords: ['老番茄']
            }
          ],
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'bilimi·暂存',
              keywords: [],
              alreadyInTarget: false,
              selected: false
            },
            {
              ledgerId: 'custom-author-老番茄',
              folderId: '',
              displayName: 'bilimi·老番茄',
              keywords: ['老番茄'],
              alreadyInTarget: false,
              selected: false,
              selectedCandidateTarget: true,
              candidateKey: 'author:老番茄'
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [{ name: '老番茄', count: 1, share: 1 }],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'author' as const,
            sourceName: '老番茄',
            displayName: 'bilimi·老番茄',
            keywords: ['老番茄'],
            count: 1,
            confidence: 'medium' as const,
            reason: '固定 UP 适合追更。'
          }
        ]
      }
    })

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '再次判断 UP 主旧藏' }))

    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·老番茄 1 条' })).toBeInTheDocument()
  })

  it('backs up ledgers directly from 备册 without the old setup prompt', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )
    const onEnsureLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:list', 'api:ledger:create:humor'],
      missingTargets: [],
      message: '册目已备齐。'
    })
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })
    const onOpenFavoritePage = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['favorite-page:open'],
      missingTargets: [],
      message: '已打开 B 站收藏夹。'
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
    const props: Parameters<typeof FavoriteLedgerPanel>[0] & {
      onOpenFavoritePage: typeof onOpenFavoritePage
    } = {
      ledgers,
      missingLedgerIds: ['game'],
      onEnsureLedgers,
      onSaveLedgers,
      onScanOldFavorites,
      onExecuteOldFavoritePlan: vi.fn(),
      onOpenFavoritePage
    }

    const { container } = render(<FavoriteLedgerPanel {...props} />)

    expect(screen.getByRole('heading', { name: '掌库' })).toHaveClass('sr-only')
    expect(screen.getByText('尚缺 bilimi·游戏专区。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    expect(onEnsureLedgers).not.toHaveBeenCalled()
    expect(onScanOldFavorites).not.toHaveBeenCalled()
    expect(screen.queryByText('是否根据旧藏生成你的专属库房？')).not.toBeInTheDocument()

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())

    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'bilimi·影视动漫', enabled: true }),
        expect.objectContaining({ displayName: 'bilimi·游戏专区', enabled: true }),
        expect.objectContaining({ displayName: 'bilimi·知识学习', enabled: true }),
        expect.objectContaining({ displayName: 'bilimi·生活日常', enabled: true })
      ]),
      { deleteDisabled: false }
    )
    await waitFor(() => expect(onOpenFavoritePage).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '小咪备册已完成，主人可以再增加自己想要的收藏夹，点击同步即可'
    )
    const toolbar = container.querySelector('.favorite-ledger-panel__toolbar')
    const status = container.querySelector('.favorite-ledger-panel__status')
    const workspace = container.querySelector('.favorite-ledger-panel__workspace')

    expect(toolbar?.compareDocumentPosition(status as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(status?.compareDocumentPosition(workspace as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
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
            displayName: 'bilimi·影视动漫',
            enabled: true,
            isDefault: true
          }),
          expect.objectContaining({
            displayName: 'bilimi·知识学习',
            enabled: true,
            isDefault: true
          })
        ])
      )
    )
  })

  it('uses a compact ledger header with the framed default ledgers and lower-right creation controls', async () => {
    const ledgers = createDefaultFavoriteLedgers()

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    expect(within(ledgerRegion).getByRole('heading', { name: '收藏夹' })).toBeInTheDocument()
    expect(screen.queryByText('推荐主分类收藏夹')).not.toBeInTheDocument()

    const headerActions = ledgerRegion.querySelector('.favorite-ledger-panel__category-actions')!
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '重置' })).toBeInTheDocument()
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '取消全选' })).toBeInTheDocument()
    expect(within(headerActions as HTMLElement).queryByRole('button', { name: '全选' })).not.toBeInTheDocument()
    expect(within(headerActions as HTMLElement).queryByRole('button', { name: '展开' })).not.toBeInTheDocument()
    expect(within(headerActions as HTMLElement).queryByRole('button', { name: '新建收藏夹' })).not.toBeInTheDocument()
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '同步' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(ledgerRegion.querySelector('.favorite-ledger-panel__sync-hint')).toHaveTextContent(
      '自定义你的bilimi收藏夹，点击收藏名字可以进行编辑，添加好后点击【同步】即可更新到b站；取消勾选再点击同步，也会删除对应的 bilimi 收藏夹。'
    )

    const visibleLedgerNames = Array.from(
      ledgerRegion.querySelector('.favorite-ledger-panel__chips')?.children ?? []
    ).map((item) => within(item as HTMLElement).getAllByRole('button')[0].textContent)
    expect(visibleLedgerNames).toEqual([
      '知识学习',
      '游戏专区',
      '影视动漫',
      '创意美学',
      '生活日常',
      '音乐舞台',
      '搞笑杂谈',
      '暂存'
    ])
    expect(within(ledgerRegion).queryByRole('button', { name: '鬼畜' })).not.toBeInTheDocument()
    expect(within(ledgerRegion).queryByRole('button', { name: '旅游出行' })).not.toBeInTheDocument()
    expect(ledgerRegion.querySelector('.favorite-ledger-panel__chips')?.children).toHaveLength(8)
    const listToggle = ledgerRegion.querySelector('.favorite-ledger-panel__list-toggle')!
    const creationControls = within(listToggle as HTMLElement).getAllByRole('button')
    expect(creationControls.map((button) => button.textContent)).toEqual(['新建收藏夹'])
    expect(within(listToggle as HTMLElement).queryByRole('button', { name: '展开' })).not.toBeInTheDocument()
    expect(within(listToggle as HTMLElement).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()
  })

  it('selects and clears every ledger before sync from the header actions', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'movie-tv' || ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )

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

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    const headerActions = ledgerRegion.querySelector('.favorite-ledger-panel__category-actions')!

    fireEvent.click(within(headerActions as HTMLElement).getByRole('button', { name: '全选' }))
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '取消全选' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'movie-tv', enabled: true }),
          expect.objectContaining({ id: 'knowledge', enabled: true })
        ])
      )
    )

    fireEvent.click(within(headerActions as HTMLElement).getByRole('button', { name: '取消全选' }))
    expect(within(headerActions as HTMLElement).getByRole('button', { name: '全选' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'movie-tv', enabled: false }),
          expect.objectContaining({ id: 'knowledge', enabled: false })
        ])
      )
    )
  })

  it('starts with an empty editor area until a ledger is selected', () => {
    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    expect(container.querySelector('.favorite-ledger-panel__editor-placeholder')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))

    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    expect(screen.getByText('正在编辑：bilimi·影视动漫')).toBeInTheDocument()
  })
  it('frames the ledger list and editor together in the workspace', () => {
    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const workspace = container.querySelector('.favorite-ledger-panel__workspace')
    expect(workspace).toBeInTheDocument()
    expect(workspace?.querySelector('.favorite-ledger-panel__checklist')).toBeInTheDocument()
    expect(workspace?.querySelector('.favorite-ledger-panel__editor-placeholder')).toBeInTheDocument()
  })

  it('selects a ledger without changing whether it syncs', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'movie-tv' ? { ...ledger, enabled: false } : ledger
    )
    const targetLedger = ledgers.find((ledger) => ledger.id === 'movie-tv')!
    const targetLabel = targetLedger.displayName.replace(/^bilimi[·\s-]*/i, '')

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

    const ledgerButton = screen.getByRole('button', { name: targetLabel })
    expect(ledgerButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(ledgerButton)

    expect(screen.getByText(`正在编辑：${targetLedger.displayName}`)).toBeInTheDocument()
    expect(screen.getByDisplayValue(targetLabel)).toBeInTheDocument()
    expect(ledgerButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            enabled: false
          })
        ])
      )
    )
  })

  it('adds a disabled ledger to sync without asking for confirmation', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'movie-tv' ? { ...ledger, enabled: false } : ledger
    )
    const targetLedger = ledgers.find((ledger) => ledger.id === 'movie-tv')!
    const targetLabel = targetLedger.displayName.replace(/^bilimi[·\s-]*/i, '')

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

    const ledgerButton = screen.getByRole('button', { name: targetLabel })
    const addButton = screen.getByRole('button', {
      name: new RegExp(targetLedger.displayName)
    })
    fireEvent.click(addButton)

    expect(ledgerButton).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen
        .queryAllByRole('dialog')
        .some((dialog) => dialog.classList.contains('favorite-ledger-panel__sync-confirm'))
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            enabled: true
          })
        ])
      )
    )
  })

  it('creates a new custom ledger from the final shortcut without the old form', async () => {
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

    const chips = screen.getByRole('region', { name: '收藏夹' })
        expect(chips.querySelector('.favorite-ledger-panel__add-shortcut')).not.toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '新立册目' })).not.toBeInTheDocument()

    fireEvent.click(within(chips).getByRole('button', { name: '新建收藏夹' }))

    expect(screen.getByText('正在编辑：bilimi·')).toBeInTheDocument()
    const nextChipItems = Array.from(
      chips.querySelector('.favorite-ledger-panel__chips')?.children ?? []
    )
    const newLedgerItemIndex = nextChipItems.findIndex((item) =>
      within(item as HTMLElement).queryByRole('button', { name: '选择新建收藏夹' })
    )
    expect(newLedgerItemIndex).toBe(nextChipItems.length - 1)
    expect(within(chips).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    expect(editor.getByLabelText('收藏夹种类')).toHaveValue('keyword')
    fireEvent.change(editor.getByLabelText('册名'), { target: { value: '摄影' } })
    fireEvent.change(editor.getByLabelText('关键词'), { target: { value: '摄影 写真、镜头' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·摄影' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·摄影',
            keywords: ['摄影', '写真', '镜头'],
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('edits a new ledger as an author follow-up collection', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: 'favorite ledgers saved'
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

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('收藏夹种类'), { target: { value: 'author' } })
    expect(editor.getByLabelText('UP 名字')).toBeInTheDocument()
    expect(
      screen.getByText('填写一个或多个 UP 名，命中作者时会优先存入这个收藏夹。')
    ).toBeInTheDocument()

    fireEvent.change(editor.getByLabelText('册名'), { target: { value: '我的追更' } })
    fireEvent.change(editor.getByLabelText('UP 名字'), { target: { value: '影视飓风、罗翔说刑法' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·我的追更' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·我的追更',
            keywords: ['影视飓风', '罗翔说刑法'],
            ruleType: 'author',
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('saves the dragged ledger order and keeps new ledgers in the header action', async () => {
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

    const chips = screen.getByRole('region', { name: '收藏夹' })
        const chipGrid = chips.querySelector('.favorite-ledger-panel__chips')!
    const musicItem = within(chips).getByRole('button', { name: '音乐舞台' }).closest('.favorite-ledger-panel__chip-item')!
    const knowledgeItem = within(chips).getByRole('button', { name: '知识学习' }).closest('.favorite-ledger-panel__chip-item')!

    fireEvent.dragStart(musicItem, { dataTransfer: { effectAllowed: '', setData: vi.fn() } })
    fireEvent.dragOver(knowledgeItem, { dataTransfer: { dropEffect: '' } })
    fireEvent.drop(knowledgeItem, { dataTransfer: { getData: () => 'music' } })

    expect(
      Array.from(chipGrid.children).some((item) =>
        item.classList.contains('favorite-ledger-panel__add-shortcut')
      )
    ).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    const savedLedgers = onSaveLedgers.mock.calls[0][0]
    const savedLedgerIds = savedLedgers.map((ledger) => ledger.id)
    expect(savedLedgerIds.indexOf('music')).toBeLessThan(savedLedgerIds.indexOf('knowledge'))
    expect(savedLedgers.find((ledger) => ledger.id === 'music')!.priority).toBeLessThan(
      savedLedgers.find((ledger) => ledger.id === 'knowledge')!.priority
    )
    expect(await screen.findByRole('status')).toHaveTextContent('掌库已同步。')
  })

  it('keeps ledger positions stable while showing an insertion line during dragging', async () => {
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

    const chips = screen.getByRole('region', { name: '收藏夹' })
        const chipGrid = chips.querySelector('.favorite-ledger-panel__chips')!
    const musicItem = within(chips).getByRole('button', { name: '音乐舞台' }).closest('.favorite-ledger-panel__chip-item')!
    const knowledgeItem = within(chips).getByRole('button', { name: '知识学习' }).closest('.favorite-ledger-panel__chip-item')!
    const orderBeforeDrag = Array.from(chipGrid.children).map(
      (item) => item.querySelector('button')?.textContent ?? ''
    )

    fireEvent.dragStart(musicItem, { dataTransfer: { effectAllowed: '', setData: vi.fn() } })
    fireEvent.dragOver(knowledgeItem, { dataTransfer: { dropEffect: '' } })

    const stableOrder = Array.from(chipGrid.children).map(
      (item) => item.querySelector('button')?.textContent ?? ''
    )

    expect(stableOrder).toEqual(orderBeforeDrag)
    expect(musicItem).toHaveAttribute('data-dragging', 'true')
    expect(knowledgeItem).toHaveAttribute('data-drop-target', 'true')
  })

  it('moves a later dragged ledger before the insertion-line target on drop', async () => {
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

    const chips = screen.getByRole('region', { name: '收藏夹' })
        const musicItem = within(chips).getByRole('button', { name: '音乐舞台' }).closest('.favorite-ledger-panel__chip-item')!
    const gameItem = within(chips).getByRole('button', { name: '游戏专区' }).closest('.favorite-ledger-panel__chip-item')!

    fireEvent.dragStart(musicItem, { dataTransfer: { effectAllowed: '', setData: vi.fn() } })
    fireEvent.dragOver(gameItem, { dataTransfer: { dropEffect: '' } })
    fireEvent.drop(gameItem, { dataTransfer: { getData: () => 'music' } })
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    const savedLedgerIds = onSaveLedgers.mock.calls[0][0].map((ledger) => ledger.id)
    expect(savedLedgerIds.indexOf('music')).toBe(savedLedgerIds.indexOf('game') - 1)
    expect(savedLedgerIds.indexOf('music')).toBeLessThan(savedLedgerIds.indexOf('movie-tv'))
    expect(savedLedgerIds.indexOf('game')).toBeLessThan(savedLedgerIds.indexOf('movie-tv'))
  })

  it('resets the ledger draft to unchecked defaults before saving', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger, index) =>
      ledger.id === 'movie-tv'
        ? {
            ...ledger,
            displayName: 'bilimi·影视动漫改名',
            enabled: false,
            priority: 999
          }
        : {
            ...ledger,
            priority: (index + 5) * 10
          }
    )

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

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            displayName: 'bilimi·影视动漫',
            enabled: false,
            priority: 30
          }),
          expect.objectContaining({
            id: 'inbox',
            enabled: false
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

    expect(screen.queryByText('bilimi·见闻增广')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '暂歇' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))

    expect(screen.getByText('正在编辑：bilimi·影视动漫')).toBeInTheDocument()
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('册名'), {
      target: { value: 'bilimi·音MAD' }
    })
    fireEvent.change(editor.getByLabelText('关键词'), {
      target: { value: '音MAD、鬼畜 调音 / 人力' }
    })

    expect(editor.queryByRole('button', { name: '删除末词' })).not.toBeInTheDocument()
    expect(editor.queryByRole('button', { name: '新增关键词' })).not.toBeInTheDocument()
    expect(screen.getByText('不同关键词用顿号或空格隔开，逗号、斜杠也能识别。')).toBeInTheDocument()

    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            displayName: 'bilimi·音MAD',
            keywords: ['音MAD', '鬼畜', '调音', '人力']
          })
        ])
      )
    )
  })

  it('switches directly to another ledger when the editor is clean', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    expect(screen.getByText('正在编辑：bilimi·影视动漫')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))

    expect(screen.getByText('正在编辑：bilimi·知识学习')).toBeInTheDocument()
    expect(screen.queryByText('正在编辑：bilimi·影视动漫')).not.toBeInTheDocument()
  })

  it('collapses an unmodified editor when clicking outside the editor', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    expect(screen.getByText('正在编辑：bilimi·影视动漫')).toBeInTheDocument()

    fireEvent.click(
      screen.getByText(safetyNote)
    )

    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
  })
  it('warns instead of switching away when the active ledger has unsaved edits', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('册名'), {
      target: { value: '音MAD' }
    })
    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))

    expect(screen.getByText('正在编辑：bilimi·音MAD')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('当前收藏夹有未保存修改，请先保存。')
  })

  it('keeps an unsaved editor open when clicking outside the editor', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('册名'), {
      target: { value: '音MAD' }
    })
    fireEvent.click(
      screen.getByText(safetyNote)
    )

    expect(screen.getByText('正在编辑：bilimi·音MAD')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('当前收藏夹有未保存修改，请先保存。')
  })

  it('places save before delete in the editor title and deletes only the selected duplicate-id ledger', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-new-ledger',
        displayName: 'bilimi·摄影',
        keywords: ['摄影'],
        enabled: true,
        priority: 100,
        isDefault: false
      },
      {
        id: 'custom-new-ledger',
        displayName: 'bilimi·剪辑',
        keywords: ['剪辑'],
        enabled: true,
        priority: 110,
        isDefault: false
      }
    ]

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={vi.fn()}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    const chips = screen.getByRole('region', { name: '收藏夹' })
    fireEvent.click(screen.getByRole('button', { name: '摄影' }))

    const editorTitle = screen.getByText('正在编辑：bilimi·摄影').closest('.favorite-ledger-panel__editor-title')!
    const titleButtons = within(editorTitle as HTMLElement).getAllByRole('button')
    expect(titleButtons.map((button) => button.textContent)).toEqual(['保存', '删除'])

    fireEvent.click(within(editorTitle as HTMLElement).getByRole('button', { name: '删除 bilimi·摄影' }))

    expect(screen.queryByRole('button', { name: '摄影' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '剪辑' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
  })
  it('keeps the Bilimi prefix fixed while editing a managed ledger name', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))

    expect(editor.getByText('bilimi·')).toBeInTheDocument()
    const nameInput = editor.getByLabelText('册名')
    expect(nameInput).toHaveValue('影视动漫')

    fireEvent.change(nameInput, {
      target: { value: '音MAD' }
    })
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'movie-tv',
            displayName: 'bilimi·音MAD'
          })
        ])
      )
    )
  })

  it('explains that ledger keywords are rules used to match future favorites', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))

    expect(
      screen.getByText('建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。')
    ).toBeInTheDocument()
  })

  it('deletes only Bilimi custom ledgers after 同步', async () => {
    const onSaveLedgers = vi.fn()
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-photo',
        displayName: 'bilimi·光影留真',
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
    fireEvent.click(screen.getByRole('button', { name: '删除 bilimi·光影留真' }))

    expect(onSaveLedgers).not.toHaveBeenCalled()
    expect(screen.queryByText('bilimi·光影留真')).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: '删除 bilimi·见闻增广' })).not.toBeInTheDocument()
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

  it('guides old favorite organization through scan, recommended ledgers, preview, and confirmation', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi路知识',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'Bilimi路AI效率工坊',
              keywords: ['AI', '效率', '工具']
            }
          ]
        },
        {
          aid: 102,
          title: '标题党软广避雷',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'Bilimi路待分类',
          reviewRequired: true,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 103,
          title: '已经归档的视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi路知识',
          reviewRequired: false,
          alreadyInTarget: true,
          selected: false
        }
      ],
      skippedSourceFolderTitles: ['Bilimi路知识'],
      insights: {
        totalVideos: 3,
        topAuthors: [{ name: '效率研究所', count: 2, share: 2 / 3 }],
        topTags: [{ name: 'AI', count: 2 }],
        topCategories: [{ name: '科技', count: 2 }],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: 'AI',
            displayName: 'Bilimi路AI效率工坊',
            keywords: ['AI', '效率', '工具'],
            count: 2,
            confidence: 'medium' as const,
            reason: 'DeepSeek 认为 AI 与效率工具可以合并成一个工作流收藏夹。',
          }
        ]
      }
    }
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: '旧藏整理已完成。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('可自动归档')).toBeInTheDocument()
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('需复核')).toBeInTheDocument()
    expect(screen.getByText('已存在')).toBeInTheDocument()
    expect(screen.getByText('跳过来源')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const candidateSection = screen.getByRole('region', { name: '专属收藏夹候选' })
    expect(within(candidateSection).getByText('暂无专属 UP 追更候选。')).toBeInTheDocument()
    const firstCandidateCard = screen.getByLabelText('Bilimi路AI效率工坊').closest('article')!
    expect(firstCandidateCard).toHaveTextContent('AI效率工坊')
    expect(firstCandidateCard).toHaveTextContent('1 条适合')
    expect(screen.getByLabelText('Bilimi路AI效率工坊')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('全选 高频标签收藏夹'))
    expect(screen.getByLabelText('Bilimi路AI效率工坊')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getAllByText('机器学习科普教程')).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Bilimi路AI效率工坊 1 条' })).toBeInTheDocument()
    expect(screen.getByText('标题党软广避雷')).toBeInTheDocument()
    expect(screen.getByText(/需要复核/)).toBeInTheDocument()
    expect(screen.queryByText('已经归档的视频')).not.toBeInTheDocument()
    const knowledgeGroup = screen.getByRole('group', { name: 'Bilimi路知识 1 条' })
    const knowledgeVideo = within(knowledgeGroup).getByRole('button', { name: /机器学习科普教程/ })
    expect(knowledgeVideo).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(knowledgeVideo)

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认整理' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    const refreshedKnowledgeGroup = screen.getByRole('group', { name: 'Bilimi路知识 1 条' })
    fireEvent.click(within(refreshedKnowledgeGroup).getByRole('button', { name: /机器学习科普教程/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledTimes(2))
    expect(onSaveLedgers.mock.invocationCallOrder[1]).toBeLessThan(
      onExecuteOldFavoritePlan.mock.invocationCallOrder[0]
    )
    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'bilimi·影视动漫', enabled: true }),
        expect.objectContaining({
          displayName: 'bilimi·AI效率工坊',
          keywords: ['AI', '效率', '工具'],
          enabled: true,
          isDefault: false
        })
      ])
    )
    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(onExecuteOldFavoritePlan).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        aid: 101,
        targetLedgerId: 'knowledge',
        targetFolderId: '9001'
      })
    ])
    expect(onExecuteOldFavoritePlan).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        aid: 101,
        targetLedgerId: 'custom-tag-cluster-AI',
        targetFolderId: '',
        selectedCandidateTarget: true
      })
    ])
  })

  it('shows the full old favorite title on hover while preview titles can be truncated', async () => {
    const longTitle =
      '【原神】枫丹七分熟！居鸟哥欣赏至冬新角色，他还是那么爱男角色'
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: longTitle,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏专区',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
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
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const title = screen
      .getByText(longTitle)
      .closest('.favorite-ledger-panel__preview-video-title')
    expect(title).toHaveAttribute('title', longTitle)
  })

  it('syncs missing ledgers before organizing old favorites', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: 'favorite ledgers saved'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers().slice(0, 2)}
        missingLedgerIds={['knowledge']}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledOnce())
    expect(onSaveLedgers.mock.invocationCallOrder[0]).toBeLessThan(
      onScanOldFavorites.mock.invocationCallOrder[0]
    )
    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '整理旧藏' })).toBeInTheDocument()
    expect(screen.queryByText('是否根据旧藏生成你的专属库房？')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('可勾选后整理')
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
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 102,
          title: '爆笑鬼畜合集',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·影视动漫',
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

    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByText('机器学习科普教程')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·知识学习 1 条' })).toBeInTheDocument()
    const movieGroup = screen.getByRole('group', { name: 'bilimi·影视动漫 1 条' })
    fireEvent.click(within(movieGroup).getByRole('button', { name: /爆笑鬼畜合集/ }))
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([preview.items[0]]))
  })

  it('stops old favorite batches when Bilibili protection pauses execution', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: 'old favorite one',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 102,
          title: 'old favorite two',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: false,
      steps: ['api:ledger:protection-paused:101'],
      missingTargets: ['favorite-ledger-protection'],
      message:
        'Bilibili may be protecting your account from high-frequency favorite changes. Old favorite organization is paused; wait a while, then continue with the remaining items.',
      paused: true,
      completedCount: 0,
      failedCount: 1,
      remainingCount: 1
    })

    const { container } = render(
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

    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent(
        '本次整理已暂停'
      )
    )
    expect(screen.getByRole('button', { name: '好的' })).toBeInTheDocument()
  })

  it('updates old favorite progress after each selected archive task', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: 'old favorite with two targets',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'knowledge',
              folderId: '9001',
              displayName: 'Bilimi Knowledge',
              keywords: ['knowledge'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'movie-tv',
              folderId: '9002',
              displayName: 'Bilimi Movie',
              keywords: ['movie'],
              alreadyInTarget: false,
              selected: true
            }
          ]
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    let resolveFirst: ((value: { ok: boolean; steps: string[]; missingTargets: string[]; message: string }) => void) | undefined
    const firstCall = new Promise<{ ok: boolean; steps: string[]; missingTargets: string[]; message: string }>(
      (resolve) => {
        resolveFirst = resolve
      }
    )
    let resolveSecond: ((value: { ok: boolean; steps: string[]; missingTargets: string[]; message: string }) => void) | undefined
    const secondCall = new Promise<{ ok: boolean; steps: string[]; missingTargets: string[]; message: string }>(
      (resolve) => {
        resolveSecond = resolve
      }
    )
    const onExecuteOldFavoritePlan = vi
      .fn()
      .mockReturnValueOnce(firstCall)
      .mockReturnValueOnce(secondCall)

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__toolbar button')[1])
    await waitFor(() => expect(container.querySelector('.favorite-ledger-panel__old-favorites-guide')).toBeInTheDocument())
    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__guide-steps button')[2])
    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__guide-steps button')[3])
    fireEvent.click(container.querySelector('.favorite-ledger-panel__confirm button')!)

    await waitFor(() =>
      expect(container.querySelector('.favorite-ledger-panel__old-favorite-progress progress')).toHaveAttribute(
        'value',
        '0'
      )
    )
    expect(container.querySelector('.favorite-ledger-panel__old-favorite-progress progress')).toHaveAttribute(
      'max',
      '2'
    )
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(1)
    expect(onExecuteOldFavoritePlan).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ targetLedgerId: 'knowledge' })
    ])

    await act(async () => {
      resolveFirst?.({
        ok: true,
        steps: ['api:ledger:append:101'],
        missingTargets: [],
        message: 'done'
      })
      await firstCall
    })

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(container.querySelector('.favorite-ledger-panel__old-favorite-progress progress')).toHaveAttribute(
      'value',
      '1'
    )
    expect(onExecuteOldFavoritePlan).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ targetLedgerId: 'movie-tv' })
    ])

    await act(async () => {
      resolveSecond?.({
        ok: true,
        steps: ['api:ledger:append:101'],
        missingTargets: [],
        message: 'done'
      })
      await secondCall
    })

    await waitFor(() =>
      expect(container.querySelector('.favorite-ledger-panel__old-favorite-progress progress')).toHaveAttribute(
        'value',
        '2'
      )
    )
  })

  it('keeps old favorite organization locked until the completion acknowledgement', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: 'old favorite one',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'Bilimi Knowledge',
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
      message: 'done'
    })

    const { container } = render(
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
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: '好的' })).toBeInTheDocument())
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('本次整理已结束')

    fireEvent.click(screen.getByRole('button', { name: '备册' }))
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('正在整理中，请耐心等待')

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('正在整理中，请耐心等待')
    expect(onScanOldFavorites).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '好的' }))
    expect(screen.getByRole('button', { name: '确认整理' })).toBeInTheDocument()
  })

  it('defaults recommended old favorite ledgers on and previews videos grouped by ledger', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'movie-tv') {
        return { ...ledger, bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      return ledger
    })
    const preview = {
      items: [
        {
          aid: 101,
          title: '影视飓风相机评测',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'movie-tv',
              folderId: '9001',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-author-影视飓风',
              folderId: '',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'author:影视飓风'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'author:影视飓风',
              ledgerId: 'custom-author-影视飓风',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风']
            }
          ]
        },
        {
          aid: 102,
          title: '影视飓风剪辑教程',
          sourceFolderTitle: 'bilimi·待分类',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'movie-tv',
              folderId: '9001',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-author-影视飓风',
              folderId: '',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'author:影视飓风'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'author:影视飓风',
              ledgerId: 'custom-author-影视飓风',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风']
            }
          ]
        },
        {
          aid: 103,
          title: '影视飓风调色教程',
          sourceFolderTitle: 'bilimi·影视飓风追更',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'movie-tv',
              folderId: '9001',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-author-影视飓风',
              folderId: '',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'author:影视飓风'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'author:影视飓风',
              ledgerId: 'custom-author-影视飓风',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [{ name: '影视飓风', count: 3, share: 1 }],
        topTags: [],
        topCategories: [{ name: '影视', count: 2 }],
        sourceFolders: [
          { name: '默认收藏夹', count: 1 },
          { name: 'bilimi·影视飓风追更', count: 4 },
          { name: 'bilimi·待分类', count: 1 }
        ],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'author' as const,
            sourceName: '影视飓风',
            displayName: 'bilimi·影视飓风追更',
            keywords: ['影视飓风'],
            count: 2,
            confidence: 'high' as const,
            reason: '旧藏推荐：2 条旧藏适合归入此收藏夹。',
          }
        ]
      }
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
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByText('扫描收藏夹')).toBeInTheDocument()
    expect(screen.getByText('用户收藏夹')).toBeInTheDocument()
    expect(screen.getByText('bilimi 工作夹')).toBeInTheDocument()
    expect(screen.getByLabelText('整理来源 bilimi·影视飓风追更')).toBeChecked()
    expect(screen.getByLabelText('整理来源 bilimi·待分类')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·影视飓风追更')).not.toBeChecked()
    expect(screen.queryByLabelText('bilimi·影视动漫')).not.toBeInTheDocument()
    const authorCandidateCard = screen.getByLabelText('bilimi·影视飓风追更').closest('article')
    expect(authorCandidateCard).toHaveAttribute('title', '影视飓风追更')
    expect(authorCandidateCard).toHaveTextContent('影视飓风追更')
    expect(authorCandidateCard).not.toHaveTextContent('bilimi·影视飓风追更')
    expect(authorCandidateCard).toHaveTextContent('3 条适合')
    expect(authorCandidateCard).not.toHaveTextContent('固定 UP · 固定 UP')
    expect(screen.queryByText('初始收藏夹')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('全选 专属 UP 追更'))
    expect(screen.getByLabelText('bilimi·影视飓风追更')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const movieGroup = screen.getByRole('group', { name: 'bilimi·影视动漫 3 条' })
    const authorGroup = screen.getByRole('group', { name: 'bilimi·影视飓风追更 3 条' })
    expect(movieGroup).toHaveClass('favorite-ledger-panel__preview-row')
    expect(authorGroup).toHaveClass('favorite-ledger-panel__preview-row')
    const movieTrack = movieGroup.querySelector('.favorite-ledger-panel__preview-videos')
    const authorTrack = authorGroup.querySelector('.favorite-ledger-panel__preview-videos')
    expect(movieTrack).toHaveAttribute('aria-label', 'bilimi·影视动漫 视频')
    expect(authorTrack).toHaveAttribute('aria-label', 'bilimi·影视飓风追更 视频')
    expect(movieTrack?.children).toHaveLength(3)
    expect(authorTrack?.children).toHaveLength(3)
    expect(movieGroup.querySelector('.favorite-ledger-panel__preview-heading')).toBeInTheDocument()
    expect(movieTrack?.querySelector('.favorite-ledger-panel__preview-video-title')).toBeInTheDocument()
    expect(movieGroup.querySelector('.favorite-ledger-panel__preview-heading')).toHaveAttribute(
      'title',
      'bilimi·影视动漫'
    )
    expect(within(movieGroup).getByLabelText('全选 bilimi·影视动漫')).toBeChecked()
    expect(within(authorGroup).getByLabelText('全选 bilimi·影视飓风追更')).toBeChecked()
    const movieVideo = within(movieGroup).getByRole('button', { name: /影视飓风相机评测/ })
    const authorVideo = within(authorGroup).getByRole('button', { name: /影视飓风剪辑教程/ })
    expect(movieVideo).toHaveAttribute('aria-pressed', 'true')
    expect(authorVideo).toHaveAttribute('aria-pressed', 'true')
    expect(within(movieGroup).queryByLabelText('整理 影视飓风相机评测 到 bilimi·影视动漫')).not.toBeInTheDocument()
  })

  it('does not fall back unchecked old favorite targets to inbox before executing', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'movie-tv') {
        return { ...ledger, bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      return ledger
    })
    const preview = {
      items: [
        {
          aid: 101,
          title: '影视飓风相机评测',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          targets: [
            {
              ledgerId: 'movie-tv',
              folderId: '9001',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-author-影视飓风',
              folderId: '',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'author:影视飓风'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'author:影视飓风',
              ledgerId: 'custom-author-影视飓风',
              displayName: 'bilimi·影视飓风追更',
              keywords: ['影视飓风']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [{ name: '影视飓风', count: 2, share: 1 }],
        topTags: [],
        topCategories: [{ name: '影视', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'author' as const,
            sourceName: '影视飓风',
            displayName: 'bilimi·影视飓风追更',
            keywords: ['影视飓风'],
            count: 2,
            confidence: 'high' as const,
            reason: '旧藏推荐：2 条旧藏适合归入此收藏夹。',
          }
        ]
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: '掌库已同步。' })}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByLabelText('全选 bilimi·影视动漫'))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 0 条归档任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认整理' })).toBeDisabled()
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()
  })

  it('lets users choose which old favorite source folders to organize from the scan overview', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 202,
          title: '东京旅行攻略',
          sourceFolderTitle: '旅行收藏',
          targetLedgerId: 'life-interest',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·生活日常',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [
          { name: '默认收藏夹', count: 1 },
          { name: '旅行收藏', count: 1 }
        ],
        titleSeries: [],
        candidateLedgers: []
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
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
    await screen.findByRole('region', { name: '整理旧藏向导' })

    fireEvent.click(screen.getByLabelText('整理来源 旅行收藏'))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getByText('机器学习科普教程')).toBeInTheDocument()
    expect(screen.queryByText('东京旅行攻略')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([preview.items[0]]))
  })

  it('syncs generated ledgers on confirmation and executes selected generated targets', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: 'AI 效率工具实战',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'custom-tag-cluster-AI',
          targetFolderId: '',
          targetDisplayName: 'bilimi·AI效率工坊',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          selectedCandidateTarget: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'bilimi·AI效率工坊',
              keywords: ['AI', '效率', '工具']
            }
          ],
          targets: [
            {
              ledgerId: 'custom-tag-cluster-AI',
              folderId: '',
              displayName: 'bilimi·AI效率工坊',
              keywords: ['AI', '效率', '工具'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'tag-cluster:AI'
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 1 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: 'AI',
            displayName: 'bilimi·AI效率工坊',
            keywords: ['AI', '效率', '工具'],
            count: 1,
            confidence: 'medium' as const,
            reason: '高频标签 AI 适合单独成册。',
          }
        ]
      }
    }
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:101'],
      missingTargets: [],
      message: '已归档一条。'
    })

    render(
      <FavoriteLedgerPanel
        ledgers={createDefaultFavoriteLedgers()}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·AI效率工坊')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('全选 高频标签收藏夹'))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([
        expect.objectContaining({
          aid: 101,
          targetLedgerId: 'custom-tag-cluster-AI',
          targetFolderId: '',
          targetDisplayName: 'bilimi·AI效率工坊',
          selectedCandidateTarget: true
        })
      ])
    )
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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    expect(await screen.findByRole('status')).toHaveTextContent('同步未完成：账号同步超时')
  })

  it('explains the Bilibili favorite folder limit in Chinese', async () => {
    const onSaveLedgers = vi.fn().mockRejectedValue(
      new Error(
        "Error invoking remote method 'floating-assistant:save-ledgers': Error: BILI_MANAGER_CALL: Error: favorite ledger create failed: 已达到数量上限"
      )
    )

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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '同步未完成：收藏夹数量已超过b站上限99个，小咪已经无法再生成更多收藏夹了，主人想继续使用建议适当删除几个哦'
    )
  })

  it('shows a status message while old favorites are scanning', async () => {
    let resolveSave:
      | ((value: { ok: boolean; steps: string[]; missingTargets: string[]; message: string }) => void)
      | undefined
    const savePromise = new Promise<{ ok: boolean; steps: string[]; missingTargets: string[]; message: string }>(
      (resolve) => {
        resolveSave = resolve
      }
    )
    const onSaveLedgers = vi.fn().mockReturnValue(savePromise)
    let resolveScan: (preview: FavoriteLedgerPreview) => void = () => {}
    const onScanOldFavorites = vi.fn(
      () =>
        new Promise<FavoriteLedgerPreview>((resolve) => {
          resolveScan = resolve
        })
    )

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

    expect(screen.getByRole('status')).toHaveTextContent('正在同步整理旧藏需要的主收藏...')
    expect(onScanOldFavorites).not.toHaveBeenCalled()

    await act(async () => {
      resolveSave?.({
        ok: true,
        steps: ['api:ledger:list'],
        missingTargets: [],
        message: 'favorite ledgers saved'
      })
    })

    expect(screen.getByRole('status')).toHaveTextContent('正在扫描旧藏，请稍候。')

    await act(async () => {
      resolveScan({
        items: [],
        skippedSourceFolderTitles: []
      })
    })
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

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '整理旧藏未完成：未能读取登录凭据，无法整理旧藏。'
      )
    )
    expect(screen.queryByText('旧藏预览')).not.toBeInTheDocument()
  })

  it('syncs missing default ledgers before directly organizing old favorites', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'inbox' ? { ...ledger, bilibiliFolderId: undefined } : ledger
    )
    let resolveSave:
      | ((value: { ok: boolean; steps: string[]; missingTargets: string[]; message: string }) => void)
      | undefined
    const savePromise = new Promise<{ ok: boolean; steps: string[]; missingTargets: string[]; message: string }>(
      (resolve) => {
        resolveSave = resolve
      }
    )
    const onSaveLedgers = vi.fn().mockReturnValue(savePromise)
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 601,
          title: 'old favorite needing inbox',
          sourceFolderTitle: 'Default Favorites',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'Bilimi Inbox',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: []
    })

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={['inbox']}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__toolbar button')[1])

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    expect(onScanOldFavorites).not.toHaveBeenCalled()
    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'inbox', enabled: true, isDefault: true })
      ]),
      { deleteDisabled: false }
    )

    await act(async () => {
      resolveSave?.({
        ok: true,
        steps: ['api:ledger:list', 'api:ledger:create:inbox'],
        missingTargets: [],
        message: 'favorite ledgers saved'
      })
    })

    await waitFor(() =>
      expect(onScanOldFavorites).toHaveBeenCalledWith(
        expect.objectContaining({ multiArchiveMode: 'off' })
      )
    )
  })

  it('syncs the eight default ledgers before organizing even when none are marked missing', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger, index) => ({
      ...ledger,
      bilibiliFolderId: String(9001 + index)
    }))
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:list'],
      missingTargets: [],
      message: 'favorite ledgers saved'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [],
      skippedSourceFolderTitles: []
    })

    const { container } = render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(container.querySelectorAll('.favorite-ledger-panel__toolbar button')[1])

    await waitFor(() => expect(onSaveLedgers).toHaveBeenCalledOnce())
    await waitFor(() => expect(onScanOldFavorites).toHaveBeenCalledOnce())
    expect(onSaveLedgers.mock.invocationCallOrder[0]).toBeLessThan(
      onScanOldFavorites.mock.invocationCallOrder[0]
    )
    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining(
        createDefaultFavoriteLedgers().map((ledger) =>
          expect.objectContaining({ id: ledger.id, enabled: true, isDefault: true })
        )
      ),
      { deleteDisabled: false }
    )
  })

  it('shows old favorite insights and lets users add suggested ledgers without AI', async () => {
    const onSaveLedgers = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '掌库已同步。'
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 601,
          title: '稍后整理的旧藏一',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 602,
          title: '稍后整理的旧藏二',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      scanDiagnostics: {
        tagDetailRequests: 6,
        tagDetailFailures: 4,
        taggedVideos: 2,
        untaggedVideos: 4
      },
      insights: {
        totalVideos: 6,
        topAuthors: [{ name: '效率研究所', count: 4, share: 4 / 6 }],
        topTags: [
          { name: 'AI', count: 4 },
          { name: '工具', count: 3 }
        ],
        topCategories: [{ name: '科技', count: 4 }],
        sourceFolders: [
          { name: '默认收藏夹', count: 6 },
          { name: 'bilimi·待分类', count: 2 }
        ],
        titleSeries: [{ name: 'AI工具效率教程', count: 4 }],
        candidateLedgers: [
          {
            kind: 'tag-cluster',
            sourceName: 'AI',
            displayName: 'bilimi·AI工具',
            keywords: ['AI', '工具', '效率'],
            count: 4,
            confidence: 'high',
            reason: '高频标签“AI”出现 4 次，适合单独成册。',
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
    expect(screen.getByText('共扫描 6 条旧藏，生成 1 个候选收藏夹')).toBeInTheDocument()
    expect(screen.getByText('标签补取失败 4 条，高频标签候选可能偏少；稍后重扫会更准。')).toBeInTheDocument()
    expect(screen.getByText('待分类')).toBeInTheDocument()
    expect(screen.queryByText('高频标签候选')).not.toBeInTheDocument()
    expect(screen.queryByText('4 条适合')).not.toBeInTheDocument()
    expect(screen.queryByText('常追 UP')).not.toBeInTheDocument()
    expect(screen.queryByText('分区')).not.toBeInTheDocument()
    expect(screen.getByText('扫描收藏夹')).toBeInTheDocument()
    expect(screen.getByText('用户收藏夹')).toBeInTheDocument()
    expect(screen.getByText('bilimi 工作夹')).toBeInTheDocument()
    expect(screen.getByText('默认收藏夹 6')).toBeInTheDocument()
    expect(screen.getByText('bilimi·待分类 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getAllByText('AI工具').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText('bilimi·AI工具')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('全选 高频标签收藏夹'))
    expect(screen.getByLabelText('bilimi·AI工具')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·AI工具',
            keywords: ['AI', '工具', '效率'],
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('uses selected generated ledgers to preview old favorites instead of leaving them in inbox', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'inbox' ? { ...ledger, bilibiliFolderId: '9008' } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '光影构图入门',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:摄影',
              ledgerId: 'custom-tag-cluster-摄影',
              displayName: 'bilimi·摄影',
              keywords: ['摄影']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: '摄影', count: 1 }],
        topCategories: [{ name: '摄影', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster',
            sourceName: '摄影',
            displayName: 'bilimi·摄影',
            keywords: ['摄影'],
            count: 1,
            confidence: 'medium',
            reason: '摄影相关旧藏适合单独成册。',
          }
        ]
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    expect(screen.getByText('共扫描 1 条旧藏，生成 1 个候选收藏夹')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·摄影')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('全选 高频标签收藏夹'))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getByRole('group', { name: 'bilimi·摄影 1 条' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'bilimi·待分类 1 条' })).not.toBeInTheDocument()
  })

  it('backs up the top ledger checklist immediately from 备册', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )
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
        topAuthors: [],
        topTags: [{ name: 'AI', count: 4 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 6 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster',
            sourceName: 'AI',
            displayName: 'bilimi·AI工具',
            keywords: ['AI', '工具', '效率'],
            count: 4,
            confidence: 'high',
            reason: '高频标签“AI”出现 4 次，适合单独成册。',
          }
        ]
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={['knowledge']}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={onSaveLedgers}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    const knowledgeTopButton = within(ledgerRegion).getByRole('button', { name: '知识学习' })
    expect(await screen.findByRole('status')).toHaveTextContent(
      '小咪备册已完成，主人可以再增加自己想要的收藏夹，点击同步即可'
    )
    expect(knowledgeTopButton).toHaveAttribute('aria-pressed', 'true')
    expect(within(ledgerRegion).getByRole('button', { name: '生活日常' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(onSaveLedgers).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'knowledge', enabled: true }),
        expect.objectContaining({ id: 'life-interest', enabled: true })
      ]),
      { deleteDisabled: false }
    )

    expect(within(ledgerRegion).queryByRole('button', { name: 'AI工具' })).not.toBeInTheDocument()
  })

  it('recommends existing unchecked ledgers that match scanned old favorites', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 102,
          title: '深度学习入门路线',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [{ name: '学习', count: 2 }],
        topCategories: [{ name: '知识', count: 2 }],
        sourceFolders: [{ name: '默认收藏夹', count: 2 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={['knowledge']}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    const knowledgeTopButton = within(ledgerRegion).getByRole('button', { name: '知识学习' })
    expect(knowledgeTopButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('bilimi·知识学习')).not.toBeInTheDocument()

    fireEvent.click(within(ledgerRegion).getByLabelText('移出同步 bilimi·知识学习'))

    expect(knowledgeTopButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows preset Bilimi ledgers as selectable recommendations while organizing old favorites', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'life-interest' ? { ...ledger, enabled: false } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '东京旅行攻略',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'life-interest',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·生活日常',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const ledgerRegion = screen.getByRole('region', { name: '收藏夹' })
    const travelTopButton = within(ledgerRegion).getByRole('button', { name: '生活日常' })
    expect(travelTopButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('bilimi·生活日常')).not.toBeInTheDocument()

    fireEvent.click(within(ledgerRegion).getByLabelText('移出同步 bilimi·生活日常'))

    expect(travelTopButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows matching old favorite counts for already checked preset ledgers', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '动画分镜教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        },
        {
          aid: 102,
          title: '番剧演出解析',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [],
        topCategories: [{ name: '动画', count: 2 }],
        sourceFolders: [{ name: '默认收藏夹', count: 2 }],
        titleSeries: [],
        candidateLedgers: []
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
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByLabelText('bilimi·影视动漫')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('group', { name: 'bilimi·影视动漫 2 条' })).toBeInTheDocument()
  })

  it('hides suggested category ledgers from generated recommendations', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge' || ledger.id === 'movie-tv') {
        return { ...ledger, enabled: false }
      }
      if (ledger.id === 'game') {
        return { ...ledger, enabled: false, bilibiliFolderId: '9001' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '机器学习入门',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 102,
          title: '影视剪辑教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 103,
          title: '游戏攻略',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·游戏专区',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 3,
        topAuthors: [],
        topTags: [],
        topCategories: [
          { name: '知识', count: 1 },
          { name: '影视', count: 1 },
          { name: '游戏', count: 1 }
        ],
        sourceFolders: [{ name: '默认收藏夹', count: 3 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByRole('table', { name: '推荐分区收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·知识学习')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·影视动漫')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·游戏专区')).not.toBeInTheDocument()
  })

  it('does not show inbox as a generated recommendation or content to split further', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '机器学习入门',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false
        },
        {
          aid: 102,
          title: '暂时无法判断的旧藏',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [],
        topCategories: [{ name: '知识', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 2 }],
        titleSeries: [],
        candidateLedgers: []
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByRole('table', { name: '推荐分区收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·待分类')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '待拆解内容' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '智能补判待分类' })).not.toBeInTheDocument()
  })

  it('does not show preset ledgers as generated recommendations', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '动画分镜教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [],
        topCategories: [{ name: '动画', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: []
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
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByLabelText('bilimi·影视动漫')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('bilimi·生活日常')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示其他收藏夹' })).not.toBeInTheDocument()
  })

  it('recommends high-frequency tag folders while preserving other matched targets in preview', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'life-interest') {
        return { ...ledger, enabled: false }
      }
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '篮球训练教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'life-interest',
          targetFolderId: '',
          targetDisplayName: 'bilimi·生活日常',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'life-interest',
              folderId: '',
              displayName: 'bilimi·生活日常',
              keywords: ['体育', '篮球'],
              alreadyInTarget: false,
              selected: true
            },
            {
              ledgerId: 'custom-tag-cluster-原神',
              folderId: '',
              displayName: 'bilimi·原神',
              keywords: ['原神'],
              alreadyInTarget: false,
              selected: true,
              selectedCandidateTarget: true,
              candidateKey: 'tag-cluster:原神'
            }
          ],
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:原神',
              ledgerId: 'custom-tag-cluster-原神',
              displayName: 'bilimi·原神',
              keywords: ['原神']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [{ name: '篮球教练', count: 1, share: 1 }],
        topTags: [{ name: '原神', count: 1 }],
        topCategories: [{ name: '体育', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: '原神',
            displayName: 'bilimi·原神',
            keywords: ['原神'],
            count: 1,
            confidence: 'medium' as const,
            reason: '高频标签“原神”出现 1 次，适合单独成册。',
          }
        ]
      }
    })

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn()}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const candidates = screen.getByRole('region', { name: '专属收藏夹候选' })
    expect(within(candidates).getByText('高频标签收藏夹')).toBeInTheDocument()
    expect(within(candidates).getByLabelText('bilimi·原神')).not.toBeChecked()
    expect(within(candidates).queryByLabelText('bilimi·生活日常')).not.toBeInTheDocument()
    expect(within(candidates).queryByLabelText('bilimi·时尚美妆')).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '推荐分区收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '待拆解内容' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示其他收藏夹' })).not.toBeInTheDocument()
    expect(within(candidates).getByLabelText('bilimi·原神').closest('article')).toHaveTextContent('1 条适合')
    fireEvent.click(within(candidates).getByLabelText('全选 高频标签收藏夹'))
    expect(within(candidates).getByLabelText('bilimi·原神')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('group', { name: 'bilimi·生活日常 1 条' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·原神 1 条' })).toBeInTheDocument()
  })

  it('sorts tag recommendations by matched count, leaves them unchecked, and expands to twenty-four', async () => {
    const tagNames = Array.from({ length: 24 }, (_, index) => `标签${index + 1}`)
    const tagCount = (tagName: string) => {
      if (tagName === '标签8') {
        return 40
      }
      if (tagName === '标签3') {
        return 30
      }
      if (tagName === '标签1') {
        return 20
      }
      return 2
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: tagNames.flatMap((tagName, index) =>
        Array.from({ length: tagCount(tagName) }, (_, countIndex) => ({
          aid: 300000 + index * 100 + countIndex,
          title: `${tagName} 视频 ${countIndex + 1}`,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          candidateTargets: [
            {
              candidateKey: `tag-cluster:${tagName}`,
              ledgerId: `custom-tag-cluster-${tagName}`,
              displayName: `bilimi·${tagName}`,
              keywords: [tagName]
            }
          ]
        }))
      ),
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: tagNames.reduce((total, tagName) => total + tagCount(tagName), 0),
        topAuthors: [],
        topTags: tagNames.map((tagName) => ({ name: tagName, count: tagCount(tagName) })),
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 134 }],
        titleSeries: [],
        candidateLedgers: tagNames.map((tagName) => ({
          kind: 'tag-cluster' as const,
          sourceName: tagName,
          displayName: `bilimi·${tagName}`,
          keywords: [tagName],
          count: 2,
          confidence: 'medium' as const,
          reason: `高频标签“${tagName}”出现 ${tagCount(tagName)} 次，适合单独成册。`,
        }))
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
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const candidates = screen.getByRole('region', { name: '专属收藏夹候选' })
    expect(within(candidates).getByLabelText('bilimi·标签1')).not.toBeChecked()
    const visibleCandidateNames = within(candidates)
      .getAllByRole('checkbox', { name: /^bilimi·标签/ })
      .map((checkbox) => checkbox.getAttribute('aria-label'))
    expect(visibleCandidateNames.slice(0, 3)).toEqual(['bilimi·标签8', 'bilimi·标签3', 'bilimi·标签1'])
    expect(within(candidates).getByLabelText('bilimi·标签12')).toBeInTheDocument()
    expect(within(candidates).queryByLabelText('bilimi·标签13')).not.toBeInTheDocument()
    expect(within(candidates).getByLabelText('全选 高频标签收藏夹')).not.toBeChecked()
    fireEvent.click(within(candidates).getByLabelText('全选 高频标签收藏夹'))
    expect(within(candidates).getByLabelText('全选 高频标签收藏夹')).toBeChecked()
    expect(within(candidates).getByLabelText('bilimi·标签8')).toBeChecked()
    expect(within(candidates).getByLabelText('bilimi·标签12')).toBeChecked()

    fireEvent.click(within(candidates).getByRole('button', { name: '展开更多高频标签' }))

    expect(within(candidates).getByLabelText('bilimi·标签24')).toBeInTheDocument()
    expect(within(candidates).getByLabelText('bilimi·标签24')).toBeChecked()
    expect(within(candidates).getAllByText(/条适合/)).toHaveLength(24)
  })

  it('keeps the old favorite guide instead of rescanning when the ledger panel is reopened', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 101,
          title: '动画分镜教程',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'movie-tv',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·影视动漫',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: '动画', count: 1 }],
        topCategories: [{ name: '动画', count: 1 }],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: []
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
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')

    fireEvent.click(screen.getByRole('button', { name: '折叠' }))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(onScanOldFavorites).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('group', { name: 'bilimi·影视动漫 1 条' })).toBeInTheDocument()
  })

  it('does not offer DeepSeek old favorite assistance from the scan overview', async () => {
    const plainPreview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 101,
          title: 'AI 效率工具实战',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·待分类',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 1,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 1 }],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 1 }],
        titleSeries: [],
        candidateLedgers: []
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValueOnce(plainPreview)

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

    await screen.findByRole('region', { name: '整理旧藏向导' })
    expect(onScanOldFavorites).toHaveBeenCalledWith(
      expect.not.objectContaining({ enhanceWithDeepSeek: expect.anything() })
    )
    expect(screen.queryByRole('button', { name: '智能补判旧藏' })).not.toBeInTheDocument()
    expect(screen.queryByText(/DeepSeek/)).not.toBeInTheDocument()
  })

  it('recommends using Bilibili tags as ledger keywords', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '影视动漫' }))

    expect(
      screen.getByText('建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。')
    ).toBeInTheDocument()
  })
})
