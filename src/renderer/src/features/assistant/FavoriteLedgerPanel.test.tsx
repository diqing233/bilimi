import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { DEEPSEEK_CONSTRAINT_MARKER } from '@shared/favoriteLedgerConstraints'
import type { DeepSeekGenerateResult, FavoriteLedger } from '@shared/types'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FavoriteLedgerPreview } from '../favorites/favoriteLedgerPreview'
import { FavoriteLedgerPanel, resetOldFavoriteRuntimeSession } from './FavoriteLedgerPanel'
import { bindOldFavoriteRuntimeAccount } from './oldFavoriteRuntimeSession'

describe('FavoriteLedgerPanel', () => {
  beforeEach(() => {
    resetOldFavoriteRuntimeSession()
  })

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

  function getPreviewVideoButton(container: HTMLElement, name: RegExp) {
    const previewVideo = Array.from(
      container.querySelectorAll<HTMLElement>('.favorite-ledger-panel__preview-video')
    ).find((candidate) => name.test(candidate.textContent ?? ''))
    expect(previewVideo).toBeDefined()
    return previewVideo!
  }

  function getPreviewArticle(container: HTMLElement, name: RegExp) {
    const article = getPreviewVideoButton(container, name).closest('article')
    expect(article).toBeDefined()
    return article!
  }

  function getPreviewTargetToggle(container: HTMLElement, name: RegExp) {
    return getPreviewVideoButton(container, name)
  }

  function createArchivePreviewFixture(): FavoriteLedgerPreview {
    return {
      items: [
        {
          aid: 701,
          title: 'AI 效率工具实战',
          author: '效率研究所',
          description: 'AI 工具流拆解。',
          tags: ['AI', '效率'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        },
        {
          aid: 702,
          title: '暂时不知道放哪',
          author: '杂谈UP',
          description: '需要人工补判。',
          tags: ['杂谈'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          originalSuggestedLedgerIds: [],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: true
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [{ name: '默认收藏夹', count: 2 }],
        titleSeries: [],
        candidateLedgers: []
      }
    }
  }

  async function openArchivePreview(overrides: Partial<Parameters<typeof FavoriteLedgerPanel>[0]> = {}) {
    const preview = createArchivePreviewFixture()
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const renderResult = renderPanel({
      onScanOldFavorites,
      ...overrides
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    return { ...renderResult, onScanOldFavorites, preview }
  }

  function selectDeepSeekArchiveScope(label: string) {
    fireEvent.click(screen.getByRole('button', { name: '整理范围' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: label }))
  }

  function confirmOldFavoriteExecution() {
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认开始整理？' })
    expect(dialog).toHaveTextContent('小咪提醒：主人要开始整理吗？开始后就不能再调整了哦！')
    fireEvent.click(within(dialog).getByRole('button', { name: '开始整理' }))
  }

  it('uses a compact archive selector without visible helper labels', async () => {
    const { container } = await openArchivePreview()

    expect(screen.getByText('增删收藏夹或修改标签后，回到归档预览会自动更新')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^存入 / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^再次整理 / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^恢复原建议 / })).not.toBeInTheDocument()
    expect(
      within(getPreviewArticle(container, /AI 效率工具实战/)).getByLabelText('调整分类 AI 效率工具实战')
    ).toBeInTheDocument()
    expect(
      within(getPreviewArticle(container, /暂时不知道放哪/)).getByLabelText('调整分类 暂时不知道放哪')
    ).toBeInTheDocument()
    expect(
      within(getPreviewArticle(container, /AI 效率工具实战/)).getByLabelText('调整分类 AI 效率工具实战')
    ).toHaveAttribute('title', '当前位置：bilimi·知识学习，可手动切换')
    expect(
      within(getPreviewArticle(container, /暂时不知道放哪/)).getByLabelText('调整分类 暂时不知道放哪')
    ).toHaveAttribute('title', '当前位置：未分类，可手动切换到 bilimi 收藏夹')
    expect(screen.queryByText('当前位置')).not.toBeInTheDocument()
    expect(screen.queryByText('当前建议分类')).not.toBeInTheDocument()
  })

  it('renders old favorite step notes as compact text directly under their headings', async () => {
    await openArchivePreview()

    const previewHeading = screen.getByRole('heading', { name: '归档预览' })
    const previewNote = screen.getByText('增删收藏夹或修改标签后，回到归档预览会自动更新')
    expect(previewHeading).toHaveClass('favorite-ledger-panel__step-title')
    expect(previewNote).toHaveClass('favorite-ledger-panel__step-note')
    expect(previewHeading.compareDocumentPosition(previewNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))

    const generatedHeading = screen.getByRole('heading', { name: '推荐收藏夹' })
    const generatedNote = screen.getByText('确认执行后，会把已勾选候选同步到 B 站收藏夹里。')
    expect(generatedHeading).toHaveClass('favorite-ledger-panel__step-title')
    expect(generatedNote).toHaveClass('favorite-ledger-panel__step-note')
    expect(generatedHeading.compareDocumentPosition(generatedNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('requires a second confirmation before executing old favorite organization', async () => {
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:701'],
      missingTargets: [],
      message: '旧藏整理已完成。'
    })
    await openArchivePreview({ onExecuteOldFavoritePlan })

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
    expect(screen.getByText('开始整理后，本轮将按当前预览追加到 bilimi 收藏夹，执行中不能再更改。原收藏不会被删除、移动或取消。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认开始整理？' })
    expect(dialog).toHaveTextContent('小咪提醒：主人要开始整理吗？开始后就不能再调整了哦！')
    expect(dialog).toHaveTextContent('本次将整理 1 条视频，每条视频最多存入 1 个 Bilimi 收藏夹。')
    expect(dialog).not.toHaveTextContent('收藏夹数量设置已从')
    expect(screen.queryByRole('heading', { name: '确认执行' })).not.toBeInTheDocument()
    expect(screen.queryByText('已选择 1 条归档任务')).not.toBeInTheDocument()
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: '返回检查' }))
    expect(screen.queryByRole('alertdialog', { name: '确认开始整理？' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '确认执行' })).toBeInTheDocument()
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
  })

  it('keeps the current-location switch outside the selectable preview card body', async () => {
    const { container } = await openArchivePreview()

    const article = getPreviewArticle(container, /AI 效率工具实战/)
    const cardBody = article.querySelector('.favorite-ledger-panel__preview-video')
    const controls = article.querySelector('.favorite-ledger-panel__preview-controls')

    expect(cardBody).toBeInTheDocument()
    expect(controls).toBeInTheDocument()
    expect(cardBody).not.toContainElement(controls as HTMLElement)
  })

  it('shows unrecognized tag text when an old favorite has no tags', async () => {
    const preview = createArchivePreviewFixture()
    preview.items[0] = {
      ...preview.items[0],
      tags: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)

    const { container } = await openArchivePreview({ onScanOldFavorites })

    expect(within(getPreviewArticle(container, /AI 效率工具实战/)).getByText('标签：未识别到')).toBeInTheDocument()
  })

  it('keeps DeepSeek controls and archive change history in one combined tool card', async () => {
    await openArchivePreview()

    const toolCard = screen.getByRole('group', { name: '归档预览辅助工具' })
    expect(toolCard.querySelector('.favorite-ledger-panel__archive-tool-divider')).toBeInTheDocument()
    expect(toolCard.querySelector('.favorite-ledger-panel__deepseek-archive-card')).not.toBeInTheDocument()
    expect(toolCard.querySelector('.favorite-ledger-panel__archive-history-card')).not.toBeInTheDocument()

    const historyTools = within(toolCard).getByRole('group', { name: '归档预览改动操作' })
    const historySelect = within(historyTools).getByRole('combobox', { name: '改动记录' })
    const undoButton = within(historyTools).getByRole('button', { name: '撤销本次改动' })
    const redoButton = within(historyTools).getByRole('button', { name: '恢复本次改动' })

    expect(historySelect.parentElement).toHaveClass(
      'favorite-ledger-panel__archive-history-select-control'
    )
    expect(historySelect.compareDocumentPosition(undoButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(undoButton.compareDocumentPosition(redoButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses a compact scope dropdown button before the DeepSeek organize button', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [],
      keywordSuggestions: []
    } satisfies DeepSeekGenerateResult)
    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    expect(screen.queryByRole('combobox', { name: 'DeepSeek 辅助整理范围' })).not.toBeInTheDocument()

    const toolCard = screen.getByRole('group', { name: '归档预览辅助工具' })
    const scopeButton = within(toolCard).getByRole('button', { name: '整理范围' })
    const deepSeekButton = within(toolCard).getByRole('button', { name: 'DeepSeek 整理' })
    const scopeArrow = scopeButton.querySelector('.favorite-ledger-panel__deepseek-archive-scope-arrow')
    expect(scopeButton).toHaveAttribute('title', '当前选择：不太稳 + 未匹配到合适分类')
    expect(scopeArrow).toBeInTheDocument()
    expect(scopeArrow).toHaveAttribute('aria-hidden', 'true')
    expect(scopeButton.compareDocumentPosition(deepSeekButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(scopeButton)
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'DeepSeek 进行二次整理' }))
    expect(scopeButton).toHaveAttribute('title', '当前选择：DeepSeek 进行二次整理')

    fireEvent.click(deepSeekButton)
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledWith('all', expect.anything()))
  })

  it('uses compact stacked-arrow help toggles without text glyphs', async () => {
    await openArchivePreview()

    const ledgerHelpButton = screen.getByRole('button', { name: '展开收藏夹说明' })
    const oldFavoriteHelpButton = screen.getByRole('button', { name: '展开整理旧藏说明' })

    for (const helpButton of [ledgerHelpButton, oldFavoriteHelpButton]) {
      expect(helpButton).not.toHaveTextContent(/[\^v]/)
      expect(helpButton.querySelectorAll('.favorite-ledger-panel__help-arrow')).toHaveLength(2)
    }

    expect(ledgerHelpButton.getAttribute('title')?.split('\n')).toHaveLength(3)
    expect(oldFavoriteHelpButton.getAttribute('title')?.split('\n')).toHaveLength(5)
  })

  it('keeps the first-use backup note out of the ledger panel body', () => {
    renderPanel()

    expect(screen.queryByText(safetyNote)).not.toBeInTheDocument()
  })

  it('lets the change-history dropdown jump to the latest changed archive card', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const { container } = await openArchivePreview()
      fireEvent.change(screen.getByLabelText('调整分类 AI 效率工具实战'), {
        target: { value: 'game' }
      })

      const historySelect = screen.getByRole('combobox', { name: '改动记录' })
      expect(within(historySelect).getByRole('option', { name: /最近一次改动：AI 效率工具实战/ })).toBeInTheDocument()
      expect(within(historySelect).queryByRole('option', { name: '选择改动记录' })).not.toBeInTheDocument()

      fireEvent.change(historySelect, {
        target: { value: 'latest' }
      })

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
      expect(getPreviewArticle(container, /AI 效率工具实战/)).toHaveAttribute('data-latest-change', 'true')
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('focuses the destination archive group and resets affected horizontal preview tracks after a manual move', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const preview = createArchivePreviewFixture()
      preview.items.push(
        {
          aid: 703,
          title: '知识区保底视频',
          author: '知识UP',
          description: '保留源分组。',
          tags: ['知识'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·知识学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        },
        {
          aid: 704,
          title: '游戏区保底视频',
          author: '游戏UP',
          description: '保留目标分组。',
          tags: ['游戏'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏专区',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['game'],
          currentTargetLedgerIds: ['game'],
          selectedTargetLedgerIds: ['game'],
          lowConfidence: false
        }
      )
      const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
      const { container } = renderPanel({ onScanOldFavorites })

      fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
      await screen.findByRole('region', { name: '整理旧藏向导' })
      fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

      const knowledgeGroup = getPreviewArticle(container, /AI 效率工具实战/).closest('section')
      const gameGroup = getPreviewArticle(container, /游戏区保底视频/).closest('section')
      expect(knowledgeGroup).not.toBeNull()
      expect(gameGroup).not.toBeNull()
      const knowledgeSection = knowledgeGroup!
      const gameSection = gameGroup!
      const knowledgeTrack = knowledgeSection.querySelector<HTMLElement>(
        '.favorite-ledger-panel__preview-videos'
      )
      const gameTrack = gameSection.querySelector<HTMLElement>('.favorite-ledger-panel__preview-videos')
      expect(knowledgeTrack).toBeDefined()
      expect(gameTrack).toBeDefined()
      knowledgeTrack!.scrollLeft = 128
      gameTrack!.scrollLeft = 96

      fireEvent.change(within(knowledgeSection).getByLabelText('调整分类 AI 效率工具实战'), {
        target: { value: 'game' }
      })

      await waitFor(() =>
        expect(getPreviewArticle(container, /AI 效率工具实战/).closest('section')).toHaveTextContent(
          '游戏区保底视频'
        )
      )
      const updatedKnowledgeGroup = getPreviewArticle(container, /知识区保底视频/).closest('section')
      const updatedGameGroup = getPreviewArticle(container, /AI 效率工具实战/).closest('section')
      expect(updatedKnowledgeGroup).not.toBeNull()
      expect(updatedGameGroup).not.toBeNull()
      const updatedKnowledgeSection = updatedKnowledgeGroup!
      const updatedGameSection = updatedGameGroup!
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
      expect(updatedKnowledgeSection.querySelector('.favorite-ledger-panel__preview-videos')).toHaveProperty(
        'scrollLeft',
        0
      )
      expect(updatedGameSection.querySelector('.favorite-ledger-panel__preview-videos')).toHaveProperty(
        'scrollLeft',
        0
      )
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('shows original archive source notices for every manually moved card', async () => {
    const { container } = await openArchivePreview()

    fireEvent.change(screen.getByLabelText('调整分类 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    fireEvent.change(screen.getByLabelText('调整分类 暂时不知道放哪'), {
      target: { value: 'inbox' }
    })

    const knowledgeArticle = getPreviewArticle(container, /AI 效率工具实战/)
    const unclassifiedArticle = getPreviewArticle(container, /暂时不知道放哪/)
    expect(container.querySelectorAll('.favorite-ledger-panel__preview-delta-row')).toHaveLength(2)
    expect(within(knowledgeArticle).getByText('来自 bilimi·知识学习')).toHaveClass(
      'favorite-ledger-panel__preview-delta'
    )
    expect(within(unclassifiedArticle).getByText('来自 未分类')).toHaveClass(
      'favorite-ledger-panel__preview-delta'
    )
    expect(within(unclassifiedArticle).getByText('来自 未分类')).toHaveAttribute(
      'title',
      '整理前位置：【未分类】；当前位置：【bilimi·暂存】。'
    )
    expect(within(unclassifiedArticle).queryByRole('button', { name: '撤销' })).not.toBeInTheDocument()
    expect(getPreviewArticle(container, /AI 效率工具实战/)).not.toHaveAttribute(
      'data-latest-change',
      'true'
    )
  })

  it('keeps the round-start source after the same card moves repeatedly and clears it at origin', async () => {
    const { container } = await openArchivePreview()

    fireEvent.change(screen.getByLabelText('调整分类 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    fireEvent.change(screen.getByLabelText('调整分类 AI 效率工具实战'), {
      target: { value: 'movie-tv' }
    })

    const movedArticle = getPreviewArticle(container, /AI 效率工具实战/)
    expect(within(movedArticle).getByText('来自 bilimi·知识学习')).toHaveAttribute(
      'title',
      '整理前位置：【bilimi·知识学习】；当前位置：【bilimi·影视动漫】。'
    )

    fireEvent.change(screen.getByLabelText('调整分类 AI 效率工具实战'), {
      target: { value: 'knowledge' }
    })

    expect(
      within(getPreviewArticle(container, /AI 效率工具实战/)).queryByText(
        '来自 bilimi·知识学习'
      )
    ).not.toBeInTheDocument()
  })

  it('reports old favorite scan results to the global feedback owner while keeping the local message', async () => {
    const onOldFavoriteStatusUpdate = vi.fn()

    await openArchivePreview({ onOldFavoriteStatusUpdate })

    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith({
      label: '旧藏待整理 2',
      message: '已扫描 2 条旧藏，可勾选后整理。',
      tone: 'warn'
    })
    expect(screen.getByText('已扫描 2 条旧藏，可勾选后整理。')).toBeInTheDocument()
  })

  it('shows protected counts and temporarily reintroduces only selected-source favorites', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 4,
      activeSourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: preview.items.map((item) => ({
            aid: item.aid,
            title: item.title,
            description: item.description,
            tags: item.tags,
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹'],
            currentBilimiFolderIds: []
          }))
        }
      ],
      protectedVideos: [
        {
          aid: 801,
          title: '默认来源已整理',
          tags: ['游戏'],
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: ['9002'],
          protectedForIncrementalScan: true
        },
        {
          aid: 802,
          title: '旅行来源已整理',
          tags: ['旅行'],
          sourceFolderIds: ['source-2'],
          sourceFolderTitles: ['旅行收藏'],
          currentBilimiFolderIds: ['9005'],
          protectedForIncrementalScan: true
        }
      ],
      managedFolders: [
        { id: '9002', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false },
        { id: '9005', title: 'bilimi·生活日常', ledgerId: 'life-interest', isInbox: false }
      ],
      targetMembership: { '9002': [801], '9005': [802] },
      multiArchiveMode: 'off'
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(
      screen.getByText('共扫描 4 条旧藏，其中 2 条进入本轮整理，2 条之前已整理，本轮保持原归档。')
    ).toBeInTheDocument()
    expect(screen.getByText('已整理跳过')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('整理来源 旅行收藏'))
    const basicDataHeading = screen.getByRole('heading', { name: '基础数据' })
    const allReorganizeButton = screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' })
    const metrics = screen.getByText('共扫描').closest('.favorite-ledger-panel__guide-metrics')
    expect(screen.getByText(/当前勾选来源中的全部已整理视频/)).toBeInTheDocument()
    expect(screen.queryByLabelText('原归档状态')).not.toBeInTheDocument()
    expect(basicDataHeading.compareDocumentPosition(allReorganizeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(allReorganizeButton.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('默认来源已整理')).not.toBeInTheDocument()

    fireEvent.click(allReorganizeButton)
    const dialog = screen.getByRole('alertdialog', { name: '确认重新整理已整理收藏？' })
    expect(dialog).toHaveTextContent('当前勾选来源中全部已整理的 1 条')
    expect(dialog).toHaveTextContent('按当前规则重新计算，不受以前分类限制')
    expect(dialog).toHaveTextContent('用户原有普通收藏不会改变')
    expect(allReorganizeButton.closest('.favorite-ledger-panel__protected-summary')).toContainElement(dialog)
    expect(allReorganizeButton.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '继续重新整理' }))

    expect(screen.getByText('已重新纳入 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复保护' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getAllByText('默认来源已整理').length).toBeGreaterThan(0)
    expect(screen.queryByText('旅行来源已整理')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复保护' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.queryByText('默认来源已整理')).not.toBeInTheDocument()
  })

  it('restores protected reorganization progress after remount', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 3,
      activeSourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: preview.items.map((item) => ({
            aid: item.aid,
            title: item.title,
            description: item.description,
            tags: item.tags,
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹'],
            currentBilimiFolderIds: []
          }))
        }
      ],
      protectedVideos: [
        {
          aid: 801,
          title: '需要恢复进度的已整理视频',
          tags: ['游戏'],
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: ['9002'],
          protectedForIncrementalScan: true
        }
      ],
      managedFolders: [
        { id: '9002', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false }
      ],
      targetMembership: { '9002': [801] },
      multiArchiveMode: 'off'
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const first = renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '确认重新整理已整理收藏？' })).getByRole(
        'button',
        { name: '继续重新整理' }
      )
    )
    expect(screen.getByText('已重新纳入 1')).toBeInTheDocument()

    first.unmount()
    renderPanel({ onScanOldFavorites })

    expect(screen.getByText('已重新纳入 1')).toBeInTheDocument()
  })

  it('restores edited draft ledger keywords after remount', async () => {
    const onScanOldFavorites = vi.fn().mockResolvedValue(createArchivePreviewFixture())
    const first = renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))
    let editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('关键词'), {
      target: { value: '热更新保留词' }
    })

    first.unmount()
    renderPanel({ onScanOldFavorites })
    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))
    editor = within(screen.getByRole('region', { name: '当前收藏夹' }))

    expect(editor.getByLabelText('关键词')).toHaveValue('热更新保留词')
  })

  it('reports archive health and reintroduces only abnormal protected favorites', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 5,
      activeSourceFolders: [],
      protectedVideos: [
        {
          aid: 801,
          title: '归档完整',
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: ['9001'],
          protectedForIncrementalScan: true,
          archiveHealth: 'complete'
        },
        {
          aid: 802,
          title: '归档不完整',
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: ['9001'],
          protectedForIncrementalScan: true,
          archiveHealth: 'incomplete'
        },
        {
          aid: 803,
          title: '归档已失效',
          sourceFolderIds: ['source-1'],
          sourceFolderTitles: ['默认收藏夹'],
          currentBilimiFolderIds: [],
          protectedForIncrementalScan: true,
          archiveHealth: 'invalid'
        }
      ],
      managedFolders: [
        { id: '9001', title: 'bilimi·知识学习', ledgerId: 'knowledge', isInbox: false }
      ],
      targetMembership: { '9001': [801, 802] },
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByText('仍在原归档').closest('article')).toHaveTextContent('1')
    expect(screen.getByText('仅保留部分归档').closest('article')).toHaveTextContent('1')
    expect(screen.getByText('已不在原归档').closest('article')).toHaveTextContent('1')
    expect(screen.getByText(/原归档状态发生变化/)).toBeInTheDocument()
    expect(screen.queryByText(/仍在原归档表示视频仍位于全部原归档收藏夹/)).not.toBeInTheDocument()
    expect(screen.queryByText(/仅保留部分归档表示只剩部分位置/)).not.toBeInTheDocument()
    const changedStatusButton = screen.getByRole('button', { name: '重新整理状态有变化的 2 条' })
    expect(changedStatusButton).toHaveAttribute(
      'title',
      '原归档是上次整理时记录的视频所在收藏夹。状态变化表示视频已不完全在原位置中；为避免覆盖你的手动调整，本轮先跳过，点击后重新纳入整理。'
    )
    expect(screen.getByRole('button', { name: '重新整理全部已整理视频 3 条' })).toBeInTheDocument()

    fireEvent.click(changedStatusButton)
    const dialog = screen.getByRole('alertdialog', { name: '确认重新整理状态有变化的视频？' })
    const archiveHealthMetrics = screen.getByLabelText('原归档状态')
    expect(changedStatusButton.closest('.favorite-ledger-panel__protected-summary')).toContainElement(dialog)
    expect(changedStatusButton.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dialog.compareDocumentPosition(archiveHealthMetrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dialog).toHaveTextContent('2 条')
    expect(dialog).toHaveTextContent('当前勾选来源')
    expect(dialog).toHaveTextContent('用户原有普通收藏不会改变')
    fireEvent.click(within(dialog).getByRole('button', { name: '继续重新整理' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getAllByText('归档不完整').length).toBeGreaterThan(0)
    expect(screen.getAllByText('归档已失效').length).toBeGreaterThan(0)
    expect(screen.queryByText('归档完整')).not.toBeInTheDocument()
  })

  it('keeps all and changed-status reorganization actions visible when their counts match', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 3,
      activeSourceFolders: [],
      protectedVideos: [801, 802, 803].map((aid) => ({
        aid,
        title: `状态变化 ${aid}`,
        sourceFolderIds: ['source-1'],
        sourceFolderTitles: ['默认收藏夹'],
        currentBilimiFolderIds: [],
        protectedForIncrementalScan: true,
        archiveHealth: 'invalid' as const
      })),
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    renderPanel({ onScanOldFavorites: vi.fn().mockResolvedValue(preview) })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    expect(screen.getByRole('button', { name: '重新整理全部已整理视频 3 条' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新整理状态有变化的 3 条' })).toBeInTheDocument()
  })

  it('executes a protected multi-target reorganization as one reconciled video plan', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') return { ...ledger, bilibiliFolderId: '9001' }
      if (ledger.id === 'game') return { ...ledger, bilibiliFolderId: '9002' }
      return ledger
    })
    const preview: FavoriteLedgerPreview = {
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 0,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [],
        titleSeries: [],
        candidateLedgers: []
      },
      scanContext: {
        accountMid: '42',
        totalUniqueVideos: 1,
        activeSourceFolders: [],
        protectedVideos: [
          {
            aid: 801,
            title: '需要双目标重新整理',
            tags: ['知识', '游戏'],
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹'],
            currentBilimiFolderIds: ['9001'],
            protectedForIncrementalScan: true
          }
        ],
        managedFolders: [
          { id: '9001', title: 'bilimi·知识学习', ledgerId: 'knowledge', isInbox: false },
          { id: '9002', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false }
        ],
        targetMembership: { '9001': [801], '9002': [] },
        multiArchiveMode: 'two'
      }
    }
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      completedItems: [],
      message: 'done'
    })
    renderPanel({
      ledgers,
      favoriteArchiveMultiMode: 'two',
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' }))
    fireEvent.click(screen.getByRole('button', { name: '继续重新整理' }))
    await screen.findByText('已重新纳入 1')
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    const item = (await screen.findByText('需要双目标重新整理')).closest('article')!
    fireEvent.change(within(item).getByLabelText('调整分类 需要双目标重新整理'), {
      target: { value: 'game' }
    })
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([
      expect.objectContaining({
        aid: 801,
        reorganizeProtected: true,
        currentBilimiFolderIds: ['9001'],
        desiredTargetFolderIds: expect.arrayContaining(['9001', '9002'])
      })
    ])
  })

  it('records complete protected reorganization results without showing reconciliation details in cards', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') return { ...ledger, bilibiliFolderId: '9001' }
      if (ledger.id === 'game') return { ...ledger, bilibiliFolderId: '9002' }
      return ledger
    })
    const preview: FavoriteLedgerPreview = {
      items: [],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 0,
        topAuthors: [],
        topTags: [],
        topCategories: [],
        sourceFolders: [],
        titleSeries: [],
        candidateLedgers: []
      },
      scanContext: {
        accountMid: '42',
        totalUniqueVideos: 1,
        activeSourceFolders: [],
        protectedVideos: [
          {
            aid: 801,
            title: '需要迁移归档',
            tags: ['游戏'],
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹'],
            currentBilimiFolderIds: ['9001'],
            protectedForIncrementalScan: true
          }
        ],
        managedFolders: [
          { id: '9001', title: 'bilimi·知识学习', ledgerId: 'knowledge', isInbox: false },
          { id: '9002', title: 'bilimi·游戏专区', ledgerId: 'game', isInbox: false }
        ],
        targetMembership: { '9001': [801], '9002': [] },
        multiArchiveMode: 'off'
      }
    }
    const onExecuteOldFavoritePlan = vi.fn().mockImplementation(async ([item]) => ({
      ok: true,
      steps: [],
      missingTargets: [],
      completedItems: [{ ...item, finalFolderIds: ['9002'], addedFolderIds: ['9002'], removedFolderIds: ['9001'] }],
      message: 'done'
    }))
    const onConfirmArchiveProtections = vi.fn()
    renderPanel({
      ledgers,
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onConfirmArchiveProtections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '重新整理全部已整理视频 1 条' }))
    fireEvent.click(screen.getByRole('button', { name: '继续重新整理' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const item = (await screen.findByText('需要迁移归档')).closest('article')!
    expect(within(item).queryByText('将加入：bilimi·游戏专区')).not.toBeInTheDocument()
    expect(within(item).queryByText('将移出：bilimi·知识学习')).not.toBeInTheDocument()
    expect(within(item).queryByText('普通收藏：保持不变')).not.toBeInTheDocument()
    expect(within(item).queryByText('保持当前 Bilimi 归档')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('重新整理 1 条：1 条将加入，1 条将移出，0 条保持当前 Bilimi 归档。')).toBeInTheDocument()
    expect(screen.getByText('普通收藏保持不变。')).toBeInTheDocument()
    confirmOldFavoriteExecution()

    await waitFor(() =>
      expect(onConfirmArchiveProtections).toHaveBeenCalledWith([
        expect.objectContaining({
          accountMid: '42',
          aid: 801,
          targetLedgerIds: ['game'],
          targetFolderIds: ['9002'],
          completedAt: expect.any(String)
        })
      ])
    )
  })

  it('reports partial old favorite results separately from complete failures', async () => {
    const preview = createArchivePreviewFixture()
    preview.items = [
      preview.items[0],
      {
        ...preview.items[0],
        aid: 703,
        title: '完全失败的视频'
      }
    ]
    const onExecuteOldFavoritePlan = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, partial: true, steps: [], missingTargets: [], completedItems: [], message: 'partial' })
      .mockResolvedValueOnce({ ok: false, steps: [], missingTargets: [], completedItems: [], message: 'failed' })
    const onOldFavoriteStatusUpdate = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onOldFavoriteStatusUpdate
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(screen.getByText('本次整理已结束，0 条成功，1 条部分完成，1 条失败。')).toBeInTheDocument()
    expect(onOldFavoriteStatusUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: '整理未完全成功', tone: 'error' })
    )
  })

  it('uses a warning status when some videos were not processed but no partial operation occurred', async () => {
    const preview = createArchivePreviewFixture()
    preview.items = [preview.items[0], { ...preview.items[0], aid: 703, title: '遗漏的视频' }]
    const onExecuteOldFavoritePlan = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, steps: [], missingTargets: [], completedItems: [], message: 'done' })
      .mockResolvedValueOnce({ ok: false, steps: [], missingTargets: [], completedItems: [], message: 'failed' })
    const onOldFavoriteStatusUpdate = vi.fn()
    renderPanel({
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onOldFavoriteStatusUpdate
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(onOldFavoriteStatusUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: '整理有遗漏', tone: 'warn' })
    )
  })

  it('protects a normal video only after every selected target completes successfully', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'two'
    }
    preview.items[0] = {
      ...preview.items[0],
      targets: [
        { ledgerId: 'knowledge', folderId: '9001', displayName: 'bilimi·知识学习', keywords: [], alreadyInTarget: false, selected: true },
        { ledgerId: 'game', folderId: '9002', displayName: 'bilimi·游戏专区', keywords: [], alreadyInTarget: false, selected: true }
      ],
      originalSuggestedLedgerIds: ['knowledge', 'game'],
      currentTargetLedgerIds: ['knowledge', 'game'],
      selectedTargetLedgerIds: ['knowledge', 'game']
    }
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') return { ...ledger, bilibiliFolderId: '9001' }
      if (ledger.id === 'game') return { ...ledger, bilibiliFolderId: '9002' }
      return ledger
    })
    const onExecuteOldFavoritePlan = vi
      .fn()
      .mockImplementationOnce(async ([item]) => ({ ok: true, steps: [], missingTargets: [], completedItems: [item], message: 'done' }))
      .mockImplementationOnce(async () => ({ ok: false, partial: true, steps: [], missingTargets: ['9002'], completedItems: [], message: 'failed' }))
    const onConfirmArchiveProtections = vi.fn()
    renderPanel({
      ledgers,
      favoriteArchiveMultiMode: 'two',
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan,
      onConfirmArchiveProtections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(onConfirmArchiveProtections).not.toHaveBeenCalled()
  })


  it('refreshes the preview locally when the target-count setting changed after scanning', async () => {
    const preview = createArchivePreviewFixture()
    preview.scanContext = {
      accountMid: '42',
      totalUniqueVideos: 2,
      activeSourceFolders: [
        {
          id: 'source-1',
          title: '默认收藏夹',
          videos: preview.items.map((item) => ({
            aid: item.aid,
            title: item.title,
            author: item.author,
            description: item.description,
            tags: item.tags,
            sourceFolderIds: ['source-1'],
            sourceFolderTitles: ['默认收藏夹']
          }))
        }
      ],
      protectedVideos: [],
      managedFolders: [],
      targetMembership: {},
      multiArchiveMode: 'off'
    }
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: '9001' } : ledger
    )
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      completedItems: [],
      message: 'done'
    })
    renderPanel({
      ledgers,
      favoriteArchiveMultiMode: 'two',
      onScanOldFavorites: vi.fn().mockResolvedValue(preview),
      onExecuteOldFavoritePlan
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    await waitFor(() =>
      expect(screen.getByText('归档预览已按“最多 2 个收藏夹”更新。')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))
    const dialog = screen.getByRole('alertdialog', { name: '确认开始整理？' })
    expect(dialog).toHaveTextContent('本次将整理 1 条视频，每条视频最多存入 2 个 Bilimi 收藏夹。')
    expect(dialog).toHaveTextContent(
      '收藏夹数量设置已从“单收藏夹”调整为“最多 2 个”，归档预览已按新设置更新。'
    )
    fireEvent.click(within(dialog).getByRole('button', { name: '开始整理' }))

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalled())
  })

  it('toggles matched archive cards by clicking the card body', async () => {
    const { container } = await openArchivePreview()
    const previewVideo = getPreviewVideoButton(container, /AI 效率工具实战/)

    expect(previewVideo).toHaveAttribute('data-selected', 'true')
    fireEvent.click(previewVideo)
    await waitFor(() => expect(previewVideo).toHaveAttribute('data-selected', 'false'))
  })

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
    expect(within(pendingGroup).queryByText('暂无明确归档目标')).not.toBeInTheDocument()
    expect(within(pendingGroup).queryByText('已经对号入座')).not.toBeInTheDocument()
    expect(within(pendingGroup).queryByText('自动归档视频')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })).toBeInTheDocument()
  })

  it('keeps unclassified old favorites unselected in the unmatched preview group', async () => {
    const onOpenOldFavoriteVideo = vi.fn()
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 601,
          title: '没有命中分类的旧藏',
          author: '',
          tags: ['冷门', '待看', '长视频', '资料'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'bilimi·暂存',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: false,
          originalSuggestedLedgerIds: [],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: true,
          classificationDiagnostic: {
            score: 0.4,
            lowConfidence: true,
            scoreGap: 0.08,
            confidence: 'low',
            matchedKeywords: [],
            strongSignals: [],
            weakSignals: ['标题只命中弱关键词', '标签不足'],
            entityAliases: [],
            conceptClusters: [],
            positiveRules: [],
            negativeRules: []
          }
        }
      ],
      skippedSourceFolderTitles: []
    })

    const { container } = renderPanel({ onScanOldFavorites, onOpenOldFavoriteVideo })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const unmatchedGroup = screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })
    expect(within(unmatchedGroup).getByText('没有命中分类的旧藏')).toBeInTheDocument()
    expect(within(unmatchedGroup).getByText('来源：默认收藏夹')).toBeInTheDocument()
    expect(within(unmatchedGroup).getByText('UP：未知')).toBeInTheDocument()
    expect(within(unmatchedGroup).getByText(/标签：冷门、待看、长视频/)).toHaveAttribute(
      'title',
      '冷门、待看、长视频、资料'
    )
    expect(within(unmatchedGroup).getByText('分类把握：不太稳')).toHaveAttribute(
      'title',
      '当前分类比第二候选高 0.08、标题只命中弱关键词、标签不足'
    )
    expect(within(unmatchedGroup).queryByText('暂无明确归档目标')).not.toBeInTheDocument()
    fireEvent.click(within(unmatchedGroup).getByRole('button', { name: '打开视频来源 没有命中分类的旧藏' }))
    expect(onOpenOldFavoriteVideo).toHaveBeenCalledWith('https://www.bilibili.com/video/av601')
    expect(container.querySelector('.favorite-ledger-panel__preview-video')).not.toHaveAttribute(
      'aria-pressed'
    )
  })

  it('moves an old favorite to another ledger and reverts the item to its original group', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 602,
          title: '可以改去游戏区的视频',
          author: '小UP',
          tags: ['教程'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('调整分类 可以改去游戏区的视频'), {
      target: { value: 'game' }
    })

    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏 1 条' })
    expect(within(gameGroup).getByText('可以改去游戏区的视频')).toBeInTheDocument()
    expect(within(gameGroup).queryByText('将移至此分类')).not.toBeInTheDocument()
    expect(within(gameGroup).queryByText('当前位置')).not.toBeInTheDocument()
    expect(within(gameGroup).getByLabelText('调整分类 可以改去游戏区的视频')).toHaveAttribute(
      'title',
      '当前位置：bilimi·游戏，可手动切换'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·学习 1 条' })).not.toBeInTheDocument()

    fireEvent.change(within(gameGroup).getByLabelText('调整分类 可以改去游戏区的视频'), {
      target: { value: 'knowledge' }
    })

    expect(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'bilimi·游戏 1 条' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('调整分类 可以改去游戏区的视频')).toHaveAttribute(
      'title',
      '当前位置：bilimi·学习，可手动切换'
    )
  })

  it('sorts moved archive targets before low-confidence matches inside each ledger group', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 701,
          title: '低置信但未移动',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['game'],
          currentTargetLedgerIds: ['game'],
          selectedTargetLedgerIds: ['game'],
          lowConfidence: true
        },
        {
          aid: 702,
          title: 'DeepSeek 已移动',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['game'],
          selectedTargetLedgerIds: ['game'],
          lowConfidence: false
        },
        {
          aid: 703,
          title: '普通稳定匹配',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'game',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·游戏',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['game'],
          currentTargetLedgerIds: ['game'],
          selectedTargetLedgerIds: ['game'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏 3 条' })
    const titles = Array.from(
      gameGroup.querySelectorAll('.favorite-ledger-panel__preview-video-title')
    ).map((node) => node.textContent)

    expect(titles).toEqual(['DeepSeek 已移动', '低置信但未移动', '普通稳定匹配'])
  })

  it('confirms how multi-target old favorites move to unclassified', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 603,
          title: '单目标去未分类',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        },
        {
          aid: 604,
          title: '多目标只取消当前',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge', 'game'],
          currentTargetLedgerIds: ['knowledge', 'game'],
          selectedTargetLedgerIds: ['knowledge', 'game'],
          lowConfidence: false
        },
        {
          aid: 605,
          title: '多目标全部去掉',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge', 'game'],
          currentTargetLedgerIds: ['knowledge', 'game'],
          selectedTargetLedgerIds: ['knowledge', 'game'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    fireEvent.change(screen.getByLabelText('调整分类 单目标去未分类'), {
      target: { value: 'unclassified' }
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '单目标去未分类'
    )

    fireEvent.change(within(screen.getByRole('group', { name: 'bilimi·学习 2 条' })).getByLabelText('调整分类 多目标只取消当前'), {
      target: { value: 'unclassified' }
    })
    expect(screen.getByRole('alertdialog', { name: '确认未分类处理' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('group', { name: 'bilimi·学习 2 条' })).toHaveTextContent(
      '多目标只取消当前'
    )
    expect(screen.getByRole('group', { name: 'bilimi·游戏 2 条' })).toHaveTextContent(
      '多目标只取消当前'
    )

    fireEvent.change(within(screen.getByRole('group', { name: 'bilimi·学习 2 条' })).getByLabelText('调整分类 多目标只取消当前'), {
      target: { value: 'unclassified' }
    })
    fireEvent.click(screen.getByRole('button', { name: '只取消当前收藏夹' }))
    expect(screen.queryByRole('group', { name: /未匹配到合适分类 2 条/ })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·游戏 2 条' })).toHaveTextContent(
      '多目标只取消当前'
    )
    expect(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).not.toHaveTextContent(
      '多目标只取消当前'
    )

    fireEvent.change(within(screen.getByRole('group', { name: 'bilimi·游戏 2 条' })).getByLabelText('调整分类 多目标全部去掉'), {
      target: { value: 'unclassified' }
    })
    fireEvent.click(screen.getByRole('button', { name: '全部去掉不整理' }))
    expect(screen.getByRole('group', { name: /未匹配到合适分类 2 条/ })).toHaveTextContent(
      '多目标全部去掉'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·游戏 2 条' })).not.toBeInTheDocument()
  })

  it('retargets only the current area for multi-target old favorites', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      if (ledger.id === 'movie-tv') {
        return { ...ledger, displayName: 'bilimi·影视', bilibiliFolderId: '9003' }
      }
      return ledger
    })
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 606,
          title: '多目标改其中一个',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge', 'game'],
          currentTargetLedgerIds: ['knowledge', 'game'],
          selectedTargetLedgerIds: ['knowledge', 'game'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    })

    renderPanel({ ledgers, onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    fireEvent.change(
      within(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).getByLabelText('调整分类 多目标改其中一个'),
      { target: { value: 'movie-tv' } }
    )

    expect(screen.queryByRole('group', { name: 'bilimi·学习 1 条' })).not.toBeInTheDocument()
    const movieGroup = screen.getByRole('group', { name: 'bilimi·影视 1 条' })
    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏 1 条' })
    expect(movieGroup).toHaveTextContent('多目标改其中一个')
    expect(getPreviewArticle(movieGroup, /多目标改其中一个/)).toHaveTextContent(
      '来自 bilimi·学习、bilimi·游戏'
    )
    expect(gameGroup).toHaveTextContent('多目标改其中一个')
    expect(getPreviewArticle(gameGroup, /多目标改其中一个/)).not.toHaveTextContent('来自')
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 2 条归档任务')).toBeInTheDocument()
  })

  it('opens a pending old favorite source without removing it from the round', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '打开视频来源 手动分类旧藏' }))

    expect(onOpenOldFavoriteVideo).toHaveBeenCalledWith('https://www.bilibili.com/video/av242')
    expect(screen.getByRole('group', { name: '未匹配到合适分类 1 条' })).toBeInTheDocument()
    expect(screen.getByText('手动分类旧藏')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频来源 手动分类旧藏' })).not.toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText('调整分类 暂存旧藏'), {
      target: { value: 'inbox' }
    })

    const stagingGroup = screen.getByRole('group', { name: 'bilimi·暂存 1 条' })
    expect(getPreviewTargetToggle(stagingGroup, /暂存旧藏/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
  })

  it('lets unmatched old favorites choose any enabled bilimi ledger instead of only staging', async () => {
    await openArchivePreview()

    const pendingGroup = screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })
    fireEvent.change(within(pendingGroup).getByLabelText('调整分类 暂时不知道放哪'), {
      target: { value: 'game' }
    })

    expect(screen.getByRole('group', { name: /未匹配到合适分类 0 条/ })).not.toHaveTextContent(
      '暂时不知道放哪'
    )
    const gameGroup = screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })
    expect(getPreviewTargetToggle(gameGroup, /暂时不知道放哪/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('undoes and redoes archive preview changes step by step from separate toolbar buttons', async () => {
    await openArchivePreview()

    fireEvent.change(screen.getByLabelText('调整分类 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    fireEvent.change(screen.getByLabelText('调整分类 暂时不知道放哪'), {
      target: { value: 'music' }
    })
    expect(screen.getByRole('group', { name: 'bilimi·音乐舞台 1 条' })).toHaveTextContent(
      '暂时不知道放哪'
    )

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·音乐舞台 1 条' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·知识学习 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·游戏专区 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeDisabled()

    expect(screen.queryByText('已撤销本次改动。')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '恢复本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )

    fireEvent.click(screen.getByRole('button', { name: '恢复本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·音乐舞台 1 条' })).toHaveTextContent(
      '暂时不知道放哪'
    )
    expect(screen.getByRole('button', { name: '恢复本次改动' })).toBeDisabled()
  })

  it('toggles the old favorite guide hint from the heading help button', async () => {
    const preview = createArchivePreviewFixture()
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })

    const guideHint = /请从左到右完成本轮整理/
    expect(screen.queryByText(guideHint)).not.toBeInTheDocument()

    const helpButton = screen.getByRole('button', { name: '展开整理旧藏说明' })
    expect(helpButton).toHaveAttribute('title', expect.stringContaining('请从左到右完成本轮整理\n'))
    fireEvent.click(helpButton)

    const guide = screen.getByText(guideHint)
    const stepNav = screen.getByRole('navigation', { name: '整理旧藏步骤' })
    expect(Boolean(guide.compareDocumentPosition(stepNav) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(screen.getByText(guideHint)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByText(guideHint)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByText(guideHint)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText(guideHint)).toBeInTheDocument()
  })

  it('supports archive undo and redo keyboard shortcuts outside form controls', async () => {
    await openArchivePreview()

    fireEvent.change(screen.getByLabelText('调整分类 AI 效率工具实战'), {
      target: { value: 'game' }
    })
    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

    expect(screen.getByRole('group', { name: 'bilimi·知识学习 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·游戏专区 1 条' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Z', ctrlKey: true, shiftKey: true })

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )

    const historySelect = screen.getByLabelText('改动记录')
    historySelect.focus()
    fireEvent.keyDown(historySelect, { key: 'z', ctrlKey: true })

    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
  })

  it('confirms archive preview correction drafts only after executing the selected plan', async () => {
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:701'],
      missingTargets: [],
      message: '旧藏整理已完成。'
    })
    const onConfirmArchiveCorrections = vi.fn()
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game'
        ? { ...ledger, bilibiliFolderId: '9002' }
        : ledger.id === 'knowledge'
          ? { ...ledger, bilibiliFolderId: '9001' }
          : ledger
    )
    await openArchivePreview({
      ledgers,
      onExecuteOldFavoritePlan,
      onConfirmArchiveCorrections
    })

    fireEvent.change(screen.getByLabelText('调整分类 AI 效率工具实战'), {
      target: { value: 'game' }
    })

    expect(onConfirmArchiveCorrections).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(onConfirmArchiveCorrections).toHaveBeenCalledWith([
        expect.objectContaining({
          aid: 701,
          title: 'AI 效率工具实战',
          originalLedgerId: 'knowledge',
          userLedgerIds: ['game'],
          source: 'user',
          feedbackType: 'strong-correction',
          sourceScene: 'archive-preview',
          sourceFolderTitle: '默认收藏夹',
          confirmedAt: expect.any(String)
        })
      ])
    )
  })

  it('does not confirm added archive correction targets when that target execution fails', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      return ledger
    })
    const preview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 703,
          title: 'AI 工具也能做游戏剧情复盘',
          author: '效率研究所',
          description: '从 AI 工具聊到游戏剧情整理。',
          tags: ['AI', '游戏'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge', 'game'],
          selectedTargetLedgerIds: ['knowledge', 'game'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        steps: ['api:ledger:append:703:knowledge'],
        missingTargets: [],
        message: '学习收藏夹追加成功。'
      })
      .mockResolvedValueOnce({
        ok: false,
        steps: [],
        missingTargets: ['9002'],
        message: '游戏收藏夹追加失败。'
      })
    const onConfirmArchiveCorrections = vi.fn()

    renderPanel({
      ledgers,
      onScanOldFavorites,
      onExecuteOldFavoritePlan,
      onConfirmArchiveCorrections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const gameGroup = screen.getByRole('group', { name: /bilimi·游戏 1 条/ })
    const gameTargetToggle = getPreviewTargetToggle(gameGroup, /AI 工具也能做游戏剧情复盘/)
    fireEvent.click(gameTargetToggle)
    fireEvent.click(gameTargetToggle)

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(2))
    expect(onExecuteOldFavoritePlan).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ targetLedgerId: 'knowledge' })
    ])
    expect(onExecuteOldFavoritePlan).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ targetLedgerId: 'game' })
    ])
    expect(onConfirmArchiveCorrections).not.toHaveBeenCalled()
  })

  it('drops weak negative archive correction drafts for items without executed targets', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge'
        ? { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
        : ledger.id === 'game'
          ? { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
          : ledger
    )
    const preview: FavoriteLedgerPreview = {
      items: [
        {
          aid: 704,
          title: '取消归档的知识视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        },
        {
          aid: 705,
          title: '改去游戏区的视频',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学习',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false
        }
      ],
      skippedSourceFolderTitles: []
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['api:ledger:append:705:game'],
      missingTargets: [],
      message: '游戏收藏夹追加成功。'
    })
    const onConfirmArchiveCorrections = vi.fn()

    renderPanel({
      ledgers,
      onScanOldFavorites,
      onExecuteOldFavoritePlan,
      onConfirmArchiveCorrections
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const knowledgeGroup = screen.getByRole('group', { name: /bilimi·学习 2 条/ })
    fireEvent.click(getPreviewTargetToggle(knowledgeGroup, /取消归档的知识视频/))
    fireEvent.change(within(knowledgeGroup).getByLabelText('调整分类 改去游戏区的视频'), {
      target: { value: 'game' }
    })

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(onConfirmArchiveCorrections).toHaveBeenCalledWith([
        expect.objectContaining({
          aid: 705,
          originalLedgerId: 'knowledge',
          userLedgerIds: ['game'],
          source: 'user',
          feedbackType: 'strong-correction'
        })
      ])
    )
  })

  it('ends a zero-task old favorite round directly from confirmation', async () => {
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

    const onExecuteOldFavoritePlan = vi.fn()
    const onOldFavoriteAcknowledged = vi.fn()

    renderPanel({
      onScanOldFavorites,
      onExecuteOldFavoritePlan,
      onOldFavoriteAcknowledged
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全部存入暂存' }))

    const stagingGroup = screen.getByRole('group', { name: 'bilimi·暂存 2 条' })
    expect(getPreviewTargetToggle(stagingGroup, /暂存旧藏一/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getPreviewTargetToggle(stagingGroup, /暂存旧藏二/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getPreviewArticle(stagingGroup, /暂存旧藏一/)).toHaveTextContent('来自 未分类')
    expect(getPreviewArticle(stagingGroup, /暂存旧藏二/)).toHaveTextContent('来自 未分类')
    expect(screen.getByRole('combobox', { name: '改动记录' })).toHaveTextContent(
      '最近批量改动：全部存入暂存，移动 2 条'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('全部存入暂存：移动 2 条')

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))
    expect(screen.getByRole('group', { name: /未匹配到合适分类 2 条/ })).toHaveTextContent(
      '暂存旧藏一'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·暂存 2 条' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 0 条归档任务')).toBeInTheDocument()
    expect(
      screen.getByText('本轮没有需要执行的归档任务，点击确认整理后结束本轮整理')
    ).toBeInTheDocument()
    const confirmButton = screen.getByRole('button', { name: '确认整理' })
    expect(confirmButton).toBeEnabled()

    fireEvent.click(confirmButton)

    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()
    expect(onOldFavoriteAcknowledged).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '好的' })).not.toBeInTheDocument()
  })

  it.skip('keeps retry judgment available for pending old favorites without a usable target', async () => {
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

    expect(screen.getByRole('button', { name: '打开视频来源 无法补判旧藏' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频来源 无法补判旧藏' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '调整分类 无法补判旧藏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再次整理 无法补判旧藏' })).toBeInTheDocument()
  })

  it.skip('moves a pending old favorite into a matched ledger after retry judgment uses edited keywords', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '再次整理 很喜欢草根逆袭的故事' }))

    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·音乐舞台 1 条' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
  })

  it.skip('refreshes a pending old favorite before rejudging without staging the matched target', async () => {
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
      originalSuggestedLedgerIds: ['game'],
      currentTargetLedgerIds: [],
      selectedTargetLedgerIds: [],
      lowConfidence: false,
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
    fireEvent.click(screen.getByRole('button', { name: '再次整理 用户刚补了标签' }))

    await waitFor(() => expect(onRejudgeOldFavorite).toHaveBeenCalledWith(expect.objectContaining({ aid: 250 })))
    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·游戏专区 1 条' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 0 条归档任务')).toBeInTheDocument()
  })

  it.skip('moves a pending old favorite into a candidate target group after further judgment', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '再次整理 原神旧藏' }))

    expect(screen.queryByRole('group', { name: '未匹配到合适分类 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·原神 1 条' })).toBeInTheDocument()
  })

  it.skip('selects an existing candidate target when further judgment uses preview targets', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '再次整理 UP 主旧藏' }))

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
    const ledgerHelpButton = within(ledgerRegion).getByRole('button', { name: '展开收藏夹说明' })
    const ledgerHelpTitle = [
      '自定义你的 bilimi 收藏夹',
      '点击收藏名字可以编辑，添加好后点击【同步】即可更新到 B 站',
      '取消勾选再点击同步，也会删除对应的 bilimi 收藏夹'
    ].join('\n')
    expect(ledgerHelpButton).toHaveAttribute(
      'title',
      ledgerHelpTitle
    )
    expect(ledgerRegion.querySelector('.favorite-ledger-panel__sync-hint')).not.toBeInTheDocument()
    fireEvent.click(ledgerHelpButton)
    expect(ledgerRegion.querySelector('.favorite-ledger-panel__sync-hint')).toHaveTextContent(
      '自定义你的 bilimi 收藏夹 点击收藏名字可以编辑，添加好后点击【同步】即可更新到 B 站 取消勾选再点击同步，也会删除对应的 bilimi 收藏夹'
    )
    const syncHint = ledgerRegion.querySelector('.favorite-ledger-panel__sync-hint')
    expect(syncHint).toHaveTextContent(
      '关键词、UP 名字和标签用于本地识别；DeepSeek 约束只在开启 DeepSeek 后作为辅助判断参考，可以输入一段自然语言。'
    )
    expect(syncHint).not.toHaveTextContent('【DeepSeek约束】')
    expect(syncHint).not.toHaveTextContent('手动输入')

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

  it('locks the rule type for default ledgers while keeping name and keywords editable', async () => {
    const onSaveLedgers = vi.fn()
    renderPanel({ onSaveLedgers })

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    expect(editor.getByLabelText('收藏夹种类')).toBeDisabled()
    expect(editor.getByLabelText('收藏夹种类')).toHaveValue('keyword')

    fireEvent.change(editor.getByLabelText('册名'), { target: { value: '知识库' } })
    fireEvent.change(editor.getByLabelText('关键词'), { target: { value: '课程 教程 学术' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'knowledge',
            displayName: 'bilimi·知识库',
            keywords: ['课程', '教程', '学术'],
            isDefault: true
          })
        ])
      )
    )
  })

  it('warns when a non-inbox default ledger is saved without local keywords', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: '知识学习' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('关键词'), { target: { value: '' } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    expect(screen.getByRole('status')).toHaveTextContent('默认分类关键词已清空')
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

  it.each([
    {
      ruleType: 'keyword',
      ruleLabel: '关键词',
      name: 'AI资料',
      localRules: 'AI 教程',
      expectedLocalRules: ['AI', '教程'],
      constraint: '只收可复用的学习资料，排除带货软广。'
    },
    {
      ruleType: 'author',
      ruleLabel: 'UP 名字',
      name: '追更',
      localRules: '影视飓风、罗翔说刑法',
      expectedLocalRules: ['影视飓风', '罗翔说刑法'],
      constraint: '优先收系列长视频，不收切片搬运。'
    },
    {
      ruleType: 'tag',
      ruleLabel: '标签',
      name: '摄影标签',
      localRules: '摄影 后期',
      expectedLocalRules: ['摄影', '后期'],
      constraint: '只收教程和案例复盘，排除器材广告。'
    }
  ] as const)('saves a separate DeepSeek constraint for $ruleType ledgers', async ({
    ruleType,
    ruleLabel,
    name,
    localRules,
    expectedLocalRules,
    constraint
  }) => {
    const onSaveLedgers = vi.fn()
    renderPanel({ onSaveLedgers })

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('收藏夹种类'), { target: { value: ruleType } })
    fireEvent.change(editor.getByLabelText('册名'), { target: { value: name } })
    fireEvent.change(editor.getByLabelText(ruleLabel), { target: { value: localRules } })
    const constraintField = editor.getByLabelText('DeepSeek约束')
    expect(constraintField.tagName).toBe('INPUT')
    expect(constraintField).toHaveAttribute('type', 'text')
    fireEvent.change(constraintField, { target: { value: constraint } })
    fireEvent.click(editor.getByRole('button', { name: '保存' }))

    fireEvent.click(screen.getByRole('button', { name: `加入同步 bilimi·${name}` }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: `bilimi·${name}`,
            keywords: [...expectedLocalRules, DEEPSEEK_CONSTRAINT_MARKER, constraint],
            ruleType,
            enabled: true,
            isDefault: false
          })
        ])
      )
    )
  })

  it('splits a legacy inline DeepSeek constraint into the separate one-line constraint field', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-photo',
        displayName: 'bilimi·摄影',
        keywords: [
          '摄影',
          '后期',
          DEEPSEEK_CONSTRAINT_MARKER,
          '只收教程和案例复盘。\n排除器材广告。',
          '保留案例复盘。'
        ],
        ruleType: 'tag' as const,
        enabled: true,
        priority: 999,
        isDefault: false
      }
    ]
    renderPanel({ ledgers })

    fireEvent.click(screen.getByRole('button', { name: '摄影' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    expect(editor.getByLabelText('标签')).toHaveValue('摄影、后期')
    const constraintField = editor.getByLabelText('DeepSeek约束')
    expect(constraintField.tagName).toBe('INPUT')
    expect(constraintField).toHaveValue('只收教程和案例复盘。 排除器材广告。 保留案例复盘。')
  })

  it('edits a new ledger as a DeepSeek constraint collection', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))

    const editor = within(screen.getByRole('region', { name: '当前收藏夹' }))
    fireEvent.change(editor.getByLabelText('收藏夹种类'), { target: { value: 'deepseek' } })
    expect(editor.getByLabelText('DeepSeek约束')).toBeInTheDocument()
    expect(
      screen.getByText('填写自然语言判断规则。此类型不参与本地自动分类，必须开启 DeepSeek 后才会用于辅助判断。')
    ).toBeInTheDocument()
    expect(
      screen.getByText('DeepSeek 未开启时不会自动命中；需要本地规则时请选择关键词、UP 或标签收藏夹。')
    ).toBeInTheDocument()

    fireEvent.change(editor.getByLabelText('册名'), { target: { value: '剧情考据' } })
    fireEvent.change(editor.getByLabelText('DeepSeek约束'), {
      target: { value: '只收剧情解析、角色考据、世界观分析。\n不要收抽卡、整活、直播切片。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·剧情考据' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    await waitFor(() =>
      expect(onSaveLedgers).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            displayName: 'bilimi·剧情考据',
            ruleType: 'deepseek',
            keywords: ['只收剧情解析、角色考据、世界观分析。\n不要收抽卡、整活、直播切片。']
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
    const savedLedgers = onSaveLedgers.mock.calls[0][0] as FavoriteLedger[]
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
    const savedLedgerIds = (onSaveLedgers.mock.calls[0][0] as FavoriteLedger[]).map(
      (ledger) => ledger.id
    )
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
    expect(editor.getByLabelText('DeepSeek约束')).toBeInTheDocument()

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

    fireEvent.click(screen.getByRole('dialog', { name: '掌库' }))

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
    fireEvent.click(screen.getByRole('dialog', { name: '掌库' }))

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
    expect(screen.getByText('不同关键词用顿号或空格隔开，逗号、斜杠也能识别。')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '当前收藏夹' })).getByLabelText('DeepSeek约束')).toBeInTheDocument()
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
          sourceFolderTitles: ['默认收藏夹', '旅行收藏'],
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
    expect(screen.queryByText(/需要复核/)).not.toBeInTheDocument()
    expect(screen.queryByText('已经归档的视频')).not.toBeInTheDocument()
    const knowledgeGroup = screen.getByRole('group', { name: 'Bilimi路知识 1 条' })
    const knowledgeVideo = getPreviewVideoButton(knowledgeGroup, /机器学习科普教程/)
    expect(knowledgeVideo).toHaveAttribute('data-selected', 'true')
    fireEvent.click(getPreviewTargetToggle(knowledgeGroup, /机器学习科普教程/))

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认整理' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    const refreshedKnowledgeGroup = screen.getByRole('group', { name: 'Bilimi路知识 1 条' })
    fireEvent.click(getPreviewTargetToggle(refreshedKnowledgeGroup, /机器学习科普教程/))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

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
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([
      expect.objectContaining({
        aid: 101,
        targetLedgerId: 'knowledge',
        targetFolderId: '9001'
      })
    ])
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledWith([
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
    fireEvent.click(getPreviewTargetToggle(movieGroup, /爆笑鬼畜合集/))
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()

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
    confirmOldFavoriteExecution()

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
    confirmOldFavoriteExecution()

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

  it('keeps real archive execution locked after remount', async () => {
    let resolveExecution!: (value: {
      ok: boolean
      steps: string[]
      missingTargets: string[]
      message: string
    }) => void
    const execution = new Promise<{
      ok: boolean
      steps: string[]
      missingTargets: string[]
      message: string
    }>((resolve) => {
      resolveExecution = resolve
    })
    const onExecuteOldFavoritePlan = vi.fn(() => execution)
    const first = await openArchivePreview({ onExecuteOldFavoritePlan })

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    confirmOldFavoriteExecution()
    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())

    first.unmount()
    renderPanel({ onExecuteOldFavoritePlan })

    const runningButton = screen.getByRole('button', { name: '整理中' })
    expect(runningButton).toBeDisabled()
    fireEvent.click(runningButton)
    expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce()

    await act(async () => {
      resolveExecution({
        ok: true,
        steps: ['api:ledger:append:701'],
        missingTargets: [],
        message: 'done'
      })
      await execution
    })
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
    confirmOldFavoriteExecution()

    await waitFor(() => expect(onExecuteOldFavoritePlan).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: '好的' })).toBeInTheDocument())
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('本次整理已结束')

    fireEvent.click(screen.getByRole('button', { name: '备册' }))
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('正在整理中，请耐心等待')

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    expect(container.querySelector('.favorite-ledger-panel__status')).toHaveTextContent('正在整理中，请耐心等待')
    expect(onScanOldFavorites).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '好的' }))
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认整理' })).not.toBeInTheDocument()
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
    expect(getPreviewTargetToggle(movieGroup, /影视飓风相机评测/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(getPreviewTargetToggle(authorGroup, /影视飓风剪辑教程/)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
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
    const onOldFavoriteAcknowledged = vi.fn()

    render(
      <FavoriteLedgerPanel
        ledgers={ledgers}
        missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()}
        onSaveLedgers={vi.fn().mockResolvedValue({ ok: true, steps: [], missingTargets: [], message: '掌库已同步。' })}
        onScanOldFavorites={onScanOldFavorites}
        onExecuteOldFavoritePlan={onExecuteOldFavoritePlan}
        onOldFavoriteAcknowledged={onOldFavoriteAcknowledged}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByLabelText('全选 bilimi·影视动漫'))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    expect(screen.getByText('已选择 0 条归档任务')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认整理' }))

    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()
    expect(onOldFavoriteAcknowledged).toHaveBeenCalledOnce()
  })

  it('lets users choose which old favorite source folders to organize from the scan overview', async () => {
    const preview = {
      items: [
        {
          aid: 101,
          title: '机器学习科普教程',
          sourceFolderTitle: '默认收藏夹',
          sourceFolderTitles: ['默认收藏夹', '旅行收藏'],
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

    fireEvent.click(screen.getByLabelText('整理来源 默认收藏夹'))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    expect(screen.getByText('机器学习科普教程')).toBeInTheDocument()
    expect(screen.getByText('东京旅行攻略')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 2 条归档任务')).toBeInTheDocument()
  })

  it('applies selected candidate ledgers to source folders that are re-enabled later', async () => {
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
          selected: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'Bilimi路AI效率工坊',
              keywords: ['AI']
            }
          ]
        },
        {
          aid: 202,
          title: '旅行 AI 工具',
          sourceFolderTitle: '旅行收藏',
          targetLedgerId: 'life-interest',
          targetFolderId: '9002',
          targetDisplayName: 'bilimi·生活日常',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'Bilimi路AI效率工坊',
              keywords: ['AI']
            }
          ]
        }
      ],
      skippedSourceFolderTitles: [],
      insights: {
        totalVideos: 2,
        topAuthors: [],
        topTags: [{ name: 'AI', count: 2 }],
        topCategories: [],
        sourceFolders: [
          { name: '默认收藏夹', count: 1 },
          { name: '旅行收藏', count: 1 }
        ],
        titleSeries: [],
        candidateLedgers: [
          {
            kind: 'tag-cluster' as const,
            sourceName: 'AI',
            displayName: 'Bilimi路AI效率工坊',
            keywords: ['AI'],
            count: 2,
            confidence: 'high' as const,
            reason: '旧藏推荐：2 条旧藏适合归入此收藏夹。'
          }
        ]
      }
    }
    const onScanOldFavorites = vi.fn().mockResolvedValue(preview)

    renderPanel({ onScanOldFavorites })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByLabelText('整理来源 旅行收藏'))
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByLabelText('Bilimi路AI效率工坊'))
    fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
    fireEvent.click(screen.getByLabelText('整理来源 旅行收藏'))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    const candidateGroup = screen.getByRole('group', { name: 'Bilimi路AI效率工坊 2 条' })
    expect(candidateGroup).toHaveTextContent('机器学习科普教程')
    expect(candidateGroup).toHaveTextContent('旅行 AI 工具')
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByText('已选择 4 条归档任务')).toBeInTheDocument()
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
    confirmOldFavoriteExecution()

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
          selected: true,
          originalSuggestedLedgerIds: ['inbox'],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: false
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

    const scanOverviewHeading = await screen.findByRole('heading', { name: '扫描概览' })
    const scanOverviewNote = screen.getByText('共扫描 6 条旧藏，生成 1 个候选收藏夹')
    const scanOverviewSection = scanOverviewHeading.closest('section')
    expect(scanOverviewSection).toBeInTheDocument()
    expect(scanOverviewNote).toHaveClass('favorite-ledger-panel__step-note')
    expect(scanOverviewSection).toHaveTextContent(/扫描概览[\s\S]*共扫描 6 条旧藏，生成 1 个候选收藏夹[\s\S]*基础数据/)
    expect(scanOverviewSection?.querySelectorAll('.favorite-ledger-panel__step-divider')).toHaveLength(2)
    expect(await screen.findByText('基础数据')).toBeInTheDocument()
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
    const generatedHeading = screen.getByRole('heading', { name: '推荐收藏夹' })
    const generatedSection = generatedHeading.closest('section')
    expect(generatedSection).toBeInTheDocument()
    expect(generatedSection).toHaveTextContent(
      /推荐收藏夹[\s\S]*确认执行后，会把已勾选候选同步到 B 站收藏夹里。[\s\S]*专属 UP 追更[\s\S]*高频标签收藏夹/
    )
    expect(generatedSection?.querySelectorAll('.favorite-ledger-panel__step-divider')).toHaveLength(2)
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

    const photoGroup = screen.getByRole('group', { name: 'bilimi·摄影 1 条' })
    expect(photoGroup).toBeInTheDocument()
    expect(getPreviewArticle(photoGroup, /光影构图入门/)).toHaveTextContent('来自 未分类')
    expect(screen.getByRole('combobox', { name: '改动记录' })).toHaveTextContent(
      '最近批量改动：勾选收藏夹「bilimi·摄影」，移动 1 条'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·待分类 1 条' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))
    expect(screen.queryByRole('group', { name: 'bilimi·摄影 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent('光影构图入门')

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·摄影')).not.toBeChecked()
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
          selected: true,
          originalSuggestedLedgerIds: ['inbox'],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: false
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

  it('disables archive-preview DeepSeek organization when DeepSeek is unavailable', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn()

    await openArchivePreview({
      deepSeekArchiveAvailable: false,
      onOrganizeOldFavoritesWithDeepSeek
    })

    expect(screen.getByRole('button', { name: 'DeepSeek 整理' })).toBeDisabled()
    expect(screen.getByText('请先到设置开启 DeepSeek 后再使用辅助整理。')).toBeInTheDocument()
    expect(screen.getByText(/将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息/)).toBeInTheDocument()
    expect(onOrganizeOldFavoritesWithDeepSeek).not.toHaveBeenCalled()
  })

  it('presents DeepSeek organization and archive undo in a combined preview tool', async () => {
    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek: vi.fn()
    })

    const toolCard = screen.getByRole('group', { name: '归档预览辅助工具' })
    expect(toolCard).toHaveClass('favorite-ledger-panel__archive-tool-card')
    expect(toolCard.querySelector('.favorite-ledger-panel__archive-tool-divider')).toBeInTheDocument()

    const deepSeekCard = within(toolCard).getByRole('group', { name: 'DeepSeek 辅助整理' })
    expect(within(deepSeekCard).getByText('DeepSeek 辅助整理')).toBeInTheDocument()
    expect(within(deepSeekCard).getByRole('button', { name: '整理范围' })).toHaveAttribute(
      'title',
      '当前选择：不太稳 + 未匹配到合适分类'
    )
    expect(within(deepSeekCard).getByRole('button', { name: 'DeepSeek 整理' })).toBeInTheDocument()
    expect(
      within(deepSeekCard).getByText(/将发送标题、UP、标签、简介、来源收藏夹、当前建议和 bilimi 册目信息/)
    ).toBeInTheDocument()

    const undoTools = within(toolCard).getByRole('group', { name: '归档预览改动操作' })
    expect(within(undoTools).getByRole('button', { name: '撤销本次改动' })).toBeInTheDocument()
    expect(within(undoTools).getByRole('button', { name: '恢复本次改动' })).toBeInTheDocument()
    expect(within(undoTools).getByText(/Ctrl\+Z 撤销，Ctrl\+Shift\+Z 恢复/)).toBeInTheDocument()
    expect(Boolean(deepSeekCard.compareDocumentPosition(undoTools) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true
    )
    expect(screen.getByRole('heading', { name: '归档预览' }).closest('.favorite-ledger-panel__preview-topbar')).not.toHaveTextContent(
      'DeepSeek 辅助整理'
    )
  })

  it('keeps DeepSeek archive mode changes local until the user starts organization', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    expect(screen.getByRole('button', { name: '整理范围' })).toHaveAttribute(
      'title',
      '当前选择：不太稳 + 未匹配到合适分类'
    )

    selectDeepSeekArchiveScope('DeepSeek 进行二次整理')
    expect(onOrganizeOldFavoritesWithDeepSeek).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledWith(
      'all',
      expect.objectContaining({
        kind: 'favorite-archive-organize',
        mode: 'all',
        videos: [expect.objectContaining({ aid: 701 }), expect.objectContaining({ aid: 702 })]
      })
    )
  })

  it('sends only unclassified-area videos for DeepSeek archive unclassified-only mode', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    selectDeepSeekArchiveScope('仅未匹配到合适分类')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledWith(
      'unclassified-only',
      expect.objectContaining({
        mode: 'unclassified-only',
        videos: [expect.objectContaining({ aid: 702 })]
      })
    )
  })

  it('locks archive preview edits and execution while DeepSeek organization is running', async () => {
    let resolveDeepSeek: (result: DeepSeekGenerateResult) => void = () => undefined
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockReturnValue(
      new Promise<DeepSeekGenerateResult>((resolve) => {
        resolveDeepSeek = resolve
      })
    )
    const onExecuteOldFavoritePlan = vi.fn().mockResolvedValue({
      ok: true,
      steps: [],
      missingTargets: [],
      message: '旧藏已归册。'
    })

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onExecuteOldFavoritePlan
    })

    const originalGroup = screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })
    const originalVideo = getPreviewVideoButton(originalGroup, /AI 效率工具实战/)
    const originalTargetToggle = getPreviewTargetToggle(originalGroup, /AI 效率工具实战/)

    selectDeepSeekArchiveScope('DeepSeek 进行二次整理')
    selectDeepSeekArchiveScope('DeepSeek 进行二次整理')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    expect(await screen.findByText('DeepSeek 正在整理旧藏...')).toBeInTheDocument()
    expect(originalTargetToggle).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(originalVideo)
    expect(screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })).toBeInTheDocument()

    const confirmStepButton = screen.getByRole('button', { name: '确认执行' })
    expect(confirmStepButton).toBeDisabled()
    fireEvent.click(confirmStepButton)
    expect(screen.queryByRole('button', { name: '确认整理' })).not.toBeInTheDocument()
    expect(onExecuteOldFavoritePlan).not.toHaveBeenCalled()

    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })
  })

  it('locks old favorite guide candidate selection while DeepSeek organization is running', async () => {
    let resolveDeepSeek: (result: DeepSeekGenerateResult) => void = () => undefined
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockReturnValue(
      new Promise<DeepSeekGenerateResult>((resolve) => {
        resolveDeepSeek = resolve
      })
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: [
        {
          aid: 801,
          title: 'AI 候选视频',
          author: '效率研究所',
          description: 'AI 工作流拆解。',
          tags: ['AI', '效率'],
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'knowledge',
          targetFolderId: '9001',
          targetDisplayName: 'bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: false,
          selected: true,
          originalSuggestedLedgerIds: ['knowledge'],
          currentTargetLedgerIds: ['knowledge'],
          selectedTargetLedgerIds: ['knowledge'],
          lowConfidence: false,
          candidateTargets: [
            {
              candidateKey: 'tag-cluster:AI',
              ledgerId: 'custom-tag-cluster-AI',
              displayName: 'bilimi·AI效率工坊',
              keywords: ['AI', '效率']
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
            keywords: ['AI', '效率'],
            count: 1,
            confidence: 'medium' as const,
            reason: 'AI 标签适合单独成册。'
          }
        ]
      }
    } satisfies FavoriteLedgerPreview)

    renderPanel({
      deepSeekArchiveAvailable: true,
      onScanOldFavorites,
      onOrganizeOldFavoritesWithDeepSeek
    })

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·AI效率工坊')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

    selectDeepSeekArchiveScope('DeepSeek 进行二次整理')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    expect(await screen.findByText('DeepSeek 正在整理旧藏...')).toBeInTheDocument()

    const candidateStepButton = screen.getByRole('button', { name: '推荐收藏夹' })
    expect(candidateStepButton).toBeDisabled()
    fireEvent.click(candidateStepButton)
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')

    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByLabelText('bilimi·AI效率工坊')).not.toBeChecked()
  })

  it('shows DeepSeek archive progress across request batches', async () => {
    const resolvers: Array<(result: DeepSeekGenerateResult) => void> = []
    const onOldFavoriteStatusUpdate = vi.fn()
    const onOldFavoriteStageFeedback = vi.fn()
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockImplementation(
      () =>
        new Promise<DeepSeekGenerateResult>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: Array.from({ length: 21 }, (_, index) => ({
        aid: 900 + index,
        title: `待整理旧藏 ${index + 1}`,
        sourceFolderTitle: '默认收藏夹',
        targetLedgerId: 'inbox',
        targetFolderId: '9008',
        targetDisplayName: 'bilimi·暂存',
        reviewRequired: false,
        alreadyInTarget: false,
        selected: false,
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        lowConfidence: true
      })),
      skippedSourceFolderTitles: []
    } satisfies FavoriteLedgerPreview)

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onScanOldFavorites,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStatusUpdate,
      onOldFavoriteStageFeedback
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    expect(screen.getByText('第 1 / 2 批')).toBeInTheDocument()
    expect(screen.getByText(/已完成 0 \/ 21 条/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'DeepSeek 整理进度' })).toHaveAttribute(
      'aria-valuenow',
      '0'
    )
    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith({
      label: 'DeepSeek整理 0/21',
      message: 'DeepSeek 正在辅助整理旧藏。',
      tone: 'running'
    })

    await act(async () => {
      resolvers[0]({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledTimes(2))
    expect(screen.getByText('第 2 / 2 批')).toBeInTheDocument()
    expect(screen.getByText(/已完成 20 \/ 21 条/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'DeepSeek 整理进度' })).toHaveAttribute(
      'aria-valuenow',
      '95'
    )
    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith({
      label: 'DeepSeek整理 20/21',
      message: 'DeepSeek 正在辅助整理旧藏。',
      tone: 'running'
    })

    await act(async () => {
      resolvers[1]({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    await waitFor(() => expect(screen.getByText(/已完成 21 \/ 21 条/)).toBeInTheDocument())
    expect(screen.getByRole('progressbar', { name: 'DeepSeek 整理进度' })).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
    expect(onOldFavoriteStatusUpdate).toHaveBeenCalledWith({
      label: '整理待确认 21',
      message: 'DeepSeek 整理完成，请确认执行。',
      tone: 'warn'
    })
    expect(onOldFavoriteStageFeedback).toHaveBeenCalledWith('DeepSeek 整理完成，请确认执行')
  })

  it('delivers DeepSeek completion callbacks to the latest remounted panel', async () => {
    let resolveDeepSeek!: (result: DeepSeekGenerateResult) => void
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn(
      () =>
        new Promise<DeepSeekGenerateResult>((resolve) => {
          resolveDeepSeek = resolve
        })
    )
    const staleStageFeedback = vi.fn()
    const latestStageFeedback = vi.fn()
    const staleKeywordSuggestions = vi.fn()
    const latestKeywordSuggestions = vi.fn()
    const first = await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStageFeedback: staleStageFeedback,
      onDeepSeekArchiveKeywordSuggestions: staleKeywordSuggestions
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    staleStageFeedback.mockClear()
    first.unmount()
    renderPanel({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStageFeedback: latestStageFeedback,
      onDeepSeekArchiveKeywordSuggestions: latestKeywordSuggestions
    })

    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: [
          {
            id: 'suggestion-after-remount',
            action: 'add-keyword',
            ledgerId: 'knowledge',
            keyword: 'AI 工具',
            reason: '补充常用关键词',
            source: 'deepseek',
            status: 'pending',
            createdAt: '2026-07-12T00:00:00.000Z'
          }
        ]
      })
    })

    await waitFor(() =>
      expect(latestStageFeedback).toHaveBeenCalledWith('DeepSeek 整理完成，请确认执行')
    )
    expect(latestKeywordSuggestions).toHaveBeenCalledOnce()
    expect(staleStageFeedback).not.toHaveBeenCalled()
    expect(staleKeywordSuggestions).not.toHaveBeenCalled()
  })

  it('ignores a stale DeepSeek completion after the runtime account changes', async () => {
    let resolveDeepSeek!: (result: DeepSeekGenerateResult) => void
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn(
      () =>
        new Promise<DeepSeekGenerateResult>((resolve) => {
          resolveDeepSeek = resolve
        })
    )
    const onOldFavoriteStageFeedback = vi.fn()

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onOldFavoriteStageFeedback
    })
    bindOldFavoriteRuntimeAccount('42')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    onOldFavoriteStageFeedback.mockClear()

    act(() => {
      bindOldFavoriteRuntimeAccount('99')
    })
    await act(async () => {
      resolveDeepSeek({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    expect(onOldFavoriteStageFeedback).not.toHaveBeenCalled()
    expect(screen.queryByText(/DeepSeek 整理完成/)).not.toBeInTheDocument()
  })

  it('clears the running status when DeepSeek archive organization fails', async () => {
    const onOldFavoriteStatusUpdate = vi.fn()
    const onDeepSeekArchiveKeywordSuggestions = vi.fn(() => {
      throw new Error('建议列表写入失败')
    })
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [],
      keywordSuggestions: [
        {
          id: 'suggestion-1',
          action: 'add-keyword',
          ledgerId: 'knowledge',
          keyword: 'AI 工具',
          reason: '补充常用关键词',
          source: 'deepseek',
          status: 'pending',
          createdAt: '2026-07-12T00:00:00.000Z'
        }
      ]
    } satisfies DeepSeekGenerateResult)

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek,
      onDeepSeekArchiveKeywordSuggestions,
      onOldFavoriteStatusUpdate
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    await waitFor(() =>
      expect(onOldFavoriteStatusUpdate).toHaveBeenLastCalledWith({
        label: 'DeepSeek整理失败',
        message: '建议列表写入失败',
        tone: 'error'
      })
    )
    expect(screen.getByText('建议列表写入失败')).toBeInTheDocument()
  })

  it('cancels DeepSeek archive organization after remount before starting the next batch', async () => {
    let resolveFirstBatch!: (result: DeepSeekGenerateResult) => void
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn(
      () =>
        new Promise<DeepSeekGenerateResult>((resolve) => {
          resolveFirstBatch = resolve
        })
    )
    const onScanOldFavorites = vi.fn().mockResolvedValue({
      items: Array.from({ length: 21 }, (_, index) => ({
        aid: 1200 + index,
        title: `可取消旧藏 ${index + 1}`,
        sourceFolderTitle: '默认收藏夹',
        targetLedgerId: 'inbox',
        targetFolderId: '9008',
        targetDisplayName: 'bilimi·暂存',
        reviewRequired: false,
        alreadyInTarget: false,
        selected: false,
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        lowConfidence: true
      })),
      skippedSourceFolderTitles: []
    } satisfies FavoriteLedgerPreview)

    const first = await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onScanOldFavorites,
      onOrganizeOldFavoritesWithDeepSeek
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce())
    first.unmount()
    const { container } = renderPanel({
      deepSeekArchiveAvailable: true,
      onScanOldFavorites,
      onOrganizeOldFavoritesWithDeepSeek
    })
    expect(
      container.querySelectorAll('.favorite-ledger-panel__deepseek-archive-run-button')
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '取消整理' }))

    expect(screen.getByText('正在取消 DeepSeek 整理...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消中...' })).toBeDisabled()

    await act(async () => {
      resolveFirstBatch({
        kind: 'favorite-archive-organize',
        results: [],
        keywordSuggestions: []
      })
    })

    expect(onOrganizeOldFavoritesWithDeepSeek).toHaveBeenCalledOnce()
    expect(await screen.findByText('DeepSeek 整理已取消。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DeepSeek 整理' })).toBeEnabled()
  })

  it('applies DeepSeek archive results with displacement notice and reverts the whole run', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'knowledge') {
        return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      if (ledger.id === 'movie-tv') {
        return { ...ledger, displayName: 'bilimi·影视', bilibiliFolderId: '9003' }
      }
      return ledger
    })
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 701,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['game', 'movie-tv'],
          keepOriginal: false,
          reason: 'DeepSeek 认为它更像游戏工具。',
          confidence: 0.91,
          lowConfidence: false
        },
        {
          aid: 702,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['game'],
          keepOriginal: false,
          reason: 'DeepSeek 补判为游戏。',
          confidence: 0.86,
          lowConfidence: false
        }
      ],
      keywordSuggestions: []
    } satisfies DeepSeekGenerateResult)

    await openArchivePreview({
      ledgers,
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    expect(screen.getByRole('group', { name: 'bilimi·学吧你就 1 条' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    const gameGroup = await screen.findByRole('group', { name: 'bilimi·游戏 2 条' })
    expect(gameGroup).toHaveTextContent('AI 效率工具实战')
    expect(gameGroup).toHaveTextContent('暂时不知道放哪')
    expect(screen.queryByRole('group', { name: 'bilimi·学吧你就 1 条' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: /未匹配到合适分类 0 条/ })).not.toHaveTextContent(
      '暂时不知道放哪'
    )
    const deepSeekMovedVideo = getPreviewVideoButton(gameGroup, /AI 效率工具实战/)
    expect(deepSeekMovedVideo).toHaveAttribute('data-selected', 'true')
    expect(deepSeekMovedVideo).toHaveClass(
      'favorite-ledger-panel__preview-video--deepseek'
    )
    expect(getPreviewArticle(gameGroup, /AI 效率工具实战/)).toHaveTextContent('来自 bilimi·学习')
    expect(getPreviewArticle(gameGroup, /暂时不知道放哪/)).toHaveTextContent('来自 未分类')
    expect(screen.getByRole('combobox', { name: '改动记录' })).toHaveTextContent(
      '最近批量改动：DeepSeek 批量整理，移动 2 条'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('超过 1 个目标')

    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销本次改动' }))

    expect(screen.getByRole('group', { name: 'bilimi·学习 1 条' })).toHaveTextContent(
      'AI 效率工具实战'
    )
    expect(screen.getByRole('group', { name: /未匹配到合适分类 1 条/ })).toHaveTextContent(
      '暂时不知道放哪'
    )
    expect(screen.queryByRole('group', { name: 'bilimi·游戏 2 条' })).not.toBeInTheDocument()
  })

  it('explains both applied and unapplied DeepSeek archive results from the whole status line', async () => {
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 701,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['knowledge'],
          keepOriginal: false,
          reason: '继续归入知识学习。',
          confidence: 0.91,
          lowConfidence: false
        },
        {
          aid: 702,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['未分类'],
          keepOriginal: false,
          reason: '没有明确适合的分类。',
          confidence: 0.6,
          lowConfidence: true
        }
      ],
      keywordSuggestions: []
    } satisfies DeepSeekGenerateResult)

    await openArchivePreview({
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

    const summary = await screen.findByRole('button', {
      name: 'DeepSeek 整理结果：1 条已应用，1 条未应用'
    })
    expect(summary).toHaveTextContent('1 条已应用，1 条未应用')
    fireEvent.click(summary)
    const detail = screen.getByRole('tooltip')
    expect(detail).toHaveTextContent('本次 DeepSeek 整理结果')
    expect(detail).toHaveTextContent('共处理 2 条视频')
    expect(detail).toHaveTextContent('已采用 DeepSeek 建议并更新归档预览，尚未操作 B 站收藏夹。')
    expect(detail).toHaveTextContent('未采用 DeepSeek 建议，继续保持整理前的归档状态。')
    expect(detail).toHaveTextContent('保持未分类：1 条')
  })

  it('resets affected horizontal preview tracks without vertically focusing after DeepSeek moves archive cards', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
        if (ledger.id === 'knowledge') {
          return { ...ledger, displayName: 'bilimi·学习', bilibiliFolderId: '9001' }
        }
        if (ledger.id === 'game') {
          return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
        }
        return ledger
      })
      const preview = createArchivePreviewFixture()
      preview.items.push({
        aid: 704,
        title: '游戏区保底视频',
        author: '游戏UP',
        description: '保留目标分组。',
        tags: ['游戏'],
        sourceFolderTitle: '默认收藏夹',
        targetLedgerId: 'game',
        targetFolderId: '9002',
        targetDisplayName: 'bilimi·游戏',
        reviewRequired: false,
        alreadyInTarget: false,
        selected: true,
        originalSuggestedLedgerIds: ['game'],
        currentTargetLedgerIds: ['game'],
        selectedTargetLedgerIds: ['game'],
        lowConfidence: false
      })
      const onScanOldFavorites = vi.fn().mockResolvedValue(preview)
      const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
        kind: 'favorite-archive-organize',
        results: [
          {
            aid: 701,
            sourceFolderTitle: '默认收藏夹',
            targetLedgerIds: ['game'],
            keepOriginal: false,
            reason: 'DeepSeek 认为它更像游戏工具。',
            confidence: 0.91,
            lowConfidence: false
          }
        ],
        keywordSuggestions: []
      } satisfies DeepSeekGenerateResult)
      const { container } = renderPanel({
        ledgers,
        deepSeekArchiveAvailable: true,
        onScanOldFavorites,
        onOrganizeOldFavoritesWithDeepSeek
      })

      fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
      await screen.findByRole('region', { name: '整理旧藏向导' })
      fireEvent.click(screen.getByRole('button', { name: '归档预览' }))

      const knowledgeSection = getPreviewArticle(container, /AI 效率工具实战/).closest('section')
      const gameSection = getPreviewArticle(container, /游戏区保底视频/).closest('section')
      expect(knowledgeSection).not.toBeNull()
      expect(gameSection).not.toBeNull()
      const knowledgeTrack = knowledgeSection!.querySelector<HTMLElement>(
        '.favorite-ledger-panel__preview-videos'
      )
      const gameTrack = gameSection!.querySelector<HTMLElement>('.favorite-ledger-panel__preview-videos')
      expect(knowledgeTrack).toBeDefined()
      expect(gameTrack).toBeDefined()
      knowledgeTrack!.scrollLeft = 128
      gameTrack!.scrollLeft = 96

      fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))

      const updatedGameGroup = await screen.findByRole('group', { name: 'bilimi·游戏 2 条' })
      expect(updatedGameGroup).toHaveTextContent('AI 效率工具实战')
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(
        getPreviewArticle(container, /AI 效率工具实战/)
          .closest('section')
          ?.querySelector('.favorite-ledger-panel__preview-videos')
      ).toHaveProperty('scrollLeft', 0)
      expect(updatedGameGroup.querySelector('.favorite-ledger-panel__preview-videos')).toHaveProperty(
        'scrollLeft',
        0
      )
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('invalidates the DeepSeek run snapshot after manual archive edits or reset', async () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'game') {
        return { ...ledger, displayName: 'bilimi·游戏', bilibiliFolderId: '9002' }
      }
      if (ledger.id === 'movie-tv') {
        return { ...ledger, displayName: 'bilimi·影视', bilibiliFolderId: '9003' }
      }
      return ledger
    })
    const onOrganizeOldFavoritesWithDeepSeek = vi.fn().mockResolvedValue({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 702,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['game'],
          keepOriginal: false,
          reason: 'DeepSeek 补判为游戏。',
          confidence: 0.84,
          lowConfidence: false
        }
      ],
      keywordSuggestions: []
    } satisfies DeepSeekGenerateResult)

    await openArchivePreview({
      ledgers,
      deepSeekArchiveAvailable: true,
      onOrganizeOldFavoritesWithDeepSeek
    })

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    const gameGroup = await screen.findByRole('group', { name: 'bilimi·游戏 1 条' })
    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeEnabled()

    fireEvent.change(within(gameGroup).getByLabelText('调整分类 暂时不知道放哪'), {
      target: { value: 'movie-tv' }
    })
    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'bilimi·影视 1 条' })).toHaveTextContent(
      '暂时不知道放哪'
    )

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await screen.findByRole('group', { name: 'bilimi·游戏 1 条' })
    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.queryByRole('button', { name: '撤回本次 DeepSeek 整理' })).not.toBeInTheDocument()
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
          selected: true,
          originalSuggestedLedgerIds: ['inbox'],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          lowConfidence: false
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
    expect(screen.queryByRole('button', { name: 'DeepSeek 整理' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('DeepSeek 辅助整理范围')).not.toBeInTheDocument()
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
