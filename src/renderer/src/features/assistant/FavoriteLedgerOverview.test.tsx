import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { FavoriteLedgerOverview } from './FavoriteLedgerOverview'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('FavoriteLedgerOverview', () => {
  afterEach(() => vi.useRealTimers())
  it('shows the copy-preserving reminder in the favorite help and uses an X for deletion mode', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '展开删除模式' })).toHaveTextContent('×')
    const toggle = screen.getByRole('button', { name: '展开收藏夹' })
    expect(toggle).not.toHaveAttribute('title')
    expect(toggle).toHaveAttribute('aria-describedby', 'favorite-ledger-help-tooltip')
    expect(screen.getByRole('tooltip')).toHaveTextContent('小咪提醒：同一个视频可以保存在多个收藏夹里。')
    fireEvent.click(toggle)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByText('小咪提醒：')).toHaveClass('favorite-ledger-panel__sync-hint-title')
    expect(screen.getByText('同一个视频可以保存在多个收藏夹里。整理收藏会把视频复制添加到 bilimi 收藏夹，不会移出原有的普通 B 站收藏夹，主人放心使用吧～（bilimi 收藏夹和分类视频支持删除，但需谨慎操作呦）')).toBeInTheDocument()
  })

  it('uses a darker semantic title for each favorite help paragraph', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi\u00b7\u97f3\u4e50', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByText(/\u81ea\u5b9a\u4e49\u6536\u85cf\u5939\uff1a/)).toHaveClass('favorite-ledger-panel__sync-hint-title')
  })

  it('publishes live enable changes before delayed persistence completes', () => {
    const enabledStates = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'custom', displayName: 'bilimi·自建', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={vi.fn()} onEnabledStateChange={enabledStates} />)

    fireEvent.click(screen.getByRole('button', { name: '移出同步 bilimi·自建' }))
    expect([...enabledStates.mock.calls.at(-1)![0]]).toContainEqual(['custom', false])
  })

  it('reports the deleted recommendation id to its parent coordinator', () => {
    const onDeleteLedger = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'custom-tag-game', displayName: 'bilimi·游戏', keywords: ['游戏'], ruleType: 'tag', enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={onDeleteLedger} />)
    fireEvent.click(screen.getByRole('button', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onDeleteLedger).toHaveBeenCalledWith('custom-tag-game')
  })
  it('waits for active-round rule analysis before persisting and locks only draft mutations', async () => {
    const analysis = deferred<boolean>()
    const analyze = vi.fn((_ledger: unknown) => analysis.promise)
    const cancelAnalysis = vi.fn()
    const save = vi.fn()
    function Harness() {
      const [activeAnalysis, setActiveAnalysis] = useState<null | {
        ledgerId: string
        status: 'running' | 'canceling'
        completedItemCount: number
        totalItemCount: number
      }>(null)
      return <FavoriteLedgerOverview ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: ['旋律'], ruleType: 'keyword', enabled: true, priority: 10, isDefault: false }
      ]} missingLedgerIds={[]} organizationActive onSaveLedgers={save}
        draftRuleAnalysis={activeAnalysis}
        draftRuleAnalysisError={null}
        onAnalyzeLedgerRule={async (ledger) => {
          setActiveAnalysis({ ledgerId: ledger.id, status: 'running', completedItemCount: 128, totalItemCount: 2_000 })
          try { return await analyze(ledger) } finally { setActiveAnalysis(null) }
        }}
        onCancelDraftRuleAnalysis={cancelAnalysis} />
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '旋律 节奏' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
      id: 'music', keywords: ['旋律', '节奏']
    })))
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('正在分析 128 / 2000 条')
    expect(screen.getByRole('progressbar', { name: '收藏夹规则分析进度' })).toHaveAttribute('aria-valuenow', '128')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '新建收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '备册收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '（未保存）音乐' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '（未保存）音乐' }))
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消分析' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '取消分析' }))
    expect(cancelAnalysis).toHaveBeenCalledTimes(1)

    await act(async () => analysis.resolve(true))
    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'music', keywords: ['旋律', '节奏'] })
    ], { deleteDisabled: false }))
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
  })

  it('keeps the edited ledger open and unsaved when active-round analysis does not complete', async () => {
    const save = vi.fn()
    const analyze = vi.fn().mockResolvedValue(false)
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: ['旋律'], ruleType: 'keyword', enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} organizationActive onSaveLedgers={save}
      onAnalyzeLedgerRule={analyze} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '节奏' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1))
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
  })

  it('inserts a dragged ledger above the blue-line target', () => {
    const save = vi.fn()
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? ''
    }
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'first', displayName: 'bilimi·第一', keywords: [], enabled: true, priority: 10, isDefault: false },
      { id: 'second', displayName: 'bilimi·第二', keywords: [], enabled: true, priority: 20, isDefault: false },
      { id: 'third', displayName: 'bilimi·第三', keywords: [], enabled: true, priority: 30, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={save} />)

    const source = screen.getByTestId('favorite-ledger-chip-first')
    const target = screen.getByTestId('favorite-ledger-chip-third')
    fireEvent.dragStart(source.querySelector('button[draggable="true"]')!, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    expect(target).toHaveAttribute('data-drop-position', 'before')
    fireEvent.drop(target, { dataTransfer })

    expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'second', priority: 10 }),
      expect.objectContaining({ id: 'first', priority: 20 }),
      expect.objectContaining({ id: 'third', priority: 30 })
    ], { deleteDisabled: false })
  })

  it('never starts native row dragging from the enabled action button', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'first', displayName: 'bilimi·第一', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={vi.fn()} />)

    const action = screen.getByRole('button', { name: '移出同步 bilimi·第一' })
    const name = screen.getByRole('button', { name: '第一' })
    const row = screen.getByTestId('favorite-ledger-chip-first')
    expect(row).not.toHaveAttribute('draggable', 'true')
    expect(name).toHaveAttribute('draggable', 'true')
    expect(action).toHaveAttribute('draggable', 'false')
    expect(action.closest('[draggable="true"]')).toBeNull()

    const dataTransfer = { effectAllowed: '', setData: vi.fn() }
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer })
    action.dispatchEvent(dragStart)

    expect(dragStart.defaultPrevented).toBe(true)
    expect(dataTransfer.setData).not.toHaveBeenCalled()
    expect(row).not.toHaveAttribute('data-dragging')
  })

  it('opens the requested ledger editor by its stable ID', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi路音乐', keywords: [], enabled: true, priority: 10, isDefault: false },
      { id: 'music-duplicate', displayName: 'bilimi路音乐', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} openLedgerId="music-duplicate" />)

    expect(screen.getByRole('region', { name: '当前收藏夹' })).toHaveAttribute('data-ledger-id', 'music-duplicate')
  })

  it('opens a new ledger editor and centers it for an explicit creation request', async () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      render(<FavoriteLedgerOverview ledgers={[]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} createLedger createLedgerRequestVersion={1} />)

      expect(screen.getByRole('region', { name: '当前收藏夹' })).toHaveTextContent('新建收藏夹')
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' }))
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('brings a requested editor to the effective viewport top once after its layout settles', async () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      render(<FavoriteLedgerOverview ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
      ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} openLedgerId="music" />)

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' }))
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('centers a requested editor when the expanded old-favorites guide follows it', async () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      render(<FavoriteLedgerOverview ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
      ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} openLedgerId="music" hasExpandedOrganizationGuide />)

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' }))
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('positions the same requested editor again after it was closed and re-requested', async () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const view = render(<FavoriteLedgerOverview ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
      ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} openLedgerId="music" />)
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))

      fireEvent.click(screen.getByRole('button', { name: '取消' }))
      expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
      view.rerender(<FavoriteLedgerOverview ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
      ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)
      view.rerender(<FavoriteLedgerOverview ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
      ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} openLedgerId="music" />)

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2))
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('uses one bulk toggle that selects and clears the currently operable ledgers', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true },
      { id: 'custom-tech', displayName: '科技', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={save} />)

    const toggle = screen.getByTestId('favorite-ledger-cancel-all')
    expect(toggle).toHaveTextContent('全选')
    fireEvent.click(toggle)
    expect(save).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'music', enabled: true }),
      expect.objectContaining({ id: 'custom-tech', enabled: true })
    ]), { deleteDisabled: false })

    expect(screen.getByTestId('favorite-ledger-cancel-all')).toHaveTextContent('取消全选')
    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'music', enabled: false }),
      expect.objectContaining({ id: 'custom-tech', enabled: false })
    ]), { deleteDisabled: false })
  })

  it('keeps default ledgers checked and non-cancelable while the default system is enabled', () => {
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled ledgers={[
      { id: 'music', displayName: 'bilimi\u00b7音乐', keywords: [], enabled: false, priority: 10, isDefault: true },
      { id: 'custom-tech', displayName: '科技', keywords: [], enabled: false, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={vi.fn()} />)

    const defaultToggle = screen.getByRole('button', { name: '移出同步 bilimi\u00b7音乐' })
    expect(defaultToggle).toBeDisabled()
    expect(defaultToggle).toHaveAttribute('data-enabled', 'true')
    expect(screen.getByRole('button', { name: '加入同步 科技' })).toBeEnabled()
  })

  it('updates rapid enable clicks immediately and persists only the final state', async () => {
    vi.useFakeTimers()
    const saveEnabled = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi\u00b7\u97f3\u4e50', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={saveEnabled} />)
    const addName = `${String.fromCodePoint(0x52a0, 0x5165, 0x540c, 0x6b65)} bilimi\u00b7\u97f3\u4e50`
    const removeName = `${String.fromCodePoint(0x79fb, 0x51fa, 0x540c, 0x6b65)} bilimi\u00b7\u97f3\u4e50`
    const ledgerName = screen.getByRole('button', { name: '\u97f3\u4e50' })

    expect(ledgerName).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: addName }))
    expect(screen.getByRole('button', { name: removeName })).toHaveAttribute('data-enabled', 'true')
    expect(ledgerName).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: removeName }))
    expect(screen.getByRole('button', { name: addName })).toHaveAttribute('data-enabled', 'false')
    expect(ledgerName).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: addName }))
    expect(screen.getByRole('button', { name: removeName })).toHaveAttribute('data-enabled', 'true')
    expect(ledgerName).toHaveAttribute('aria-pressed', 'true')
    expect(saveEnabled).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(249) })
    expect(saveEnabled).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(saveEnabled).toHaveBeenCalledTimes(1)
    expect(saveEnabled).toHaveBeenCalledWith('music', true)
  })

  it('persists 101 rapid clicks through one narrow final enabled mutation', async () => {
    vi.useFakeTimers()
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={saveEnabled} />)
    const addName = '加入同步 bilimi·音乐'
    const removeName = '移出同步 bilimi·音乐'

    for (let index = 0; index < 101; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: index % 2 === 0 ? addName : removeName }))
    }
    expect(saveEnabled).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(250) })

    expect(saveEnabled).toHaveBeenCalledTimes(1)
    expect(saveEnabled).toHaveBeenCalledWith('music', true)
  })

  it('does not revisit 30k ledger records when one pending toggle flushes', async () => {
    vi.useFakeTimers()
    let reads = 0
    const ledgers = Array.from({ length: 30_000 }, (_, index) => {
      const ledger = { id: `ledger-${index}`, keywords: [], enabled: false, priority: index, isDefault: false } as Record<string, unknown>
      Object.defineProperty(ledger, 'displayName', { enumerable: true, get: () => { reads += 1; return `bilimi·${index}` } })
      return ledger
    })
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    render(<FavoriteLedgerOverview
      ledgers={ledgers as unknown as Parameters<typeof FavoriteLedgerOverview>[0]['ledgers']}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
      onSaveLedgerEnabled={saveEnabled}
    />)
    const readsAfterRender = reads

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·0' }))
    const readsAfterClick = reads
    await act(async () => { vi.advanceTimersByTime(250) })

    expect(readsAfterClick).toBe(readsAfterRender + 1)
    expect(reads).toBe(readsAfterClick)
    expect(saveEnabled).toHaveBeenCalledWith('ledger-0', true)
  })

  it('does not rerender a non-target row for one enable click', () => {
    const firstTitleRead = vi.fn()
    const secondTitleRead = vi.fn()
    const first = { id: 'first', keywords: [], enabled: false, priority: 10, isDefault: false } as Record<string, unknown>
    const second = { id: 'second', keywords: [], enabled: false, priority: 20, isDefault: false } as Record<string, unknown>
    Object.defineProperty(first, 'displayName', { enumerable: true, get: () => { firstTitleRead(); return 'bilimi·第一' } })
    Object.defineProperty(second, 'displayName', { enumerable: true, get: () => { secondTitleRead(); return 'bilimi·第二' } })
    render(<FavoriteLedgerOverview
      ledgers={[first, second] as unknown as Parameters<typeof FavoriteLedgerOverview>[0]['ledgers']}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
      onSaveLedgerEnabled={vi.fn()}
    />)
    const firstReadsBefore = firstTitleRead.mock.calls.length
    const secondReadsBefore = secondTitleRead.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·第一' }))

    expect(firstTitleRead.mock.calls.length).toBeGreaterThan(firstReadsBefore)
    expect(secondTitleRead.mock.calls.length).toBe(secondReadsBefore)
    expect(screen.getByRole('button', { name: '移出同步 bilimi·第一' })).toHaveAttribute('data-enabled', 'true')
  })

  it('flushes one pending final toggle when the overview unmounts', async () => {
    vi.useFakeTimers()
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    const view = render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={saveEnabled} />)

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·音乐' }))
    view.unmount()
    await act(async () => { await Promise.resolve() })

    expect(saveEnabled).toHaveBeenCalledTimes(1)
    expect(saveEnabled).toHaveBeenCalledWith('music', true)
    act(() => { vi.runAllTimers() })
    expect(saveEnabled).toHaveBeenCalledTimes(1)
  })

  it('flushes only the last rapid toggle intent when unmounted before debounce', async () => {
    vi.useFakeTimers()
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    const view = render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={saveEnabled} />)

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '移出同步 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·音乐' }))
    view.unmount()
    await act(async () => { await Promise.resolve() })

    expect(saveEnabled).toHaveBeenCalledTimes(1)
    expect(saveEnabled).toHaveBeenCalledWith('music', true)
  })

  it('does not save when an overview without pending toggle changes unmounts', () => {
    const save = vi.fn()
    const view = render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={save} />)

    view.unmount()

    expect(save).not.toHaveBeenCalled()
  })

  it('keeps accepting clicks while a save is pending and never lets an old failure replace the newer state', async () => {
    vi.useFakeTimers()
    let rejectFirstSave: ((reason?: unknown) => void) | undefined
    const saveEnabled = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirstSave = reject }))
      .mockResolvedValue(undefined)
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi\u00b7\u97f3\u4e50', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={saveEnabled} />)
    const addName = `${String.fromCodePoint(0x52a0, 0x5165, 0x540c, 0x6b65)} bilimi\u00b7\u97f3\u4e50`
    const removeName = `${String.fromCodePoint(0x79fb, 0x51fa, 0x540c, 0x6b65)} bilimi\u00b7\u97f3\u4e50`

    fireEvent.click(screen.getByRole('button', { name: addName }))
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(saveEnabled).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: removeName }))
    expect(screen.getByRole('button', { name: addName })).toHaveAttribute('data-enabled', 'false')
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(saveEnabled).toHaveBeenCalledTimes(1)

    await act(async () => { rejectFirstSave?.(new Error('old write failed')); await Promise.resolve() })
    expect(screen.getByRole('button', { name: addName })).toHaveAttribute('data-enabled', 'false')
    expect(saveEnabled).toHaveBeenCalledTimes(2)
    expect(saveEnabled).toHaveBeenLastCalledWith('music', false)
  })

  it('rolls an enable toggle back when its background save fails', async () => {
    const saveEnabled = vi.fn().mockRejectedValue(new Error('write failed'))
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi\u00b7\u97f3\u4e50', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={saveEnabled} />)
    const actionName = `${String.fromCodePoint(0x52a0, 0x5165, 0x540c, 0x6b65)} bilimi\u00b7\u97f3\u4e50`

    fireEvent.click(screen.getByRole('button', { name: actionName }))
    expect(screen.getByRole('button', { name: `${String.fromCodePoint(0x79fb, 0x51fa, 0x540c, 0x6b65)} bilimi\u00b7\u97f3\u4e50` })).toHaveAttribute('data-enabled', 'true')

    await waitFor(() => expect(screen.getByRole('button', { name: actionName })).toHaveAttribute('data-enabled', 'false'))
  })

  it('keeps required defaults selected when cancel-all clears custom targets during a round', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    render(<FavoriteLedgerOverview
      organizationActive
      ledgers={[
        { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
        { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 20, isDefault: true },
        { id: 'custom-tech', displayName: '科技', keywords: [], enabled: true, priority: 20, isDefault: false }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'knowledge', enabled: true }),
      expect.objectContaining({ id: 'inbox', enabled: true }),
      expect.objectContaining({ id: 'custom-tech', enabled: false })
    ]), { deleteDisabled: false })
    expect(screen.getByRole('button', { name: '移出同步 bilimi·暂存' })).toBeDisabled()
  })

  it('shows disabled and unsaved state in the ledger name while retaining a disabled plus action', () => {
    render(<FavoriteLedgerOverview
      defaultFavoriteSystemEnabled={false}
      ledgers={[{ id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], enabled: true, priority: 10, isDefault: true }]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '（已停用）知识学习' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移出同步 bilimi·知识学习' })).toHaveTextContent('+')
    expect(screen.getByRole('button', { name: '移出同步 bilimi·知识学习' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    expect(screen.getByRole('button', { name: /^（未保存）/ })).toBeInTheDocument()
  })

  it('does not add a pending-sync label to a local recommendation', () => {
    render(<FavoriteLedgerOverview
      ledgers={[{ id: 'recommended-up', displayName: 'bilimi·影视飓风', keywords: ['影视飓风'], enabled: true, priority: 10, isDefault: false, syncState: 'local-draft' }]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '影视飓风' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '（待同步）影视飓风' })).not.toBeInTheDocument()
  })

  it('explains how a recovered remote workspace draft becomes an active rule', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const saveEnabled = vi.fn()
    render(<FavoriteLedgerOverview
      ledgers={[{ id: 'custom-genshin', displayName: '原神', keywords: [], enabled: false, priority: 10, isDefault: false, syncState: 'local-draft', bilibiliFolderId: '42' }]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
      onSaveLedgerEnabled={saveEnabled}
    />)

    expect(screen.getByText(/识别到一个可启用的 bilimi 工作夹/)).toBeInTheDocument()
    expect(screen.getByText(/更换设备.*本地数据迁移/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '（未保存）原神' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加入同步 原神' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '（未保存）原神' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '原神 攻略' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'custom-genshin', enabled: false, bilibiliFolderId: '42', keywords: ['原神', '攻略'] })
    ], { deleteDisabled: false })
    expect(save.mock.calls.at(-1)?.[0][0]).not.toHaveProperty('syncState')
    expect(screen.getByRole('button', { name: '原神' })).toBeInTheDocument()
    save.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '加入同步 原神' }))
    expect(saveEnabled).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(saveEnabled).toHaveBeenLastCalledWith('custom-genshin', true)
  })

  it('restores the last saved rule when an explicit local save fails', async () => {
    let rejectSave!: (reason?: unknown) => void
    const save = vi.fn(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    render(<FavoriteLedgerOverview
      ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: ['old'], enabled: true, priority: 10, isDefault: false }]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: 'new' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await act(async () => { rejectSave(new Error('local write failed')); await Promise.resolve() })

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    expect(screen.getByRole('textbox', { name: '关键词' })).toHaveValue('old')
  })

  it('keeps an edited ledger marked as unsaved after selecting another ledger', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false },
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '摇滚' } })
    fireEvent.click(screen.getByRole('button', { name: '知识' }))

    expect(screen.getByRole('button', { name: '（未保存）音乐' })).toBeInTheDocument()
    expect(screen.getByText('正在编辑：bilimi·知识')).toBeInTheDocument()
  })

  it('keeps a new unsaved ledger open when an equivalent ledger snapshot rerenders', () => {
    const ledgers = [{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]
    const view = render(<FavoriteLedgerOverview ledgers={ledgers} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByRole('textbox', { name: '册名' }), { target: { value: '临时草稿' } })
    view.rerender(<FavoriteLedgerOverview ledgers={ledgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))}
      missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '（未保存）临时草稿' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toHaveTextContent('新建收藏夹bilimi·临时草稿')
  })

  it('collapses the editor when the active ledger card is selected again', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    const card = screen.getByRole('button', { name: '音乐' })
    fireEvent.click(card)
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    fireEvent.click(card)
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
    fireEvent.click(card)
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
  })

  it('persists a cross-row drag reorder as soon as the item is dropped', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'first', displayName: 'First', keywords: [], enabled: true, priority: 10, isDefault: false },
      { id: 'second', displayName: 'Second', keywords: [], enabled: true, priority: 20, isDefault: false },
      { id: 'third', displayName: 'Third', keywords: [], enabled: true, priority: 30, isDefault: false },
      { id: 'fourth', displayName: 'Fourth', keywords: [], enabled: true, priority: 40, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={save} />)

    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'first') }
    const fourthChip = screen.getByTestId('favorite-ledger-chip-fourth')
    fireEvent.dragStart(screen.getByRole('button', { name: 'First' }), { dataTransfer: transfer })
    fireEvent.dragOver(fourthChip, { dataTransfer: transfer, clientY: 36 })
    expect(fourthChip).toHaveAttribute('data-drop-position', 'before')
    fireEvent.drop(fourthChip, { dataTransfer: transfer })
    expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'second', priority: 10 }),
      expect.objectContaining({ id: 'third', priority: 20 }),
      expect.objectContaining({ id: 'first', priority: 30 }),
      expect.objectContaining({ id: 'fourth', priority: 40 })
    ], { deleteDisabled: false })
    expect(Array.from(screen.getByRole('region', { name: '收藏夹' })
      .querySelectorAll('.favorite-ledger-panel__chip-item > button:first-child'))
      .map((button) => button.textContent)).toEqual(['Second', 'Third', 'First', 'Fourth'])
    expect(fourthChip).not.toHaveAttribute('data-drop-position')
    fireEvent.dragEnd(screen.getByTestId('favorite-ledger-chip-first'))
    expect(screen.getByTestId('favorite-ledger-chip-first')).not.toHaveAttribute('data-dragging')
  })

  it('backs up disabled ledgers without previewing them for deletion outside deletion mode', async () => {
    const sync = vi.fn().mockResolvedValue(undefined)
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'music', remoteFolderId: 'remote-music', title: 'bilimi·音乐', memberCount: 3 }
    ])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    expect(screen.queryByRole('button', { name: '检查待删除收藏夹' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    await waitFor(() => expect(sync).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'music', enabled: false })
    ], { deleteDisabled: false }))
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(screen.queryByText('本次同步有 1 个 bilimi 管理的收藏夹需要删除。')).not.toBeInTheDocument()
  })

  it('uses the restored cancel-all action to clear the current selection', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    render(<FavoriteLedgerOverview
      ledgers={[
        { id: 'music', displayName: 'bilimi:音乐', keywords: ['音乐'], ruleType: 'keyword', enabled: true, priority: 10, isDefault: true },
        { id: 'reading', displayName: 'bilimi:阅读', keywords: ['阅读'], ruleType: 'keyword', enabled: true, priority: 20, isDefault: true }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'music', enabled: false }),
      expect.objectContaining({ id: 'reading', enabled: false })
    ]), { deleteDisabled: false })
  })

  it('keeps the legacy collapsed ledger list and its expand toggle', () => {
    const ledgers = Array.from({ length: 16 }, (_, index) => ({
      id: `ledger-${index + 1}`,
      displayName: `bilimi:收藏夹${index + 1}`,
      keywords: [],
      ruleType: 'keyword' as const,
      enabled: true,
      priority: (index + 1) * 10,
      isDefault: false
    }))
    render(<FavoriteLedgerOverview ledgers={ledgers} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '收藏夹16' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(screen.getByRole('button', { name: '收藏夹16' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠' })).toBeInTheDocument()
  })

  it('keeps the ledger list expanded when recommendation drafts refresh the ledgers', () => {
    const ledgers = Array.from({ length: 16 }, (_, index) => ({
      id: `ledger-${index + 1}`,
      displayName: `bilimi:收藏夹${index + 1}`,
      keywords: [],
      ruleType: 'keyword' as const,
      enabled: true,
      priority: (index + 1) * 10,
      isDefault: false
    }))
    const { rerender } = render(<FavoriteLedgerOverview ledgers={ledgers} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开' }))

    rerender(<FavoriteLedgerOverview
      ledgers={[...ledgers, {
        id: 'recommended-up',
        displayName: 'bilimi:推荐 UP',
        keywords: ['推荐 UP'],
        ruleType: 'author',
        enabled: true,
        priority: 170,
        isDefault: false,
        syncState: 'local-draft'
      }]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '折叠' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推荐 UP' })).toBeInTheDocument()
  })

  it('backs up with the user-facing label and resets defaults without dropping custom ledgers', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<FavoriteLedgerOverview
      defaultFavoriteSystemEnabled
      ledgers={[
        { id: 'knowledge', displayName: 'bilimi·旧知识名', keywords: ['旧规则'], enabled: false, priority: 10, isDefault: true },
        { id: 'custom', displayName: 'bilimi·我的分类', keywords: ['自定义'], enabled: true, priority: 20, isDefault: false }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    expect(screen.getByText('备册')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'knowledge', isDefault: true, enabled: true }),
      expect.objectContaining({ id: 'custom', isDefault: false, enabled: false, keywords: ['自定义'] })
    ]), { deleteDisabled: false }))
    expect(screen.getByRole('button', { name: '知识学习' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '我的分类' })).toBeInTheDocument()
    expect(screen.queryByText(/未保存/)).not.toBeInTheDocument()
  })

  it('temporarily clears selections for managed-folder deletion and restores them on cancel', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { readBilibiliAccountMid: vi.fn().mockResolvedValue('100'), previewManagedFavoriteFolderDeletion }
    })
    render(<FavoriteLedgerOverview
      defaultFavoriteSystemEnabled={false}
      ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false, bilibiliFolderId: 'remote-music' },
        { id: 'tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech' }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
      onSyncLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByText('备册'))
    expect(screen.getByRole('button', { name: /展开删除模式/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    expect(screen.getByRole('button', { name: /取消删除模式/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /加入删除 bilimi·音乐/ })).toHaveAttribute('data-enabled', 'false')
    fireEvent.click(screen.getByRole('button', { name: /取消删除模式/ }))
    expect(screen.getByRole('button', { name: /移出同步 bilimi·音乐/ })).toHaveAttribute('data-enabled', 'true')
  })

  it('persists a pending toggle once before deletion mode and restores that selection on cancel', async () => {
    vi.useFakeTimers()
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    render(<FavoriteLedgerOverview
      defaultFavoriteSystemEnabled={false}
      ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: false, bilibiliFolderId: 'remote-music' }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
      onSaveLedgerEnabled={saveEnabled}
      onSyncLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    await act(async () => {})

    expect(saveEnabled).toHaveBeenCalledTimes(1)
    expect(saveEnabled).toHaveBeenCalledWith('music', true)
    expect(screen.getByRole('button', { name: /加入删除 bilimi·音乐/ })).toHaveAttribute('data-enabled', 'false')

    fireEvent.click(screen.getByRole('button', { name: /取消删除模式/ }))
    expect(screen.getByRole('button', { name: '移出同步 bilimi·音乐' })).toHaveAttribute('data-enabled', 'true')
    await act(async () => { vi.runAllTimers() })
    expect(saveEnabled).toHaveBeenCalledTimes(1)
  })

  it('persists the latest single toggle after a pending bulk toggle before deletion mode', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    render(<FavoriteLedgerOverview
      defaultFavoriteSystemEnabled={false}
      ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false, bilibiliFolderId: 'remote-music' },
        { id: 'tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech' }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
      onSaveLedgerEnabled={saveEnabled}
      onSyncLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    await act(async () => {})

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'music', enabled: true }),
      expect.objectContaining({ id: 'tech', enabled: false })
    ], { deleteDisabled: false })
    expect(saveEnabled).not.toHaveBeenCalled()
  })

  it('keeps the latest normal selections when a managed folder is confirmed for deletion', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    const deleteManagedFavoriteFolders = vi.fn().mockResolvedValue([
      { id: 'remote-tech', title: 'bilimi·科技', memberCount: 2 }
    ])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'tech', remoteFolderId: 'remote-tech', title: 'bilimi·科技', memberCount: 2 }
        ]),
        deleteManagedFavoriteFolders
      }
    })
    render(<FavoriteLedgerOverview
      defaultFavoriteSystemEnabled={false}
      ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: false, bilibiliFolderId: 'remote-music' },
        { id: 'tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech' }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
      onSaveLedgerEnabled={saveEnabled}
      onSyncLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·科技' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    fireEvent.click(await screen.findByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedFavoriteFolders).toHaveBeenCalledWith('100', ['tech']))
    expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'music', enabled: true })
    ], { deleteDisabled: false })
  })

  it('keeps default rules unbound, removes custom rules, and writes only after confirmed remote deletion', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const deleteManagedFavoriteFolders = vi.fn().mockResolvedValue([
      { id: 'remote-knowledge', title: 'bilimi·知识', memberCount: 1 },
      { id: 'remote-tech', title: 'bilimi·科技', memberCount: 2 }
    ])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'knowledge', remoteFolderId: 'remote-knowledge', title: 'bilimi·知识', memberCount: 1 },
          { logicalLedgerId: 'custom-tech', remoteFolderId: 'remote-tech', title: 'bilimi·科技', memberCount: 2 }
        ]),
        deleteManagedFavoriteFolders
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true, bilibiliFolderId: 'remote-knowledge' },
      { id: 'custom-tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech' }
    ]} missingLedgerIds={[]} onSaveLedgers={save} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·知识' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·科技' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    fireEvent.click(await screen.findByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedFavoriteFolders).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'knowledge', enabled: false, isDefault: true })
    ], { deleteDisabled: false })
    expect(save.mock.calls.at(-1)?.[0][0]).not.toHaveProperty('bilibiliFolderId')
    expect(save.mock.calls.at(-1)?.[0]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-tech' })
    ]))
  })

  it('does not rewrite rules when remote deletion result is unknown', async () => {
    const save = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'custom-tech', remoteFolderId: 'remote-tech', title: 'bilimi·科技', memberCount: 1 }
        ]),
        deleteManagedFavoriteFolders: vi.fn().mockResolvedValue({ status: 'result-unknown' })
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[
      { id: 'custom-tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 10, isDefault: false, bilibiliFolderId: 'remote-tech' }
    ]} missingLedgerIds={[]} onSaveLedgers={save} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·科技' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    fireEvent.click(await screen.findByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('删除结果尚未确认')
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the deletion confirmation open and explains a remote deletion failure', async () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'tech', remoteFolderId: 'remote-tech', title: 'bilimi·科技', memberCount: 2 }
        ]),
        deleteManagedFavoriteFolders: vi.fn().mockRejectedValue(new Error('page target is unavailable'))
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[
      { id: 'tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech' }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·科技' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    fireEvent.click(await screen.findByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法连接当前 B 站页面，请保持已登录页面打开后重试。')
    expect(screen.getByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).toBeInTheDocument()
  })
})
