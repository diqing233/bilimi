import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { createDefaultFavoriteLedgers } from '../../../../shared/favoriteLedgers'
import { FavoriteLedgerOverview } from './FavoriteLedgerOverview'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('FavoriteLedgerOverview', () => {

  it('keeps a signed-out local toggle limited to a saved unbacked custom ledger', () => {
    render(<FavoriteLedgerOverview
      currentAccountMid=""
      localFavoriteToggleAccountMid="100"
      defaultFavoriteSystemEnabled
      ledgers={[
        { id: 'custom-unbacked', displayName: 'bilimi·本地', keywords: [], enabled: false, priority: 10, isDefault: false, ruleOrigin: 'saved-rule', bindingState: 'unbacked' },
        { id: 'default', displayName: 'bilimi·默认', keywords: [], enabled: true, priority: 20, isDefault: true },
        { id: 'bound-custom', displayName: 'bilimi·已备', keywords: [], enabled: true, priority: 30, isDefault: false, ruleOrigin: 'saved-rule', bindingState: 'bound', bilibiliFolderId: '9' }
      ]}
      missingLedgerIds={['custom-unbacked']}
      onSaveLedgers={vi.fn()}
      onSaveLedgerEnabled={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '加入同步 bilimi·本地' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '移出同步 bilimi·默认' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '移出同步 bilimi·已备' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '新建收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '备册收藏夹' })).toBeDisabled()
  })
  it.each([
    ['keyword', '关键词', '多个关键词可用顿号、空格、逗号、斜杠或换行分隔。建议优先填写 B 站标签里的词；标签命中权重最高，标题、分区、简介等信息会辅助判断。'],
    ['author', 'UP 名字', '多个 UP 名可用顿号、空格、逗号、斜杠或换行分隔。填写一个或多个 UP 名，命中作者时会优先存入这个收藏夹。'],
    ['tag', '标签', '多个 B 站标签可用顿号、空格、逗号、斜杠或换行分隔。填写一个或多个 B 站标签，命中标签时会优先存入这个收藏夹。']
  ] as const)('explains separators for %s ledger rules', (ruleType, label, hint) => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: ruleType, displayName: `bilimi·${label}`, keywords: [], ruleType, enabled: false, priority: 10, isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  it('keeps the DeepSeek ledger hint as a natural-language instruction', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'deepseek', displayName: 'bilimi·DeepSeek', keywords: [], ruleType: 'deepseek', enabled: false, priority: 10, isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek' }))
    expect(screen.getByText('填写自然语言判断规则。此类型不参与本地自动分类，必须开启 DeepSeek 后才会用于辅助判断。')).toBeInTheDocument()
    expect(screen.queryByText(/多个.*可用顿号、空格、逗号、斜杠或换行分隔/)).not.toBeInTheDocument()
  })

  afterEach(() => vi.useRealTimers())
  it('remeasures sidebar help after the hidden tooltip becomes visible', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx'), 'utf8')

    expect(source).toContain('}, [ledgerHintVisible])')
    expect(source).toContain('resizeObserver?.observe(ledgerHintPanelRef.current)')
  })

  it('keeps the favorite help tooltip after clicking and uses an X for deletion mode', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '展开删除模式' })).toHaveTextContent('×')
    const toggle = screen.getByRole('button', { name: '固定显示收藏夹说明' })
    expect(toggle).not.toHaveAttribute('title')
    expect(toggle).toHaveAttribute('aria-describedby', 'favorite-ledger-help-tooltip')
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('小咪提醒：同一个视频可以保存在多个收藏夹里。')
    expect(tooltip).toHaveTextContent('默认收藏夹不可删除。')
    expect(tooltip).not.toHaveTextContent('按确认范围处理对应的收藏库工作夹')
    expect(tooltip.parentElement).toBe(document.body)
    fireEvent.click(toggle)
    expect(screen.getByRole('tooltip')).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('starts with the favorite card list expanded and folds it to three rows', () => {
    render(<FavoriteLedgerOverview ledgers={Array.from({ length: 16 }, (_, index) => ({
      id: `ledger-${index}`, displayName: `bilimi·收藏夹${index}`, keywords: [], enabled: true, priority: index, isDefault: false
    }))} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '折叠' })).toBeInTheDocument()
    expect(screen.getAllByTestId(/favorite-ledger-chip-/)).toHaveLength(16)
    fireEvent.click(screen.getByRole('button', { name: '折叠' }))
    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument()
    expect(screen.getAllByTestId(/favorite-ledger-chip-/)).toHaveLength(9)
  })

  it('keeps existing folder positions when an external update appends a recommendation', async () => {
    const baseLedgers = ['A', 'B', 'C'].map((name, index) => ({
      id: name.toLowerCase(), displayName: `bilimi路${name}`, keywords: [], enabled: true,
      priority: (index + 1) * 10, isDefault: false
    }))
    const view = render(<FavoriteLedgerOverview ledgers={baseLedgers} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    view.rerender(<FavoriteLedgerOverview ledgers={[
      baseLedgers[0]!, baseLedgers[2]!, baseLedgers[1]!,
      { id: 'recommended', displayName: 'bilimi路Recommended', keywords: [], enabled: true, priority: 10_000, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByTestId(/favorite-ledger-chip-/).map((node) => node.dataset.testid))
      .toEqual(['favorite-ledger-chip-a', 'favorite-ledger-chip-b', 'favorite-ledger-chip-c', 'favorite-ledger-chip-recommended']))
  })

  it('keeps a just-saved local rule until the parent acknowledges its stable id', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true })
    const view = render(<FavoriteLedgerOverview ledgers={[]} missingLedgerIds={[]} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '本地新建' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ displayName: 'bilimi·本地新建' })
    ], { deleteDisabled: false }))
    const savedLedger = save.mock.calls[0]![0][0]

    view.rerender(<FavoriteLedgerOverview ledgers={[{
      id: 'other', displayName: 'bilimi·其他', keywords: [], enabled: true, priority: 10, isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={save} />)

    expect(screen.getByTestId(`favorite-ledger-chip-${savedLedger.id}`)).toBeInTheDocument()

    view.rerender(<FavoriteLedgerOverview ledgers={[savedLedger]} missingLedgerIds={[]} onSaveLedgers={save} />)
    await waitFor(() => expect(screen.getByTestId(`favorite-ledger-chip-${savedLedger.id}`)).toBeInTheDocument())
  })

  it('keeps a newly saved rule when the parent snapshot updates before save resolves', async () => {
    let releaseSave!: () => void
    const existingLedger: FavoriteLedger = {
      id: 'existing', displayName: 'bilimi·已有', keywords: [], enabled: true, priority: 10, isDefault: false
    }
    const staleLedger: FavoriteLedger = {
      id: 'stale', displayName: 'bilimi·过渡', keywords: [], enabled: false, priority: 20, isDefault: false
    }
    let parentLedgers: FavoriteLedger[] = [existingLedger, staleLedger]
    const save = vi.fn((_nextLedgers: FavoriteLedger[]) => {
      // The parent may publish an intermediate account/workspace projection
      // before the persistence command resolves.
      parentLedgers = [existingLedger]
      return new Promise<{ ok: true }>((resolve) => {
        releaseSave = () => resolve({ ok: true })
      })
    })
    const view = render(<FavoriteLedgerOverview ledgers={parentLedgers} missingLedgerIds={[]} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '补取期间新建' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalled())

    view.rerender(<FavoriteLedgerOverview ledgers={[existingLedger]} missingLedgerIds={[]} onSaveLedgers={save} />)
    const savedLedger = save.mock.calls[0]![0].find((ledger) => ledger.displayName.includes('补取期间新建'))
    expect(savedLedger).toBeDefined()
    await waitFor(() => expect(screen.getByTestId(`favorite-ledger-chip-${savedLedger!.id}`)).toBeInTheDocument())
    expect(screen.queryByTestId('favorite-ledger-chip-stale')).not.toBeInTheDocument()
    releaseSave()
    await waitFor(() => expect(screen.getByText('补取期间新建')).toBeInTheDocument())
  })

  it('keeps same-named folders saveable, labels each copy, and shows the video count only while editing', () => {
    render(<FavoriteLedgerOverview ledgers={[
      {
        id: 'same-1', displayName: 'bilimi·Same', keywords: [], enabled: false, priority: 10,
        bilibiliFolderVideoCount: 12, isDefault: false
      },
      {
        id: 'same-2', displayName: 'bilimi·Same', keywords: [], enabled: false, priority: 20,
        bilibiliFolderVideoCount: 4, isDefault: false
      }
    ]} missingLedgerIds={[]} openLedgerId="same-1" onSaveLedgers={vi.fn()} />)

    expect(screen.getByTestId('favorite-ledger-chip-same-1')).toHaveTextContent('Same①')
    expect(screen.getByTestId('favorite-ledger-chip-same-1')).not.toHaveTextContent('12 个视频')
    expect(screen.getByTestId('favorite-ledger-chip-same-2')).toHaveTextContent('Same②')
    expect(screen.getByTestId('favorite-ledger-chip-same-2')).not.toHaveTextContent('4 个视频')
    expect(screen.getByRole('region', { name: '当前收藏夹' }).querySelector('.favorite-ledger-panel__ledger-name-label')).toHaveTextContent('12 个视频')
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(screen.queryByText('收藏夹名称不能重复')).not.toBeInTheDocument()
  })

  it('summarizes every explicitly bound Bilibili folder while editing one logical ledger', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi\u00b7游戏专区', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: 'game-1', bilibiliFolderIds: ['game-1', 'game-2'], bilibiliFolderVideoCount: 1247,
      bindingState: 'bound', isDefault: false
    }]} missingLedgerIds={[]} openLedgerId="game" onSaveLedgers={vi.fn()} />)

    expect(screen.getByText('B站绑定：2 个收藏夹，共 1247 个视频')).toBeInTheDocument()
  })

  it('does not count a pending extra shard as a formal Bilibili binding', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: 'game-2', bilibiliFolderIds: ['game-1', 'game-2'], bilibiliFolderVideoCount: 1000,
      bindingState: 'bound', pendingRemoteBinding: true, isDefault: false
    } as any]} missingLedgerIds={[]} openLedgerId="game" onSaveLedgers={vi.fn()} />)

    expect(screen.getByText('B站绑定：1 个收藏夹，共 1000 个视频')).toBeInTheDocument()
    expect(screen.getByText('新增分区待确认绑定')).toBeInTheDocument()
  })

  it('uses a darker semantic title for each favorite help paragraph', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi\u00b7\u97f3\u4e50', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByText(/\u81ea\u5b9a\u4e49\u6536\u85cf\u5939\uff1a/)).toHaveClass('favorite-ledger-panel__help-tooltip-title')
  })

  it('keeps the missing-backup warning visible when a paused workspace exists but the guide is closed', () => {
    const props = {
      ledgers: [{ id: 'music', displayName: 'bilimi\u00b7\u97f3\u4e50', keywords: [], enabled: true, priority: 10, isDefault: false }],
      missingLedgerIds: ['music'],
      onSaveLedgers: vi.fn()
    }
    const view = render(<FavoriteLedgerOverview {...props} organizationActive />)

    expect(screen.getByText('部分 Bilimi 收藏夹尚未备册。')).toBeInTheDocument()

    view.rerender(<FavoriteLedgerOverview {...props} organizationActive={false} />)
    expect(screen.getByText('部分 Bilimi 收藏夹尚未备册。')).toBeInTheDocument()
  })

  it('hides the missing-backup warning while the organize guide is open', () => {
    render(<FavoriteLedgerOverview
      ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], priority: 10, enabled: true, isDefault: false }]}
      missingLedgerIds={['music']}
      hasExpandedOrganizationGuide
      onSaveLedgers={vi.fn()}
    />)

    expect(screen.queryByText('部分 Bilimi 收藏夹尚未备册。')).not.toBeInTheDocument()
  })

  it('hides an unbacked default card but keeps the real status visible in detail while organizing', () => {
    const props = {
      ledgers: [{
        id: 'default', displayName: 'bilimi·默认', keywords: [], enabled: true, priority: 10,
        bindingState: 'unbacked' as const, isDefault: true
      }],
      missingLedgerIds: ['default'],
      organizationActive: true,
      onSaveLedgers: vi.fn()
    }
    const view = render(<FavoriteLedgerOverview {...props} />)

    expect(screen.getByTestId('favorite-ledger-chip-default')).toHaveTextContent('未备册')
    fireEvent.click(screen.getByRole('button', { name: '默认' }))

    view.rerender(<FavoriteLedgerOverview {...props} hasExpandedOrganizationGuide />)

    expect(screen.getByTestId('favorite-ledger-chip-default')).not.toHaveTextContent('未备册')
    expect(screen.getByRole('region', { name: '当前收藏夹' })
      .querySelector('.favorite-ledger-panel__binding-status')).toHaveTextContent('未备册')

    view.rerender(<FavoriteLedgerOverview {...props} organizationActive={false} hasExpandedOrganizationGuide={false} />)
    expect(screen.getByTestId('favorite-ledger-chip-default')).toHaveTextContent('未备册')
    expect(screen.getByRole('region', { name: '当前收藏夹' })
      .querySelector('.favorite-ledger-panel__binding-status')).toHaveTextContent('未备册')
  })

  it('keeps the actual backup state in a requested detail editor while organizing', async () => {
    const initialLedger = {
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      bindingState: 'bound' as const, bilibiliFolderId: 'remote-music', isDefault: false
    }
    const props = {
      ledgers: [initialLedger],
      missingLedgerIds: [],
      organizationActive: true,
      hasExpandedOrganizationGuide: true,
      openLedgerId: 'music',
      openLedgerRequestVersion: 1,
      onSaveLedgers: vi.fn()
    }
    const view = render(<FavoriteLedgerOverview {...props} />)

    const editor = await waitFor(() => screen.getByRole('region', { name: '当前收藏夹' }))
    expect(editor.querySelector('.favorite-ledger-panel__binding-status')).toHaveTextContent('已备册')
    expect(screen.getByTestId('favorite-ledger-chip-music')).not.toHaveTextContent('已备册')

    view.rerender(<FavoriteLedgerOverview {...props} ledgers={[{ ...props.ledgers[0], bilibiliFolderTitle: 'bilimi·音乐（远端）' }]} />)
    await waitFor(() => expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument())
    expect(screen.getByRole('region', { name: '当前收藏夹' })
      .querySelector('.favorite-ledger-panel__binding-status')).toHaveTextContent('已备册')
  })

  it('shows the remote-only binding reminder beside the editor status with one dismissal action', () => {
    const onDismiss = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom-remote-hello', displayName: 'bilimi\u00b7\u4f60\u597d', keywords: [], enabled: false, priority: 20_000,
      bilibiliFolderId: '88', bindingState: 'unbound', syncState: 'local-draft', isDefault: false
    }]} missingLedgerIds={[]} remoteOnlyDraftLedgerIds={['custom-remote-hello']} onDismissRemoteDraftReminder={onDismiss} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '你好' }))
    expect(screen.getByText(/\u53d1\u73b0 B \u7ad9\u7591\u4f3c.*\u672c\u5730\u5c1a\u672a\u5efa\u7acb\u7ed1\u5b9a/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '\u4e0d\u518d\u63d0\u9192' }))
    expect(onDismiss).toHaveBeenCalledWith('custom-remote-hello', ['88'])
  })

  it('publishes live enable changes before delayed persistence completes', () => {
    const enabledStates = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'custom', displayName: 'bilimi·自建', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={vi.fn()} onEnabledStateChange={enabledStates} />)

    fireEvent.click(screen.getByRole('button', { name: '移出同步 bilimi·自建' }))
    expect([...enabledStates.mock.calls.at(-1)![0]]).toContainEqual(['custom', false])
  })

  it('does not republish unchanged enabled state when the parent callback identity changes', async () => {
    const notifications: ReadonlyMap<string, boolean>[] = []
    function Host() {
      const [rerendered, setRerendered] = useState(false)
      return <>
        <output data-testid="enabled-callback-host">{rerendered ? 'rerendered' : 'initial'}</output>
        <FavoriteLedgerOverview ledgers={[
          { id: 'custom', displayName: 'bilimi·自建', keywords: [], enabled: true, priority: 10, isDefault: false }
        ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onEnabledStateChange={(enabledById) => {
          notifications.push(enabledById)
          if (!rerendered) setRerendered(true)
        }} />
      </>
    }

    render(<Host />)

    await waitFor(() => expect(screen.getByTestId('enabled-callback-host')).toHaveTextContent('rerendered'))
    expect(notifications).toHaveLength(1)
    expect([...notifications[0]!]).toEqual([['custom', true]])
  })

  it('deletes a persisted remote draft through the draft-only path without entering managed deletion', async () => {
    const deleteFavoriteLedgerDraft = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerId: 'remote-draft' })
    const save = vi.fn()
    const sync = vi.fn()
    const dismiss = vi.fn()
    const onDeleteLedger = vi.fn()
    const previewManagedFavoriteFolderDeletion = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgerDraft,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      {
        id: 'remote-draft', displayName: 'bilimi·远端草稿', keywords: [], enabled: false, priority: 10,
        bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'unbound', syncState: 'local-draft', isDefault: false
      },
      {
        id: 'other-draft', displayName: 'bilimi·其他草稿', keywords: [], enabled: false, priority: 20,
        syncState: 'local-draft', isDefault: false
      },
      { id: 'saved', displayName: 'bilimi·已保存', keywords: [], enabled: true, priority: 30, isDefault: false }
    ]} missingLedgerIds={[]} remoteOnlyDraftLedgerIds={['remote-draft']} onDismissRemoteDraftReminder={dismiss}
      onSaveLedgers={save} onSyncLedgers={sync} onDeleteLedger={onDeleteLedger} />)

    fireEvent.click(screen.getByRole('button', { name: '远端草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgerDraft).toHaveBeenCalledWith('100', 'remote-draft'))
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '远端草稿' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '其他草稿' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已保存' })).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(dismiss).not.toHaveBeenCalled()
    expect(onDeleteLedger).toHaveBeenCalledWith('remote-draft')
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
  })

  it('deletes a newly created local draft without persisting or calling the managed-folder path', () => {
    const save = vi.fn()
    const sync = vi.fn()
    const onDeleteLedger = vi.fn()
    const deleteFavoriteLedgerDraft = vi.fn()
    const previewManagedFavoriteFolderDeletion = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgerDraft,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[]} missingLedgerIds={[]} onSaveLedgers={save} onSyncLedgers={sync}
      onDeleteLedger={onDeleteLedger} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByTestId(/favorite-ledger-chip-new-ledger-/)).not.toBeInTheDocument()
    expect(deleteFavoriteLedgerDraft).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(onDeleteLedger).not.toHaveBeenCalled()
  })

  it('deletes a transient local draft after another folder is opened without using managed deletion', () => {
    const save = vi.fn()
    const sync = vi.fn()
    const onDeleteLedger = vi.fn()
    const deleteFavoriteLedgerDraft = vi.fn()
    const previewManagedFavoriteFolderDeletion = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgerDraft,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'saved', displayName: 'bilimi·已保存', keywords: [], enabled: true, priority: 10, isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={save} onSyncLedgers={sync} onDeleteLedger={onDeleteLedger} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByRole('textbox', { name: '册名' }), { target: { value: '临时草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '已保存' }))
    fireEvent.click(screen.getByRole('button', { name: '临时草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(screen.queryByRole('button', { name: '临时草稿' })).not.toBeInTheDocument()
    expect(deleteFavoriteLedgerDraft).not.toHaveBeenCalled()
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(onDeleteLedger).not.toHaveBeenCalled()
  })

  it('keeps a remote draft when draft deletion is rejected and shows the existing failure notice', async () => {
    const deleteFavoriteLedgerDraft = vi.fn().mockRejectedValue(new Error('draft delete failed'))
    const onDeleteLedger = vi.fn()
    const save = vi.fn()
    const sync = vi.fn()
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([{
      logicalLedgerId: 'remote-draft-failure', remoteFolderId: '89', title: 'bilimi·删除失败草稿', memberCount: 0,
      state: 'unbound-name-match', requiresUnboundAcknowledgement: true
    }])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgerDraft,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'remote-draft-failure', displayName: 'bilimi·删除失败草稿', keywords: [], enabled: false, priority: 10,
      bilibiliFolderId: '89', bilibiliFolderIds: ['89'], bindingState: 'unbound', syncState: 'local-draft', isDefault: false
    }]} missingLedgerIds={[]} remoteOnlyDraftLedgerIds={['remote-draft-failure']}
      onSaveLedgers={save} onSyncLedgers={sync} onDeleteLedger={onDeleteLedger} />)

    fireEvent.click(screen.getByRole('button', { name: '删除失败草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgerDraft).toHaveBeenCalledWith('100', 'remote-draft-failure'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('删除未成功，请稍后重试。'))
    expect(screen.getByRole('button', { name: '删除失败草稿' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    expect(onDeleteLedger).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
  })

  it('deletes a persisted local recommendation through local configuration deletion', async () => {
    const deleteFavoriteLedgerDraft = vi.fn()
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-up'] })
    const previewManagedFavoriteFolderDeletion = vi.fn()
    const onDeleteLedger = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgerDraft,
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'recommended-up', displayName: 'bilimi·推荐 UP', keywords: ['推荐 UP'], enabled: true, priority: 10,
      syncState: 'local-draft', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={onDeleteLedger} />)

    fireEvent.click(screen.getByRole('button', { name: '推荐 UP' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-up']))
    expect(deleteFavoriteLedgerDraft).not.toHaveBeenCalled()
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
    expect(onDeleteLedger).toHaveBeenCalledWith('recommended-up')
  })

  it('routes a bound recommendation detail deletion through the existing managed deletion plan', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-bound'] })
    const provisionOldFavoriteWorkspaceBilibiliExecutionPreflightShardsV1 = vi.fn()
    const releaseDefaultFavoriteLedgerBindings = vi.fn()
    const deleteManagedRemoteFolders = vi.fn()
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([{
      logicalLedgerId: 'recommended-bound', remoteFolderId: 'remote-recommended-bound', title: 'bilimi·已备册推荐', memberCount: 0,
      state: 'bound', requiresUnboundAcknowledgement: false
    }])
    const onOrganizationRecommendationToggle = vi.fn(() => true)
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        provisionOldFavoriteWorkspaceBilibiliExecutionPreflightShardsV1,
        releaseDefaultFavoriteLedgerBindings,
        deleteManagedRemoteFolders,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'recommended-bound', displayName: 'bilimi·已备册推荐', keywords: ['已备册推荐'], ruleType: 'keyword',
      enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'bound', bilibiliFolderId: 'remote-recommended-bound', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()}
      organizationRecommendationEnabledById={new Map([['recommended-bound', true]])}
      onOrganizationRecommendationToggle={onOrganizationRecommendationToggle} />)

    fireEvent.click(screen.getByRole('button', { name: '已备册推荐' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(dialog).toHaveTextContent('bilimi·已备册推荐')
    expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalledWith('100', ['recommended-bound'], {
      'recommended-bound': 'bilimi·已备册推荐'
    })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-bound']))
    expect(onOrganizationRecommendationToggle).not.toHaveBeenCalled()
    expect(provisionOldFavoriteWorkspaceBilibiliExecutionPreflightShardsV1).not.toHaveBeenCalled()
    expect(releaseDefaultFavoriteLedgerBindings).not.toHaveBeenCalled()
    expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalledOnce()
    expect(deleteManagedRemoteFolders).not.toHaveBeenCalled()
  })

  it('uses the existing exact B站 deletion confirmation before locally deleting a bound recommendation rule', async () => {
    const remoteFolderId = 'remote-recommended-delete'
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-delete-bilibili'] })
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: [remoteFolderId], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([{
      logicalLedgerId: 'recommended-delete-bilibili', remoteFolderId, title: 'bilimi·远端删除推荐', memberCount: 0,
      state: 'bound', requiresUnboundAcknowledgement: false
    }])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        deleteManagedRemoteFolders,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'recommended-delete-bilibili', displayName: 'bilimi·远端删除推荐', keywords: [], ruleType: 'keyword',
      enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'bound', bilibiliFolderId: remoteFolderId, isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '远端删除推荐' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledWith(
      '100', ['recommended-delete-bilibili'], false,
      { 'recommended-delete-bilibili': 'bilimi·远端删除推荐' },
      { 'recommended-delete-bilibili': [remoteFolderId] }
    ))
    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-delete-bilibili']))
  })

  it('keeps a confirmed local deletion successful when the parent refresh callback fails', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-refresh-failure'] })
    const onDeleteLedger = vi.fn().mockRejectedValue(new Error('parent refresh failed'))
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'recommended-refresh-failure', displayName: 'bilimi·刷新失败推荐', keywords: ['刷新失败推荐'], enabled: true, priority: 10,
      ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={onDeleteLedger} />)

    fireEvent.click(screen.getByRole('button', { name: '刷新失败推荐' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-refresh-failure']))
    await waitFor(() => expect(screen.queryByRole('button', { name: '刷新失败推荐' })).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps recommendation save ordering ahead of the parent snapshot callback', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx'), 'utf8')
    const registration = source.indexOf('awaitingParentLedgerIdsRef.current.add(savingLedgerId)')
    const saveCall = source.indexOf('const result = await onSaveLedgers(next, { deleteDisabled: false })')
    expect(registration).toBeGreaterThan(-1)
    expect(saveCall).toBeGreaterThan(-1)
    expect(registration).toBeLessThan(saveCall)
  })

  it('routes a selected bound recommendation in deletion mode through the existing managed deletion plan', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-bound-delete-mode'] })
    const onOrganizationRecommendationToggle = vi.fn(() => true)
    const deleteManagedRemoteFolders = vi.fn()
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([{
      logicalLedgerId: 'recommended-bound-delete-mode', remoteFolderId: 'remote-recommendation', title: 'bilimi·已备册推荐', memberCount: 0,
      state: 'bound', requiresUnboundAcknowledgement: false
    }])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        deleteManagedRemoteFolders,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'recommended-bound-delete-mode', displayName: 'bilimi·已备册推荐', keywords: ['已备册推荐'], ruleType: 'keyword',
      enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'bound', bilibiliFolderId: 'remote-recommendation', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()}
      organizationRecommendationEnabledById={new Map([['recommended-bound-delete-mode', true]])}
      onOrganizationRecommendationToggle={onOrganizationRecommendationToggle} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·已备册推荐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(dialog).toHaveTextContent('bilimi·已备册推荐')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-bound-delete-mode']))
    expect(onOrganizationRecommendationToggle).not.toHaveBeenCalled()
    expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalledWith('100', ['recommended-bound-delete-mode'], {
      'recommended-bound-delete-mode': 'bilimi·已备册推荐'
    })
    expect(deleteManagedRemoteFolders).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '已备册推荐' })).not.toBeInTheDocument()
  })

  it('keeps deletion mode open when local recommendation deletion fails', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockRejectedValue(new Error('local deletion failed'))
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'recommended-failed', displayName: 'bilimi·失败推荐', keywords: ['失败推荐'], ruleType: 'keyword',
      enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·失败推荐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-failed']))
    expect(screen.getByRole('button', { name: /取消删除模式/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('B 站已删除，本地状态待保存，请刷新或重试。')
  })

  it('deletes every selected recommendation locally in bulk without remote deletion', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-missing', 'recommended-unbound-mixed'] })
    const onOrganizationRecommendationToggle = vi.fn(() => true)
    const onDeleteLedger = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'recommended-missing', displayName: 'bilimi·未备册推荐', keywords: ['未备册推荐'], ruleType: 'keyword', enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false },
      { id: 'recommended-unbound-mixed', displayName: 'bilimi·未绑定推荐', keywords: ['未绑定推荐'], ruleType: 'keyword', enabled: true, priority: 20, ruleOrigin: 'recommendation-draft', bindingState: 'unbound', isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={onDeleteLedger}
      organizationRecommendationEnabledById={new Map([['recommended-missing', true], ['recommended-unbound-mixed', true]])}
      onOrganizationRecommendationToggle={onOrganizationRecommendationToggle} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·未备册推荐' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·未绑定推荐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(onOrganizationRecommendationToggle).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-missing', 'recommended-unbound-mixed']))
    expect(onOrganizationRecommendationToggle).not.toHaveBeenCalled()
    expect(onDeleteLedger).toHaveBeenCalledWith('recommended-missing')
    expect(onDeleteLedger).toHaveBeenCalledWith('recommended-unbound-mixed')
    expect(screen.queryByRole('button', { name: '未备册推荐' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未绑定推荐' })).not.toBeInTheDocument()
  })

  it('waits for unbacked recommendation local deletion before leaving deletion mode', async () => {
    const cleanup = deferred<boolean>()
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'recommended-unbacked', displayName: 'bilimi·未备册推荐', keywords: ['未备册推荐'], ruleType: 'keyword',
      enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal: vi.fn(() => cleanup.promise.then(() => ({ status: 'succeeded', ledgerIds: ['recommended-unbacked'] })))
      }
    })

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·未备册推荐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    expect(screen.getByRole('button', { name: '取消删除模式' })).toBeInTheDocument()
    await act(async () => cleanup.resolve(true))
    await waitFor(() => expect(screen.getByRole('button', { name: '展开删除模式' })).toBeInTheDocument())
  })

  it('keeps a saved custom ledger when local configuration deletion fails', async () => {
    const onDeleteLedger = vi.fn()
    const deleteFavoriteLedgersLocal = vi.fn().mockRejectedValue(new Error('local delete failed'))
    const previewManagedFavoriteFolderDeletion = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'custom-tag-game', displayName: 'bilimi·游戏', keywords: ['游戏'], ruleType: 'tag', enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={onDeleteLedger} />)
    fireEvent.click(screen.getByRole('button', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('删除未成功，请稍后重试。'))
    expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['custom-tag-game'])
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(onDeleteLedger).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '游戏' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
  })
  it('allows default ledgers only in the right-side deletion selection', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏', keywords: ['游戏'], enabled: true, priority: 1, isDefault: true
    }, {
      id: 'custom', displayName: 'bilimi·自建', keywords: ['自建'], enabled: true, priority: 2, isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))

    expect(screen.getByRole('button', { name: '加入删除 bilimi·游戏' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '加入删除 bilimi·自建' })).toBeEnabled()
  })

  it('releases a default physical binding before persisting a local-only reset', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'music', remoteFolderId: 'remote-music', title: 'bilimi·音乐', memberCount: 12, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const releaseDefaultFavoriteLedgerBindings = vi.fn().mockResolvedValue({
      status: 'succeeded', ledgerIds: ['music'], remoteFolderIds: ['remote-music']
    })
    const save = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        releaseDefaultFavoriteLedgerBindings
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: ['音乐'], enabled: true, priority: 10,
      bilibiliFolderId: 'remote-music', bilibiliFolderIds: ['remote-music'], bindingState: 'bound', isDefault: true
    }]} missingLedgerIds={[]} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(releaseDefaultFavoriteLedgerBindings).toHaveBeenCalledWith('100', ['music']))
    expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'music', bindingState: 'unbound', managedFolderDeletedByUser: true })
    ], { deleteDisabled: false })
  })

  it('offers a Bilibili scope for a saved custom ledger without deleting its library folder', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'custom', remoteFolderId: '9', title: 'bilimi\u00b7自建', memberCount: 12, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'custom', remoteFolderId: '9', title: 'bilimi\u00b7自建', memberCount: 12, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['custom'] })
    const deleteFavoriteLibraryManagedFoldersLocal = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders,
        deleteFavoriteLedgersLocal,
        deleteFavoriteLibraryManagedFoldersLocal
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom', displayName: 'bilimi\u00b7自建', keywords: ['自建'], enabled: true, priority: 10,
      bilibiliFolderId: '9', bilibiliFolderIds: ['9'], bilibiliFolderTitle: 'bilimi\u00b7自建', bindingState: 'bound', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·自建' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(screen.getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledWith(
      '100', ['custom'], false, { custom: 'bilimi·自建' }, { custom: ['9'] }
    ))
    expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['custom'])
    expect(deleteFavoriteLibraryManagedFoldersLocal).not.toHaveBeenCalled()
    expect(dialog).not.toBeInTheDocument()
  })

  it('reports remote deletion success separately when local cleanup cannot be saved', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'custom', remoteFolderId: '9', title: 'bilimi·自建', memberCount: 12, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['9'], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const deleteFavoriteLedgersLocal = vi.fn().mockRejectedValue(new Error('local cleanup failed'))
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders,
        deleteFavoriteLedgersLocal
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom', displayName: 'bilimi·自建', keywords: ['自建'], enabled: true, priority: 10,
      bilibiliFolderId: '9', bilibiliFolderIds: ['9'], bilibiliFolderTitle: 'bilimi·自建', bindingState: 'bound', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·自建' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['custom']))
    expect(screen.getByRole('alert')).toHaveTextContent('B 站已删除，本地状态待保存')
    expect(screen.getByRole('button', { name: '自建' })).toBeInTheDocument()
  })

  it('reconciles every confirmed remote deletion into the refreshed default projection', async () => {
    const defaultLedgers = createDefaultFavoriteLedgers().map((ledger) => ({
      ...ledger,
      enabled: true,
      bilibiliFolderId: `remote-${ledger.id}`,
      bilibiliFolderIds: [`remote-${ledger.id}`],
      bindingState: 'bound' as const
    }))
    const remoteDrafts = ['remote-draft-one', 'remote-draft-two'].map((id, index) => ({
      id,
      displayName: `bilimi·远端草稿${index + 1}`,
      keywords: [],
      enabled: false,
      priority: 100 + index,
      isDefault: false,
      syncState: 'local-draft' as const,
      bindingState: 'unbound' as const,
      bilibiliFolderId: id
    }))
    const candidates = [
      ...defaultLedgers.map((ledger) => ({
        logicalLedgerId: ledger.id,
        remoteFolderId: ledger.bilibiliFolderId!,
        title: ledger.displayName,
        memberCount: 0,
        state: 'bound' as const,
        requiresUnboundAcknowledgement: false
      })),
      ...remoteDrafts.map((ledger) => ({
        logicalLedgerId: ledger.id,
        remoteFolderId: ledger.bilibiliFolderId!,
        title: ledger.displayName,
        memberCount: 0,
        state: 'unbound-name-match' as const,
        requiresUnboundAcknowledgement: true
      }))
    ]
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded',
      succeededRemoteFolderIds: candidates.map((candidate) => candidate.remoteFolderId),
      failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const deleteFavoriteLedgerDraft = vi.fn().mockResolvedValue(undefined)
    const save = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue(candidates),
        deleteManagedRemoteFolders,
        deleteFavoriteLedgerDraft
      }
    })
    render(<FavoriteLedgerOverview
      ledgers={[...defaultLedgers, ...remoteDrafts]}
      remoteOnlyDraftLedgerIds={remoteDrafts.map((ledger) => ledger.id)}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /已检测到未绑定的 bilimi 收藏夹/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(deleteFavoriteLedgerDraft).toHaveBeenCalledTimes(2))
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '远端草稿1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '远端草稿2' })).not.toBeInTheDocument()
    expect(screen.getAllByTestId(/favorite-ledger-chip-/)).toHaveLength(8)
    for (const ledger of defaultLedgers) {
      expect(screen.getByTestId(`favorite-ledger-chip-${ledger.id}`)).toHaveTextContent('未备册')
    }
  })

  it('keeps an unbound default rule as unbacked after remote deletion confirms the folder is already absent', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      {
        logicalLedgerId: 'game', title: 'bilimi·游戏', memberCount: 0,
        state: 'local-only', requiresUnboundAcknowledgement: false
      }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: [], failedRemoteFolderIds: [],
      unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏', keywords: ['游戏'], enabled: true, priority: 10,
      bindingState: 'unbound', isDefault: true
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('favorite-ledger-chip-game')).toHaveTextContent('未备册'))
    fireEvent.click(screen.getByRole('button', { name: '游戏专区' }))
    expect(screen.getByRole('region', { name: '当前收藏夹' })
      .querySelector('.favorite-ledger-panel__binding-status')).toHaveTextContent('未备册')
  })

  it('refreshes an unbound default to unbacked after deleting its acknowledged same-title folder', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([{
      logicalLedgerId: 'game', remoteFolderId: 'remote-game', title: 'bilimi·游戏', memberCount: 0,
      state: 'unbound-name-match', requiresUnboundAcknowledgement: true
    }])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['remote-game'], failedRemoteFolderIds: [],
      unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏', keywords: ['游戏'], enabled: true, priority: 10,
      bindingState: 'unbound', isDefault: true
    }]} missingLedgerIds={[]} unboundLedgerIds={['game']} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /已检测到未绑定的 bilimi 收藏夹/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('favorite-ledger-chip-game')).toHaveTextContent('未备册'))
    expect(screen.getByTestId('favorite-ledger-chip-game')).not.toHaveTextContent('未绑定')
    fireEvent.click(screen.getByRole('button', { name: '游戏专区' }))
    expect(screen.getByRole('region', { name: '当前收藏夹' })
      .querySelector('.favorite-ledger-panel__binding-status')).toHaveTextContent('未备册')
  })

  it('does not keep a stale deletion checkpoint when the post-cleanup refresh callback fails', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'default', remoteFolderId: 'default-remote', title: 'bilimi·默认', memberCount: 4, state: 'bound', requiresUnboundAcknowledgement: false },
      { logicalLedgerId: 'custom', remoteFolderId: '9', title: 'bilimi·自建', memberCount: 12, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['default-remote', '9'], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['custom'] })
    const onDeleteLedger = vi.fn().mockRejectedValue(new Error('workspace refresh failed'))
    const defaultLedger = { id: 'default', displayName: 'bilimi·默认', keywords: [], enabled: true, priority: 1, isDefault: true,
      bilibiliFolderId: 'default-remote', bilibiliFolderIds: ['default-remote'], bindingState: 'bound' as const }
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders,
        deleteFavoriteLedgersLocal
      }
    })
    render(<FavoriteLedgerOverview ledgers={[defaultLedger, {
      id: 'custom', displayName: 'bilimi·自建', keywords: ['自建'], enabled: true, priority: 10,
      bilibiliFolderId: '9', bilibiliFolderIds: ['9'], bindingState: 'bound', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={onDeleteLedger} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·默认' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·自建' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onDeleteLedger).toHaveBeenCalledWith('custom'))
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '自建' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('favorite-ledger-chip-default')).toHaveTextContent('未备册')
  })

  it('closes after a confirmed default remote deletion without repeating the renderer ledger save', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'default', remoteFolderId: 'default-remote', title: 'bilimi·默认', memberCount: 4, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['default-remote'], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const save = vi.fn().mockRejectedValue(new Error('renderer duplicate save must not run'))
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'default', displayName: 'bilimi·默认', keywords: [], enabled: true, priority: 1, isDefault: true,
      bilibiliFolderId: 'default-remote', bilibiliFolderIds: ['default-remote'], bindingState: 'bound'
    }]} missingLedgerIds={[]} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·默认' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument())
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByTestId('favorite-ledger-chip-default')).toHaveTextContent('未备册')
  })

  it('converges a remote draft when its local deletion response fails after persistence', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'remote-draft', remoteFolderId: '88', title: 'bilimi·远端草稿', memberCount: 0, state: 'unbound-name-match', requiresUnboundAcknowledgement: true }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['88'], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const deleteFavoriteLedgerDraft = vi.fn().mockRejectedValue(new Error('relationship refresh failed after save'))
    const onDeleteLedger = vi.fn().mockResolvedValue(true)
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders,
        deleteFavoriteLedgerDraft
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'remote-draft', displayName: 'bilimi·远端草稿', keywords: [], enabled: false, priority: 10,
      syncState: 'local-draft', bindingState: 'unbound', bilibiliFolderId: '88', isDefault: false
    }]} remoteOnlyDraftLedgerIds={['remote-draft']} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={onDeleteLedger} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·远端草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /已检测到未绑定的 bilimi 收藏夹/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(deleteFavoriteLedgerDraft).toHaveBeenCalledWith('100', 'remote-draft'))
    await waitFor(() => expect(onDeleteLedger).toHaveBeenCalledWith('remote-draft'))
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '远端草稿' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not label an unresolved remote deletion as a confirmed local failure', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'custom', remoteFolderId: '9', title: 'bilimi·自建', memberCount: 12, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'result-unknown', succeededRemoteFolderIds: [], failedRemoteFolderIds: [], unknownRemoteFolderIds: ['9'], unattemptedRemoteFolderIds: [],
      failures: [{ remoteFolderId: '9', title: 'bilimi·自建', outcome: 'result-unknown', message: 'remote-ambiguous' }]
    })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom', displayName: 'bilimi·自建', keywords: ['自建'], enabled: true, priority: 10,
      bilibiliFolderId: '9', bilibiliFolderIds: ['9'], bilibiliFolderTitle: 'bilimi·自建', bindingState: 'bound', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·自建' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalled())
    expect(screen.getByRole('alert')).toHaveTextContent('删除结果待核对')
    expect(screen.getByRole('button', { name: '自建' })).toBeInTheDocument()
  })

  it('shows the binding-ledger title expiry when deletion preview is blocked by stale metadata', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockRejectedValue(
      new Error('favorite-repository-binding-title-stale')
    )
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'knowledge', displayName: 'bilimi·知识学习', keywords: ['知识学习'], enabled: true, priority: 10,
      bilibiliFolderId: '4020619811', bilibiliFolderIds: ['4020619811'],
      bilibiliFolderTitle: 'bilimi·知识学习', bindingState: 'bound', isDefault: true
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·知识学习' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    await waitFor(() => expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalled())
    expect(screen.getByRole('alert')).toHaveTextContent('绑定账本标题已过期；已停止删除')
  })

  it('summarizes each right-side deletion candidate without repeating remote deletion details', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'knowledge', remoteFolderId: 'remote-knowledge', title: 'bilimi·知识学习', memberCount: 310, state: 'bound', requiresUnboundAcknowledgement: false },
      { logicalLedgerId: 'storage', title: 'bilimi·暂存', memberCount: 0, state: 'missing-remote', requiresUnboundAcknowledgement: true }
    ])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], enabled: true, priority: 10, isDefault: true, bilibiliFolderId: 'remote-knowledge' },
      { id: 'storage', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 20, isDefault: true, bilibiliFolderId: 'remote-storage' }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·知识学习' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·暂存' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(dialog).toHaveTextContent('bilimi·知识学习（当前 310 个视频）B站：保留')
    expect(dialog).toHaveTextContent('bilimi·暂存（历史分册 / 远端已不存在）（当前 0 个视频）B站：保留')
    expect(dialog).toHaveTextContent('只移除右侧规则或草稿；收藏库和 B 站保留。')

    fireEvent.click(screen.getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))

    expect(dialog).toHaveTextContent('bilimi·知识学习（当前 310 个视频）B站：删除 1 个实际收藏夹')
    expect(dialog).toHaveTextContent('bilimi·暂存（历史分册 / 远端已不存在）（当前 0 个视频）B站：远端已不存在，不会删除')
    expect(dialog).toHaveTextContent('收藏库工作夹和成员保留。')
    expect(dialog).not.toHaveTextContent('删除“知识学习”时，会同时从 B 站删除')
  })

  it('keeps the right-side rule and retains only failed remote bindings after a partial Bilibili deletion', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'custom', remoteFolderId: '9', title: 'bilimi·自建', memberCount: 12, state: 'bound', requiresUnboundAcknowledgement: false },
      { logicalLedgerId: 'custom', remoteFolderId: '10', title: 'bilimi·自建·2', memberCount: 3, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'partial-failed',
      succeededRemoteFolderIds: ['9'],
      failedRemoteFolderIds: ['10'],
      unknownRemoteFolderIds: [],
      unattemptedRemoteFolderIds: [],
      failures: [{ remoteFolderId: '10', title: 'bilimi·自建·2', outcome: 'failed', message: 'remote folder rejected' }]
    })
    const save = vi.fn().mockResolvedValue({ ok: true })
    const deleteFavoriteLedgersLocal = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders,
        deleteFavoriteLedgersLocal
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom', displayName: 'bilimi·自建', keywords: ['自建'], enabled: true, priority: 10,
      bilibiliFolderId: '9', bilibiliFolderIds: ['9', '10'], bilibiliFolderTitle: 'bilimi·自建', bindingState: 'bound', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·自建' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(screen.getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'custom',
        bilibiliFolderId: '10',
        bilibiliFolderIds: ['10'],
        bindingState: 'bound'
      })
    ], { deleteDisabled: false }))
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('部分删除完成')
    expect(screen.getByRole('alert')).toHaveTextContent('自建·2')
    expect(screen.getByRole('button', { name: '自建' })).toBeInTheDocument()
  })

  it('keeps rule editing and saving available while an earlier analysis is running', async () => {
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
    expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'music', keywords: ['旋律', '节奏'] })
    ], { deleteDisabled: false })
    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('正在分析 128 / 2000 条'))
    expect(screen.getByRole('progressbar', { name: '收藏夹规则分析进度' })).toHaveAttribute('aria-valuenow', '128')
    expect(screen.getByRole('textbox', { name: '关键词' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '加入同步 bilimi·音乐' })).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '最终规则' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'music', keywords: ['最终规则'] })
    ], { deleteDisabled: false }))
    expect(analyze).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'music', keywords: ['最终规则'] }))
    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '新建收藏夹' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '备册收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消分析' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '取消分析' }))
    expect(cancelAnalysis).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '音乐' }))

    await act(async () => analysis.resolve(true))
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
  })

  it('keeps ordinary rule deletion available while another rule analysis is running', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-analysis'] })
    const onDeleteLedger = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'recommended-analysis', displayName: 'bilimi·分析中推荐', keywords: ['分析中推荐'], ruleType: 'author',
      enabled: true, priority: 10, ruleOrigin: 'saved-rule', bindingState: 'unbacked', isDefault: false
    }]} missingLedgerIds={[]} organizationActive hasExpandedOrganizationGuide onSaveLedgers={vi.fn()} onDeleteLedger={onDeleteLedger}
      draftRuleAnalysis={{ ledgerId: 'other-rule', status: 'running', completedItemCount: 1, totalItemCount: 10 }} />)

    fireEvent.click(screen.getByRole('button', { name: '分析中推荐' }))
    const deleteButton = screen.getByRole('button', { name: '删除' })
    expect(deleteButton).toBeEnabled()
    fireEvent.click(deleteButton)
    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-analysis']))
    expect(onDeleteLedger).toHaveBeenCalledWith('recommended-analysis')
  })

  it('keeps the saved local rule when its follow-up active-round analysis does not complete', async () => {
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
    expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'music', keywords: ['节奏'] })
    ], { deleteDisabled: false })
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
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

      fireEvent.click(screen.getByRole('button', { name: '收起' }))
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

  it('uses one bulk toggle for normal and isolated deletion selections', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: false, bilibiliFolderId: 'remote-music' },
      { id: 'custom-tech', displayName: '科技', keywords: [], enabled: false, priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech' }
    ]} missingLedgerIds={[]} onSaveLedgers={save} />)

    const toggle = screen.getByTestId('favorite-ledger-cancel-all')
    expect(toggle).toHaveTextContent('全选')
    expect(toggle).toBeEnabled()
    fireEvent.click(toggle)
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'music', enabled: true }),
      expect.objectContaining({ id: 'custom-tech', enabled: true })
    ]), { deleteDisabled: false })
    const normalSaveCount = save.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    expect(toggle).toBeEnabled()
    expect(toggle).toHaveTextContent('全选')
    fireEvent.click(toggle)
    expect(save).toHaveBeenCalledTimes(normalSaveCount)
    expect(screen.getByTestId('favorite-ledger-cancel-all')).toHaveTextContent('取消全选')
    expect(screen.getByRole('button', { name: '取消删除 bilimi·音乐' })).toBeEnabled()
    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))
    expect(screen.getByTestId('favorite-ledger-cancel-all')).toHaveTextContent('全选')
    expect(screen.getByRole('button', { name: '加入删除 bilimi·音乐' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '取消删除模式' }))
    expect(toggle).toHaveTextContent('取消全选')
    expect(screen.getByRole('button', { name: '移出同步 bilimi·音乐' })).toBeEnabled()
    expect(save).toHaveBeenCalledTimes(normalSaveCount)
  })

  it('shows deletion visual state only for selected cards and clears it when deletion mode exits', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={save} />)

    const modeToggle = screen.getByRole('button', { name: '展开删除模式' })
    const actions = modeToggle.parentElement
    const chip = screen.getByTestId('favorite-ledger-chip-music')
    expect(actions).not.toHaveAttribute('data-deletion-mode')
    expect(chip).not.toHaveAttribute('data-deletion-selected')

    fireEvent.click(modeToggle)
    expect(actions).toHaveAttribute('data-deletion-mode', 'true')
    expect(chip).not.toHaveAttribute('data-deletion-selected')

    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·音乐' }))
    expect(chip).toHaveAttribute('data-deletion-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: '取消删除模式' }))
    expect(actions).not.toHaveAttribute('data-deletion-mode')
    expect(chip).not.toHaveAttribute('data-deletion-selected')
    expect(screen.getByRole('button', { name: '移出同步 bilimi·音乐' })).toBeEnabled()
    expect(save).not.toHaveBeenCalled()
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

  it('keeps the master-library scroll position after a recommendation toggle and its trailing snapshot paint', () => {
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    try {
      render(<section role="dialog" aria-label="掌库">
        <FavoriteLedgerOverview ledgers={[{
          id: 'recommended-author', displayName: 'bilimi·推荐作者', keywords: ['推荐作者'], ruleType: 'author',
          enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false
        }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={vi.fn()} />
      </section>)
      const panel = screen.getByRole('dialog', { name: '掌库' })
      panel.scrollTop = 240

      fireEvent.click(screen.getByRole('button', { name: '移出同步 bilimi·推荐作者' }))
      expect(frames).toHaveLength(1)
      frames.shift()!(performance.now())
      expect(panel.scrollTop).toBe(240)

      // The workspace snapshot can commit after the first paint and reset the
      // native scroll container. The next paint must restore the user's anchor.
      panel.scrollTop = 0
      expect(frames).toHaveLength(1)
      frames.shift()!(performance.now())
      expect(panel.scrollTop).toBe(240)
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  it('keeps the master-library scroll position across detail deletion and yields to a later user scroll', async () => {
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-delete-scroll'] })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { readBilibiliAccountMid: vi.fn().mockResolvedValue('100'), deleteFavoriteLedgersLocal }
    })
    try {
      render(<section role="dialog" aria-label="掌库">
        <FavoriteLedgerOverview ledgers={[{
          id: 'recommended-delete-scroll', displayName: 'bilimi·删除滚动推荐', keywords: ['删除滚动推荐'], ruleType: 'author',
          enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false
        }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={vi.fn()} />
      </section>)
      const panel = screen.getByRole('dialog', { name: '掌库' })
      panel.scrollTop = 240

      fireEvent.click(screen.getByRole('button', { name: '删除滚动推荐' }))
      fireEvent.click(screen.getByRole('button', { name: '删除' }))
      await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-delete-scroll']))

      expect(frames).toHaveLength(1)
      panel.scrollTop = 0
      frames.shift()!(performance.now())
      expect(panel.scrollTop).toBe(240)

      panel.scrollTop = 96
      fireEvent.scroll(panel)
      expect(frames).toHaveLength(1)
      frames.shift()!(performance.now())
      expect(panel.scrollTop).toBe(96)
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  it('does not mistake its own deletion scroll restoration event for a user scroll', async () => {
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['recommended-delete-native-scroll'] })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { readBilibiliAccountMid: vi.fn().mockResolvedValue('100'), deleteFavoriteLedgersLocal }
    })
    try {
      render(<section role="dialog" aria-label="掌库">
        <FavoriteLedgerOverview ledgers={[{
          id: 'recommended-delete-native-scroll', displayName: 'bilimi·原生滚动推荐', keywords: ['原生滚动推荐'], ruleType: 'author',
          enabled: true, priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false
        }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onDeleteLedger={vi.fn()} />
      </section>)
      const panel = screen.getByRole('dialog', { name: '掌库' })
      let nativeScrollTop = 240
      Object.defineProperty(panel, 'scrollTop', {
        configurable: true,
        get: () => nativeScrollTop,
        set: (value: number) => {
          nativeScrollTop = value
          // Chromium can dispatch `scroll` for an imperative scrollTop write.
          panel.dispatchEvent(new Event('scroll'))
        }
      })

      fireEvent.click(screen.getByRole('button', { name: '原生滚动推荐' }))
      fireEvent.click(screen.getByRole('button', { name: '删除' }))
      await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['recommended-delete-native-scroll']))

      // A repaint moves the container. The first restore itself fires native
      // `scroll`; that event is not an intentional user scroll and must not
      // cancel the remaining restoration frame.
      nativeScrollTop = 0
      frames.shift()!(performance.now())
      expect(nativeScrollTop).toBe(240)
      nativeScrollTop = 0
      expect(frames).toHaveLength(1)
      frames.shift()!(performance.now())
      expect(nativeScrollTop).toBe(240)
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
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
    expect(screen.getByRole('alert')).toHaveTextContent('收藏夹启用状态保存失败，请稍后重试。')
  })

  it('keeps required defaults selected while a custom target is removed during a round', async () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const saveEnabled = vi.fn()
    render(<FavoriteLedgerOverview
      organizationActive
      ledgers={[
        { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
        { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 20, isDefault: true },
        { id: 'custom-tech', displayName: '科技', keywords: [], enabled: true, priority: 20, isDefault: false }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
      onSaveLedgerEnabled={saveEnabled}
    />)

    fireEvent.click(screen.getByRole('button', { name: /移出同步 .*科技/ }))
    await act(async () => { vi.advanceTimersByTime(250) })
    expect(save).not.toHaveBeenCalled()
    expect(saveEnabled).toHaveBeenCalledWith('custom-tech', false)
    expect(screen.getByRole('button', { name: '移出同步 bilimi·暂存' })).toBeDisabled()
  })

  it('changes the active round selection in one batch without persisting global enabled preferences', async () => {
    const save = vi.fn()
    const saveEnabled = vi.fn()
    const roundSelection = vi.fn().mockResolvedValue(true)
    render(<FavoriteLedgerOverview
      organizationActive
      ledgers={[
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false },
        { id: 'tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 20, isDefault: false }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
      onSaveLedgerEnabled={saveEnabled}
      organizationSavedLedgerEnabledById={new Map([['music', true], ['tech', true]])}
      onOrganizationSavedLedgerSelectionChange={roundSelection}
    />)

    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))

    expect(roundSelection).toHaveBeenCalledWith([])
    expect(save).not.toHaveBeenCalled()
    expect(saveEnabled).not.toHaveBeenCalled()
  })

  it('updates a saved round toggle immediately while the authoritative selection is pending', async () => {
    const pending = deferred<boolean>()
    const roundToggle = vi.fn(() => pending.promise)
    render(<FavoriteLedgerOverview
      organizationActive
      ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
      organizationSavedLedgerEnabledById={new Map([['music', true]])}
      onOrganizationSavedLedgerToggle={roundToggle}
    />)

    const remove = screen.getByRole('button', { name: '移出同步 bilimi·音乐' })
    fireEvent.click(remove)

    expect(remove).toHaveAttribute('data-enabled', 'false')
    expect(roundToggle).toHaveBeenCalledWith('music', false)
    pending.resolve(true)
    await act(async () => { await pending.promise })
  })

  it('restores the account enabled state after a stale recommendation organization map is removed', () => {
    const recommendation = {
      id: 'completed-recommendation', displayName: 'bilimi·已完成推荐', keywords: ['已完成'], ruleType: 'author' as const,
      enabled: true, priority: 10, ruleOrigin: 'recommendation-draft' as const, bindingState: 'unbacked' as const, isDefault: false
    }
    const view = render(<FavoriteLedgerOverview
      organizationActive
      ledgers={[recommendation]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
      organizationSavedLedgerEnabledById={new Map([['completed-recommendation', true]])}
      onOrganizationSavedLedgerToggle={vi.fn().mockResolvedValue(true)}
    />)

    expect(screen.getByRole('button', { name: '移出同步 bilimi·已完成推荐' })).toBeInTheDocument()
    view.rerender(<FavoriteLedgerOverview
      organizationActive
      ledgers={[{ ...recommendation, enabled: false }]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
      onOrganizationRecommendationToggle={vi.fn().mockResolvedValue(true)}
    />)

    expect(screen.getByRole('button', { name: '加入同步 bilimi·已完成推荐' })).toBeInTheDocument()
  })

  it('keeps a round-locked default selected when bulk cancellation excludes saved rules', () => {
    const roundSelection = vi.fn().mockResolvedValue(true)
    render(<FavoriteLedgerOverview
      organizationActive
      ledgers={[
        { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
        { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 20, isDefault: false }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
      organizationSavedLedgerEnabledById={new Map([['knowledge', true], ['music', true]])}
      onOrganizationSavedLedgerSelectionChange={roundSelection}
    />)

    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))

    expect(roundSelection).toHaveBeenCalledWith(['knowledge'])
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
    expect(screen.getAllByTestId(/favorite-ledger-chip-/).at(-1)).toHaveTextContent('未保存')
  })

  it('does not allow an unsaved local draft to be selected for synchronization', () => {
    render(<FavoriteLedgerOverview ledgers={[]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))

    const draftChip = screen.getByTestId(/favorite-ledger-chip-custom-new-ledger-/)
    expect(draftChip).toHaveTextContent('未保存')
    expect(draftChip.querySelector('.favorite-ledger-panel__chip-action')).toBeDisabled()
  })

  it('marks a newly saved local ledger as unbacked', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<FavoriteLedgerOverview ledgers={[]} missingLedgerIds={[]} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByRole('textbox', { name: '册名' }), { target: { value: '临时工作夹' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ bindingState: 'unbacked' })
    ])
  })

  it('keeps a new local ledger editor open when persistence resolves with a failure result', async () => {
    const save = vi.fn().mockResolvedValue({
      ok: false,
      steps: [],
      missingTargets: ['favorite-api-user'],
      message: 'B 站页面暂不可用，本地规则尚未保存。'
    })
    render(<FavoriteLedgerOverview ledgers={[]} missingLedgerIds={[]} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByRole('textbox', { name: '册名' }), { target: { value: '本地草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '册名' })).toHaveValue('本地草稿')
    expect(screen.getByRole('alert')).toHaveTextContent('B 站页面暂不可用，本地规则尚未保存。')
    expect(screen.getByTestId(/favorite-ledger-chip-custom-new-ledger-/)).toHaveTextContent('本地草稿')
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

    expect(document.querySelector('.favorite-ledger-panel__notice')).toHaveTextContent('1')
    expect(screen.getByText(/更换电脑.*迁移本地数据/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '原神' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加入同步 原神' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '原神' }))
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

  it('does not repeat the unsaved state in an editor heading', () => {
    render(<FavoriteLedgerOverview
      ledgers={[{ id: 'remote-draft', displayName: 'bilimi路草稿', keywords: [], enabled: false, priority: 10,
        syncState: 'local-draft', bilibiliFolderId: '42', isDefault: false }]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '草稿' }))

    const editorTitle = screen.getByRole('region', { name: '当前收藏夹' }).querySelector('.favorite-ledger-panel__editor-title')
    expect(editorTitle).toHaveTextContent('正在编辑：bilimi路草稿')
    expect(editorTitle).not.toHaveTextContent('（未保存）')
  })

  it('keeps the edited rule open when an explicit local save fails', async () => {
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

    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '关键词' })).toHaveValue('new')
    expect(screen.getByRole('alert')).toHaveTextContent('收藏夹规则未能持久化，请稍后重试。')
  })

  it('keeps an edited ledger marked as unsaved after selecting another ledger', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false },
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '摇滚' } })
    fireEvent.click(screen.getByRole('button', { name: '知识' }))

    expect(screen.getByRole('button', { name: '音乐' })).toBeInTheDocument()
    expect(screen.getByText('正在编辑：bilimi·知识')).toBeInTheDocument()
  })

  it('keeps a new unsaved ledger open when an equivalent ledger snapshot rerenders', () => {
    const ledgers = [{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]
    const view = render(<FavoriteLedgerOverview ledgers={ledgers} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByRole('textbox', { name: '册名' }), { target: { value: '临时草稿' } })
    view.rerender(<FavoriteLedgerOverview ledgers={ledgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))}
      missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '临时草稿' })).toBeInTheDocument()
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

  it('shows an unbound default ledger as recoverable through the ordinary backup action', () => {
    const sync = vi.fn().mockResolvedValue({ ok: false, unboundCandidates: [] })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'music', displayName: 'bilimi·音乐舞台', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'unbound'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    expect(screen.getByTestId('favorite-ledger-chip-music')).toHaveTextContent('未绑定')
    const backup = screen.getByRole('button', { name: '备册收藏夹' })
    expect(backup).toBeEnabled()
    expect(screen.queryByRole('button', { name: '恢复备册收藏夹' })).not.toBeInTheDocument()

    fireEvent.click(backup)

    expect(sync).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'music', enabled: true, bindingState: 'unbound' })
    ], { backupTargetLedgerIds: ['music'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true })
  })

  it('labels a backup-created exact id as awaiting formal confirmation instead of an ordinary unbound candidate', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'music', displayName: 'bilimi·音乐舞台', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'unbound', bilibiliFolderId: 'new-music',
      pendingRemoteBinding: true, pendingRemoteBindingCreatedByBackup: true,
      pendingRemoteFolderId: 'new-music'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByTestId('favorite-ledger-chip-music')).toHaveTextContent('已创建 · 待正式确认')
    expect(screen.getByTestId('favorite-ledger-chip-music')).not.toHaveTextContent('未绑定')
  })

  it('keeps an unbound default ledger selected and locked while the default system is enabled', () => {
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'unbound'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByTestId('favorite-ledger-chip-music')).toHaveTextContent('未绑定')
    const toggle = screen.getByRole('button', { name: '移出同步 bilimi·音乐' })
    expect(toggle).toHaveAttribute('data-enabled', 'true')
    expect(toggle).toBeDisabled()
  })

  it('shows only the local unsaved state while the organization card and editor hide backup state', () => {
    render(<FavoriteLedgerOverview hasExpandedOrganizationGuide defaultFavoriteSystemEnabled ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: ['旧规则'], enabled: true, priority: 10,
      isDefault: true, bindingState: 'bound', bilibiliFolderId: '9001'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '新规则' } })

    expect(screen.getByTestId('favorite-ledger-chip-music')).toHaveTextContent('未保存')
    expect(screen.getByTestId('favorite-ledger-chip-music')).not.toHaveTextContent('已备册')
    expect(screen.getByRole('region', { name: '当前收藏夹' })
      .querySelector('.favorite-ledger-panel__ledger-name-label .favorite-ledger-panel__binding-status'))
      .toHaveTextContent('未保存')
  })

  it('skips an unsaved default during backup while backing up another saved selected ledger', async () => {
    const sync = vi.fn().mockResolvedValue({ ok: true })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: ['旧规则'], enabled: true, priority: 10,
      isDefault: true, bindingState: 'bound', bilibiliFolderId: '9001'
    }, {
      id: 'saved-custom', displayName: 'bilimi·已保存', keywords: ['已保存'], enabled: true, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '新规则' } })
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    await waitFor(() => expect(sync).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'saved-custom', enabled: true })
    ], { backupTargetLedgerIds: ['saved-custom'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }))
    expect(screen.getByRole('alert')).toHaveTextContent('音乐尚未保存，已跳过本次备册，请先保存后再备册。')
  })

  it('keeps bilimi temporary storage checked even when the default system is closed', () => {
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[{
      id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: false, priority: 10,
      isDefault: true, bindingState: 'unbacked'
    }]} missingLedgerIds={['inbox']} onSaveLedgers={vi.fn()} />)

    const toggle = screen.getByRole('button', { name: '移出同步 bilimi·暂存' })
    expect(toggle).toHaveAttribute('data-enabled', 'true')
    expect(toggle).toBeDisabled()
  })

  it('does not let bulk selection re-enable an edited custom ledger before it is saved', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom', displayName: 'bilimi·自建', keywords: ['旧规则'], enabled: true, priority: 10,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9001'
    }, {
      id: 'other', displayName: 'bilimi·其他', keywords: ['其他'], enabled: false, priority: 20,
      isDefault: false, bindingState: 'bound', bilibiliFolderId: '9002'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '自建' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '新规则' } })
    expect(screen.getByRole('button', { name: '加入同步 bilimi·自建' })).toBeDisabled()

    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))

    expect(screen.getByRole('button', { name: '加入同步 bilimi·自建' })).toHaveAttribute('data-enabled', 'false')
    expect(screen.getByRole('button', { name: '移出同步 bilimi·其他' })).toHaveAttribute('data-enabled', 'true')
  })

  it('renders a default ledger from its actual retained Bilibili binding', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10,
      isDefault: true, bindingState: 'bound', bilibiliFolderId: '9001'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))

    const status = screen.getByRole('region', { name: '当前收藏夹' })
      .querySelector('.favorite-ledger-panel__ledger-name-label .favorite-ledger-panel__binding-status')
    expect(status).toHaveTextContent('已备册')
    expect(status).toHaveAttribute('data-binding-state', 'bound')
  })

  it('shows the current backup state at the right of the folder-name label while editing', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, bilibiliFolderVideoCount: 0, isDefault: false }
    ]} missingLedgerIds={['music']} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))

    const editor = screen.getByRole('region', { name: '当前收藏夹' })
    expect(editor.querySelector('.favorite-ledger-panel__editor-title .favorite-ledger-panel__binding-status')).toBeNull()
    expect(editor.querySelector('.favorite-ledger-panel__ledger-name-label .favorite-ledger-panel__ledger-video-count')).toHaveTextContent('0 个视频')
    expect(editor.querySelector('.favorite-ledger-panel__ledger-name-label .favorite-ledger-panel__binding-status')).toHaveTextContent('未备册')
  })

  it('shows an explicitly bound logical ledger as backed even when a sibling shard remains unresolved', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: '88', bilibiliFolderIds: ['88'], bindingState: 'bound', isDefault: true
    }]} missingLedgerIds={['game']} unboundLedgerIds={['game']} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '游戏专区' })).toHaveTextContent('已备册')
  })

  it('shows the combined unsaved and pending recovery state for a recovered remote draft', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom-remote-hello', displayName: 'bilimi·你好', keywords: [], enabled: false, priority: 10,
      bilibiliFolderId: '88', bindingState: 'unbound', syncState: 'local-draft', isDefault: false
    }]} missingLedgerIds={[]} unboundLedgerIds={['custom-remote-hello']} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '你好' }))

    const editor = screen.getByRole('region', { name: '当前收藏夹' })
    expect(editor.querySelector('.favorite-ledger-panel__editor-title')).toHaveTextContent('正在编辑：bilimi·你好')
    expect(screen.getByTestId('favorite-ledger-chip-custom-remote-hello')).toHaveTextContent('未保存 · 未绑定')
    expect(editor.querySelector('.favorite-ledger-panel__ledger-name-label .favorite-ledger-panel__binding-status')).toHaveTextContent('未保存 · 未绑定')
    expect(screen.getByText((_, element) => element?.textContent === '检测到 B 站中有 1 个疑似 bilimi 工作夹：1 个未保存未绑定。请先编辑保存好收藏夹规则，再点击“备册”确认绑定；尚未建立绑定前，只可预分类，不能执行 B 站分类同步；更换电脑时建议优先迁移本地数据。')).toBeInTheDocument()
  })

  it('confirms every selected recovery shard in one backup operation', async () => {
    const candidates = [{ ledgerId: 'knowledge', candidates: [
      { id: '77', title: 'bilimi·知识学习', memberCount: 310 }
    ] }, { ledgerId: 'game', candidates: [
      { id: '88', title: 'bilimi·游戏专区', memberCount: 1000 },
      { id: '89', title: 'bilimi·游戏专区·2', memberCount: 6 }
    ] }]
    const sync = vi.fn()
      .mockResolvedValueOnce({ ok: false, unboundCandidates: candidates })
      .mockResolvedValueOnce({ ok: true })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], enabled: true, priority: 5,
      bilibiliFolderId: '77', bilibiliFolderIds: ['77'], bindingState: 'unbound', isDefault: true
    }, {
      id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: '88', bilibiliFolderIds: ['88', '89'], bindingState: 'unbound', isDefault: true
    }]} missingLedgerIds={['game']} unboundLedgerIds={['game']} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1))
    expect(sync.mock.calls[0]?.[1]).toEqual({ backupTargetLedgerIds: ['knowledge', 'game'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true })
    await screen.findByText('确认绑定 bilimi 收藏夹')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('知识学习（共 310 个视频）')).toBeInTheDocument()
    expect(screen.getByText('分册 1：bilimi·知识学习（310 个视频，绑定后 B 站收藏夹名字会更改为 bilimi·知识学习）')).toBeInTheDocument()
    expect(screen.getByText('游戏专区（共 1006 个视频）')).toBeInTheDocument()
    expect(screen.getByText('分册 1：bilimi·游戏专区（1000 个视频，绑定后 B 站收藏夹名字会更改为 bilimi·游戏专区）')).toBeInTheDocument()
    expect(screen.getByText('分册 2：bilimi·游戏专区·2（6 个视频，绑定后 B 站收藏夹名字会更改为 bilimi·游戏专区）')).toBeInTheDocument()
    expect(screen.queryByText(/ID：/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }))
    await waitFor(() => expect(sync).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({
      rediscoverDeletedRemoteDrafts: true,
      rebindRemoteFolderIds: { knowledge: '77', game: '88' },
      rebindRemoteFolders: { knowledge: [
        { id: '77', title: 'bilimi·知识学习', memberCount: 310 }
      ], game: [
        { id: '88', title: 'bilimi·游戏专区', memberCount: 1000 },
        { id: '89', title: 'bilimi·游戏专区·2', memberCount: 6 }
      ] }
    })))
  })

  it('requires a separate bound-rename confirmation without exposing an id or calling sync again on cancel', async () => {
    const sync = vi.fn().mockResolvedValue({
      ok: false,
      boundRenameCandidates: [{
        ledgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', logicalVideoCount: 0,
        shards: [{ shardNumber: 1, remoteFolderId: '4106106611', currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, targetTitle: 'bilimi·游戏专区哈哈' }]
      }]
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏专区哈哈', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: '4106106611', bilibiliFolderIds: ['4106106611'], bindingState: 'bound', isDefault: true
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('dialog', { name: '确认修改 B 站收藏夹名称' })
    expect(dialog).toHaveTextContent('游戏专区哈哈（共 0 个视频）')
    expect(dialog).toHaveTextContent('分册 1：bilimi·游戏专区（0 个视频，确认后 B站收藏夹名字会更改为 bilimi·游戏专区哈哈）')
    expect(dialog).not.toHaveTextContent('ID：')
    expect(sync).toHaveBeenCalledTimes(1)

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(sync).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '确认修改 B 站收藏夹名称' })).not.toBeInTheDocument()
  })

  it('reruns only the preflight targets after confirming a bound rename', async () => {
    const candidates = [{
      ledgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', logicalVideoCount: 0,
      shards: [{ shardNumber: 1, remoteFolderId: '4106106611', currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, targetTitle: 'bilimi·游戏专区哈哈' }]
    }]
    const sync = vi.fn()
      .mockResolvedValueOnce({ ok: false, boundRenameCandidates: candidates })
      .mockResolvedValueOnce({ ok: true })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏专区哈哈', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: '4106106611', bilibiliFolderIds: ['4106106611'], bindingState: 'bound', isDefault: true
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('dialog', { name: '确认修改 B 站收藏夹名称' })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认改名' }))

    await waitFor(() => expect(sync).toHaveBeenLastCalledWith(expect.any(Array), {
      backupTargetLedgerIds: ['game'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true, confirmBoundRename: true,
      boundRenameShards: { game: [{ remoteFolderId: '4106106611', shardNumber: 1 }] }
    }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认修改 B 站收藏夹名称' })).not.toBeInTheDocument())
  })

  it('keeps the bound-rename confirmation open and shows the actual failure after confirmation', async () => {
    const candidates = [{
      ledgerId: 'game', logicalTitle: 'bilimi·游戏专区哈哈', logicalVideoCount: 0,
      shards: [{ shardNumber: 1, remoteFolderId: '4106106611', currentRemoteTitle: 'bilimi·游戏专区', remoteMemberCount: 0, targetTitle: 'bilimi·游戏专区哈哈' }]
    }]
    const sync = vi.fn()
      .mockResolvedValueOnce({ ok: false, boundRenameCandidates: candidates })
      .mockResolvedValueOnce({ ok: false, message: 'B 站改名被拒绝。' })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏专区哈哈', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: '4106106611', bilibiliFolderIds: ['4106106611'], bindingState: 'bound', isDefault: true
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('dialog', { name: '确认修改 B 站收藏夹名称' })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认改名' }))

    await waitFor(() => expect(dialog).toHaveTextContent('B 站改名被拒绝。'))
    expect(screen.getByRole('dialog', { name: '确认修改 B 站收藏夹名称' })).toBeInTheDocument()
  })

  it('shows every locked unbacked backup target as selected before confirming creation', async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce({ ok: false, unboundCandidates: [
        { ledgerId: 'music', candidates: [] },
        { ledgerId: 'film', candidates: [] }
      ] })
      .mockResolvedValueOnce({ ok: true })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      bindingState: 'unbacked', isDefault: true
    }, {
      id: 'film', displayName: 'bilimi·影视动漫', keywords: [], enabled: true, priority: 20,
      bindingState: 'unbacked', isDefault: true
    }]} missingLedgerIds={['music']} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('dialog', { name: '确认创建并绑定 bilimi 收藏夹' })
    expect(dialog).toHaveTextContent('未找到可复用同名 bilimi 收藏夹')
    expect(within(dialog).getByRole('checkbox', { name: '音乐（将创建并绑定）' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: '影视动漫（将创建并绑定）' })).toBeChecked()
    const confirm = screen.getByRole('button', { name: '确认创建并绑定' })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(sync).toHaveBeenLastCalledWith(expect.any(Array), {
      backupTargetLedgerIds: ['music', 'film'],
      deleteDisabled: false,
      rediscoverDeletedRemoteDrafts: true,
      confirmCreateAndBind: true
    }))
  })

  it('saves a recovered remote draft as pending binding instead of an authoritative binding', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom-remote-hello', displayName: 'bilimi·你好', keywords: [], enabled: false, priority: 10,
      bilibiliFolderId: '88', bindingState: 'unbound', syncState: 'local-draft', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '你好' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(save).toHaveBeenCalledWith([expect.objectContaining({
      id: 'custom-remote-hello',
      bilibiliFolderId: '88',
      bindingState: 'unbound',
      pendingRemoteBinding: true,
      pendingRemoteFolderId: '88'
    })], { deleteDisabled: false })
  })

  it('submits recovery shards in the user-adjusted order', async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce({ ok: false, unboundCandidates: [{ ledgerId: 'game', candidates: [
        { id: '88', title: 'bilimi·游戏专区', memberCount: 1000 },
        { id: '89', title: 'bilimi·游戏专区·2', memberCount: 6 }
      ] }] })
      .mockResolvedValueOnce({ ok: true })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true, priority: 10,
      bindingState: 'unbound', isDefault: true
    }]} missingLedgerIds={['game']} unboundLedgerIds={['game']} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await screen.findByText('确认绑定 bilimi 收藏夹')
    fireEvent.click(screen.getByRole('button', { name: '将分册 2 上移' }))
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }))

    await waitFor(() => expect(sync).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({
      rebindRemoteFolderIds: { game: '89' },
      rebindRemoteFolders: {
        game: [
          { id: '89', title: 'bilimi·游戏专区·2', memberCount: 6 },
          { id: '88', title: 'bilimi·游戏专区', memberCount: 1000 }
        ]
      }
    })))
  })

  it('keeps a rejected recovery shard visible with its binding reason', async () => {
    const game = {
      id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: '88', bilibiliFolderIds: ['88', '89'], bindingState: 'unbound' as const, isDefault: true
    }
    const sync = vi.fn()
      .mockResolvedValueOnce({ ok: false, unboundCandidates: [{ ledgerId: 'game', candidates: [
        { id: '88', title: 'bilimi·游戏专区', memberCount: 1000 },
        { id: '89', title: 'bilimi·游戏专区·2', memberCount: 2 }
      ] }] })
      .mockResolvedValueOnce({ ok: false, unboundCandidates: [{ ledgerId: 'game', candidates: [
        {
          id: '89', title: 'bilimi·游戏专区·2', memberCount: 2,
          bindingFailureReason: '远端收藏夹已不在本次清单中，请刷新 B 站收藏夹后重新确认。'
        }
      ] }] })
    render(<FavoriteLedgerOverview ledgers={[game]} missingLedgerIds={['game']} unboundLedgerIds={['game']} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await screen.findByText('确认绑定 bilimi 收藏夹')
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }))

    expect(await screen.findByText(/分册 2：bilimi·游戏专区·2/)).toHaveTextContent('绑定失败：远端收藏夹已不在本次清单中，请刷新 B 站收藏夹后重新确认。')
    expect(screen.queryByText(/ID：89/)).not.toBeInTheDocument()
    expect(screen.queryByText(/分册 1：bilimi·游戏专区/)).not.toBeInTheDocument()
  })

  it('dismisses every physical Bilibili folder behind one recovered draft', () => {
    const onDismiss = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'custom-remote-game', displayName: 'bilimi·游戏专区', keywords: [], enabled: false, priority: 10,
      bilibiliFolderId: '88', bilibiliFolderIds: ['88', '89'], bindingState: 'unbound', syncState: 'local-draft', isDefault: false
    }]} missingLedgerIds={[]} remoteOnlyDraftLedgerIds={['custom-remote-game']} onDismissRemoteDraftReminder={onDismiss} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '游戏专区' }))
    fireEvent.click(screen.getByRole('button', { name: '不再提醒' }))

    expect(onDismiss).toHaveBeenCalledWith('custom-remote-game', ['88', '89'])
  })

  it('includes the backup state in the favorite folder hover title', () => {
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      bilibiliFolderId: '88', bindingState: 'bound', isDefault: false
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '音乐' })).toHaveAttribute('title', 'bilimi·音乐 · 已备册')
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

  it('backs up only saved selected ledgers without previewing disabled or unsaved rules for deletion', async () => {
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
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: true },
      { id: 'reading', displayName: 'bilimi·阅读', keywords: [], enabled: false, priority: 20, isDefault: false },
      { id: 'recommended-up', displayName: 'bilimi·推荐 UP', keywords: [], enabled: true, priority: 30, syncState: 'local-draft', isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    expect(screen.queryByRole('button', { name: '检查待删除收藏夹' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    await waitFor(() => expect(sync).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'music', enabled: true })
    ], { backupTargetLedgerIds: ['music'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }))
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(screen.queryByText('本次同步有 1 个 bilimi 管理的收藏夹需要删除。')).not.toBeInTheDocument()
  })

  it('explains which selected unsaved ledgers must be saved before backup can proceed', () => {
    const sync = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true },
      { id: 'recommended-up', displayName: 'bilimi·推荐 UP', keywords: [], enabled: true, priority: 20, syncState: 'local-draft', isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    const backupButton = screen.getByRole('button', { name: '备册收藏夹' })
    expect(backupButton).toBeEnabled()
    fireEvent.click(backupButton)
    expect(sync).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('推荐 UP尚未保存，已跳过本次备册，请先保存后再备册。')
  })

  it('keeps default ledgers selectable only in deletion mode while preserving normal selection', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview
      ledgers={[
        { id: 'music', displayName: 'bilimi:音乐', keywords: ['音乐'], ruleType: 'keyword', enabled: true, priority: 10, isDefault: true, bilibiliFolderId: 'remote-music' },
        { id: 'reading', displayName: 'bilimi:阅读', keywords: ['阅读'], ruleType: 'keyword', enabled: true, priority: 20, isDefault: true, bilibiliFolderId: 'remote-reading' }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    expect(screen.getByRole('button', { name: '加入删除 bilimi:音乐' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '加入删除 bilimi:阅读' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '取消删除模式' }))
    expect(screen.getByRole('button', { name: '移出同步 bilimi:音乐' })).toBeEnabled()
    expect(save).not.toHaveBeenCalled()
  })

  it('includes protected default ledgers in deletion-mode single and bulk selection', () => {
    render(<FavoriteLedgerOverview
      organizationActive
      defaultFavoriteSystemEnabled
      ledgers={[
        { id: 'music', displayName: 'bilimi:音乐', keywords: ['音乐'], ruleType: 'keyword', enabled: true, priority: 10, isDefault: true },
        { id: 'custom', displayName: 'bilimi:自建', keywords: ['自建'], ruleType: 'keyword', enabled: true, priority: 20, isDefault: false }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    const music = screen.getByRole('button', { name: '加入删除 bilimi:音乐' })
    expect(music).toBeEnabled()
    fireEvent.click(music)
    expect(screen.getByRole('button', { name: '取消删除 bilimi:音乐' })).toBeEnabled()

    const bulk = screen.getByTestId('favorite-ledger-cancel-all')
    fireEvent.click(bulk)
    expect(bulk).toHaveTextContent('取消全选')
    expect(screen.getByRole('button', { name: '取消删除 bilimi:音乐' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '取消删除 bilimi:自建' })).toBeEnabled()
    fireEvent.click(bulk)
    expect(bulk).toHaveTextContent('全选')
    expect(screen.getByRole('button', { name: '加入删除 bilimi:音乐' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '取消删除模式' }))
    expect(screen.getByRole('button', { name: '移出同步 bilimi:音乐' })).toBeDisabled()
  })

  it('starts the ledger list expanded and folds it with the existing toggle', () => {
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

    expect(screen.getByRole('button', { name: '收藏夹16' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '折叠' }))
    expect(screen.queryByRole('button', { name: '收藏夹16' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument()
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

  it('persists a pending normal toggle before deletion mode', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '移出同步 bilimi·科技' }))
    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    await act(async () => {})

    expect(save).not.toHaveBeenCalled()
    expect(saveEnabled).toHaveBeenCalledWith('tech', false)
  })

  it('keeps the latest normal selections when a custom configuration is deleted locally', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['tech'] })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion: vi.fn(),
        deleteManagedFavoriteFolders: vi.fn()
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

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['tech']))
    expect(saveEnabled).toHaveBeenCalledWith('music', true)
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '移出同步 bilimi·音乐' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '科技' })).not.toBeInTheDocument()
  })

  it('resets a selected default card locally without deleting its Bilibili folder or the card', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'knowledge', remoteFolderId: 'remote-knowledge', title: 'bilimi·知识', memberCount: 1 }
    ])
    const deleteManagedFavoriteFolders = vi.fn()
    const releaseDefaultFavoriteLedgerBindings = vi.fn().mockResolvedValue({
      status: 'succeeded', ledgerIds: ['knowledge'], remoteFolderIds: ['remote-knowledge']
    })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion,
        deleteManagedFavoriteFolders,
        releaseDefaultFavoriteLedgerBindings
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true, bilibiliFolderId: 'remote-knowledge' },
    ]} missingLedgerIds={[]} onSaveLedgers={save} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    expect(screen.getByRole('button', { name: '加入删除 bilimi·知识' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·知识' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'knowledge', displayName: 'bilimi·知识学习', bindingState: 'unbound' })
    ], { deleteDisabled: false }))
    expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalledWith('100', ['knowledge'], { knowledge: 'bilimi·知识' })
    expect(deleteManagedFavoriteFolders).not.toHaveBeenCalled()
    expect(screen.getByTestId('favorite-ledger-chip-knowledge')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-ledger-chip-knowledge')).toHaveTextContent('未绑定')
  })

  it('does not offer a Bilibili deletion path for a custom configuration without a formal binding', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['custom-tech'] })
    const previewManagedFavoriteFolderDeletion = vi.fn()
    const deleteManagedFavoriteFolders = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion,
        deleteManagedFavoriteFolders
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[
      { id: 'custom-tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 10, isDefault: false, bilibiliFolderId: 'remote-tech' }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·科技' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['custom-tech']))
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(deleteManagedFavoriteFolders).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
  })

  it('removes a transient local draft from delete mode without persisting it', async () => {
    const deleteFavoriteLedgersLocal = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion: vi.fn(),
        deleteManagedFavoriteFolders: vi.fn()
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[
      { id: 'tech', displayName: 'bilimi·科技', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByRole('textbox', { name: '册名' }), { target: { value: '临时草稿' } })
    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·临时草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '临时草稿' })).not.toBeInTheDocument())
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '科技' })).toBeInTheDocument()
  })

  it('backs up only saved selected ledgers', async () => {
    const sync = vi.fn().mockResolvedValue({ ok: true })
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'enabled', displayName: 'bilimi·已勾选', keywords: [], enabled: true, priority: 10, isDefault: false },
      { id: 'unchecked', displayName: 'bilimi·未勾选', keywords: [], enabled: false, priority: 20, isDefault: false },
      { id: 'draft', displayName: 'bilimi·草稿', keywords: [], enabled: true, priority: 30, isDefault: false, syncState: 'local-draft' }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    await waitFor(() => expect(sync).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'enabled', enabled: true })
    ], { backupTargetLedgerIds: ['enabled'], deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }))
  })

  it('keeps a selected default card while deleting its actual Bilibili folder', async () => {
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['remote-music'], failedRemoteFolderIds: [],
      unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const save = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'music', remoteFolderId: 'remote-music', title: 'bilimi·音乐', memberCount: 3, state: 'bound', requiresUnboundAcknowledgement: false }
        ]),
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: true, bilibiliFolderId: 'remote-music', bindingState: 'bound' }
    ]} missingLedgerIds={[]} onSaveLedgers={save} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    expect(screen.getByRole('button', { name: '加入删除 bilimi·音乐' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(screen.getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledWith(
      '100', ['music'], false, { music: 'bilimi·音乐' }, { music: ['remote-music'] }
    ))
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByTestId('favorite-ledger-chip-music')).toHaveTextContent('未备册')
  })

  it('previews an unbound default folder without remote ids before allowing its confirmed absence to be deleted', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'music', title: 'bilimi·音乐', memberCount: 0, state: 'local-only', requiresUnboundAcknowledgement: false }
    ])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      isDefault: true, bindingState: 'unbound'
    }]} missingLedgerIds={[]} unboundLedgerIds={['music']} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    await waitFor(() => expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalledWith(
      '100', ['music'], { music: 'bilimi·音乐' }
    ))
    expect(screen.getByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).toBeInTheDocument()
  })

  it('requires the existing acknowledgement and records every confirmed same-title remote id beside a bound default folder', async () => {
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['bound-music', 'unbound-music'], failedRemoteFolderIds: [],
      unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const save = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'music', remoteFolderId: 'bound-music', title: 'bilimi·音乐', memberCount: 1, state: 'bound', requiresUnboundAcknowledgement: false },
          { logicalLedgerId: 'music', remoteFolderId: 'unbound-music', title: 'bilimi·音乐', memberCount: 2, state: 'unbound-name-match', requiresUnboundAcknowledgement: true }
        ]),
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: true,
      bilibiliFolderId: 'bound-music', bilibiliFolderIds: ['bound-music'], bindingState: 'bound'
    }]} missingLedgerIds={[]} onSaveLedgers={save} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(screen.getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /已检测到未绑定的 bilimi 收藏夹/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledWith(
      '100', ['music'], true, { music: 'bilimi·音乐' }, { music: ['bound-music', 'unbound-music'] }
    ))
    expect(save).not.toHaveBeenCalled()
  })

  it('passes a missing-formal-shard history id as an exact deletion target', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'game', remoteFolderId: '4115311554', title: 'bilimi·游戏专区·2', memberCount: 2, state: 'unbound-historical-id', requiresUnboundAcknowledgement: true }
    ])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[{
      id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true, priority: 10, isDefault: true,
      bindingState: 'unbacked', historicalBilibiliFolderIds: ['4115311554'], historicalBilibiliFolderTitle: 'bilimi·游戏专区·2'
    }]} missingLedgerIds={['game']} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·游戏专区' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(dialog).toHaveTextContent('历史分册 / 精确 ID 核验')
    expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalledWith(
      '100',
      ['game'],
      { game: 'bilimi·游戏专区' },
      undefined,
      { game: [{ remoteFolderId: '4115311554', title: 'bilimi·游戏专区·2' }] }
    )
  })

  it('groups same-title bound and unbound shards under one logical deletion group with one acknowledgement', async () => {
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'game', remoteFolderId: 'bound-game-1', title: 'bilimi·游戏专区', memberCount: 311, state: 'bound', requiresUnboundAcknowledgement: false },
      { logicalLedgerId: 'game', remoteFolderId: 'unbound-game-2', title: 'bilimi·游戏专区·2', memberCount: 1000, state: 'unbound-historical-id', requiresUnboundAcknowledgement: true }
    ])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[{
      id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true, priority: 10, isDefault: true,
      bilibiliFolderId: 'bound-game-1', bilibiliFolderIds: ['bound-game-1'], bindingState: 'bound'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·游戏专区' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    const group = within(dialog).getByTestId('managed-deletion-group-game')
    expect(group).toHaveTextContent('bilimi·游戏专区')
    expect(group).toHaveTextContent('bilimi·游戏专区·2')
    expect(within(dialog).getAllByRole('checkbox', { name: /已检测到未绑定的 bilimi 收藏夹/ })).toHaveLength(1)
  })

  it('does not count historical remote shards that are absent from the current inventory', async () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'honker', remoteFolderId: 'current-honker', title: 'bilimi·honker233', memberCount: 0, state: 'bound', requiresUnboundAcknowledgement: false },
          { logicalLedgerId: 'honker', remoteFolderId: 'old-honker-1', title: 'bilimi·honker233', memberCount: 0, state: 'missing-remote', requiresUnboundAcknowledgement: false },
          { logicalLedgerId: 'honker', remoteFolderId: 'old-honker-2', title: 'bilimi·honker233', memberCount: 0, state: 'missing-remote', requiresUnboundAcknowledgement: false }
        ])
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[{
      id: 'honker', displayName: 'bilimi·honker233', keywords: [], enabled: true, priority: 10, isDefault: false,
      bilibiliFolderId: 'current-honker', bilibiliFolderIds: ['current-honker'], bindingState: 'bound'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·honker233' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(within(dialog).getByTestId('managed-deletion-group-honker')).toHaveTextContent('honker233（1 个分册）')
    expect(within(dialog).getByTestId('managed-deletion-group-honker')).toHaveTextContent('历史分册 / 远端已不存在')
  })

  it('passes explicit acknowledgement when deleting an unbound name-matched default folder', async () => {
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['remote-music'], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    const save = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'music', remoteFolderId: 'remote-music', title: 'bilimi·音乐', memberCount: 3, state: 'unbound-name-match', requiresUnboundAcknowledgement: true }
        ]),
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: true,
      bilibiliFolderId: 'remote-music', bindingState: 'unbound'
    }]} missingLedgerIds={[]} onSaveLedgers={save} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    fireEvent.click(screen.getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /已检测到未绑定的 bilimi 收藏夹/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledWith(
      '100', ['music'], true, { music: 'bilimi·音乐' }, { music: ['remote-music'] }
    ))
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
  })

  it('includes a selected remote-only draft in the acknowledged Bilibili deletion plan', async () => {
    const deleteFavoriteLedgerDraft = vi.fn().mockResolvedValue(undefined)
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: ['remote-draft'], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgerDraft,
        previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
          { logicalLedgerId: 'remote-draft', remoteFolderId: 'remote-draft', title: 'bilimi·远端草稿', memberCount: 2, state: 'unbound-name-match', requiresUnboundAcknowledgement: true }
        ]),
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[{
      id: 'remote-draft', displayName: 'bilimi·远端草稿', keywords: [], enabled: true, priority: 10, isDefault: false,
      syncState: 'local-draft', bindingState: 'unbound', bilibiliFolderId: 'remote-draft'
    }]} remoteOnlyDraftLedgerIds={['remote-draft']} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·远端草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(screen.getByRole('alertdialog')).toHaveTextContent('未保存 · 未绑定 / 仅名称识别')
    fireEvent.click(screen.getByRole('radio', { name: '同时从 B 站删除收藏夹（保留收藏库）' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /已检测到未绑定的 bilimi 收藏夹/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteManagedRemoteFolders).toHaveBeenCalledWith(
      '100', [], true, {}, { 'remote-draft': ['remote-draft'] }, {
        'remote-draft': { remoteFolderId: 'remote-draft', title: 'bilimi·远端草稿' }
      }
    ))
    expect(deleteFavoriteLedgerDraft).toHaveBeenCalledWith('100', 'remote-draft')
    expect(screen.queryByRole('button', { name: '远端草稿' })).not.toBeInTheDocument()
  })

  it('confirms a saved local-only ledger before deleting its local configuration', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['local-only'] })
    const previewFavoriteLibraryManagedFolderDelete = vi.fn()
    const deleteFavoriteLibraryManagedFoldersLocal = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion: vi.fn(),
        deleteManagedFavoriteFolders: vi.fn(),
        previewFavoriteLibraryManagedFolderDelete,
        deleteFavoriteLibraryManagedFoldersLocal
      }
    })
    render(<FavoriteLedgerOverview defaultFavoriteSystemEnabled={false} ledgers={[
      { id: 'local-only', displayName: 'bilimi路鍦ㄦ湰', keywords: [], enabled: true, priority: 10, bindingState: 'unbound', isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(document.querySelector('.favorite-ledger-panel__mode-toggle')!)
    fireEvent.click(document.querySelector('[data-testid="favorite-ledger-chip-local-only"] .favorite-ledger-panel__chip-action')!)
    fireEvent.click(document.querySelector('[aria-label="备册收藏夹"]')!)

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(dialog).toHaveTextContent('bilimi路鍦ㄦ湰')
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['local-only']))
    expect(previewFavoriteLibraryManagedFolderDelete).not.toHaveBeenCalled()
    expect(deleteFavoriteLibraryManagedFoldersLocal).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument())
  })

  it('deletes a local-only ledger with the supplied account identity without reading Bilibili', async () => {
    const readBilibiliAccountMid = vi.fn().mockRejectedValue(new Error('Bilibili page unavailable'))
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['local-only'] })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: { readBilibiliAccountMid, deleteFavoriteLedgersLocal }
    })

    render(<FavoriteLedgerOverview {...({ currentAccountMid: '100' } as any)}
      defaultFavoriteSystemEnabled={false}
      ledgers={[{ id: 'local-only', displayName: 'bilimi·本地', keywords: [], enabled: true, priority: 10, bindingState: 'unbacked', isDefault: false }]}
      missingLedgerIds={[]} openLedgerId="local-only" openLedgerRequestVersion={1} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['local-only']))
    expect(readBilibiliAccountMid).not.toHaveBeenCalled()
  })

  it('does not route an ordinary saved rule through the recommendation toggle after the workspace is closed', () => {
    const onOrganizationRecommendationToggle = vi.fn().mockResolvedValue(true)
    const onSyncLedgers = vi.fn()
    const provisionOldFavoriteWorkspaceBilibiliExecutionPreflightShardsV1 = vi.fn()
    const releaseDefaultFavoriteLedgerBindings = vi.fn()
    const deleteManagedRemoteFolders = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        provisionOldFavoriteWorkspaceBilibiliExecutionPreflightShardsV1,
        releaseDefaultFavoriteLedgerBindings,
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview
      ledgers={[{
        id: 'recommended-after-end', displayName: 'bilimi·结束后推荐', keywords: ['结束后'], enabled: true,
        priority: 10, syncState: 'local-draft', ruleOrigin: 'recommendation-draft', isDefault: false
      }]}
      missingLedgerIds={[]}
      organizationActive={false}
      onOrganizationRecommendationToggle={onOrganizationRecommendationToggle}
      onSaveLedgers={vi.fn()}
      onSyncLedgers={onSyncLedgers}
    />)

    expect(screen.getByRole('button', { name: '移出同步 bilimi·结束后推荐' })).toBeDisabled()
    expect(onOrganizationRecommendationToggle).not.toHaveBeenCalled()
    expect(provisionOldFavoriteWorkspaceBilibiliExecutionPreflightShardsV1).not.toHaveBeenCalled()
    expect(releaseDefaultFavoriteLedgerBindings).not.toHaveBeenCalled()
    expect(deleteManagedRemoteFolders).not.toHaveBeenCalled()
    expect(onSyncLedgers).not.toHaveBeenCalled()
  })

  it('confirms a remote draft and saved custom ledger together before local deletion', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['remote-draft', 'saved'] })
    const previewManagedFavoriteFolderDeletion = vi.fn()
    const deleteManagedFavoriteFolders = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion,
        deleteManagedFavoriteFolders
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      {
        id: 'remote-draft', displayName: 'bilimi·远端草稿', keywords: [], enabled: false, priority: 10,
        bilibiliFolderId: '88', bindingState: 'unbound', syncState: 'local-draft', isDefault: false
      },
      { id: 'saved', displayName: 'bilimi·已保存', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    const remoteDraftToggle = screen.getByRole('button', { name: '加入删除 bilimi·远端草稿' })
    expect(remoteDraftToggle).toBeEnabled()
    fireEvent.click(remoteDraftToggle)
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·已保存' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(dialog).toHaveTextContent('bilimi·远端草稿')
    expect(dialog).toHaveTextContent('bilimi·已保存')
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['remote-draft', 'saved']))
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(deleteManagedFavoriteFolders).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '远端草稿' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '已保存' })).not.toBeInTheDocument()
  })

  it('deletes a saved custom ledger from its editor through local configuration deletion', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['saved'] })
    const previewManagedFavoriteFolderDeletion = vi.fn()
    const deleteManagedFavoriteFolders = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion,
        deleteManagedFavoriteFolders
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'saved', displayName: 'bilimi·已保存', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '已保存' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['saved']))
    expect(previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(deleteManagedFavoriteFolders).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog', { name: '删除 bilimi 收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '已保存' })).not.toBeInTheDocument()
  })

  it('confirms a remote-identified custom ledger before editor deletion', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['remote-saved'] })
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([{
      logicalLedgerId: 'remote-saved', remoteFolderId: 'remote-saved-folder', title: 'bilimi·远端已保存', memberCount: 4,
      state: 'bound', requiresUnboundAcknowledgement: false
    }])
    const deleteManagedRemoteFolders = vi.fn()
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview ledgers={[{
      id: 'remote-saved', displayName: 'bilimi·远端已保存', keywords: [], enabled: true, priority: 10, isDefault: false,
      bilibiliFolderId: 'remote-saved-folder', bindingState: 'bound'
    }]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '远端已保存' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalledWith('100', ['remote-saved'], { 'remote-saved': 'bilimi·远端已保存' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['remote-saved']))
    expect(deleteManagedRemoteFolders).not.toHaveBeenCalled()
  })

  it('shows local and remote deletion candidates in one confirmation dialog', async () => {
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['local'] })
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'remote', remoteFolderId: 'remote-folder', title: 'bilimi·远端', memberCount: 4, state: 'bound', requiresUnboundAcknowledgement: false }
    ])
    const deleteManagedRemoteFolders = vi.fn().mockResolvedValue({
      status: 'succeeded', succeededRemoteFolderIds: [], failedRemoteFolderIds: [], unknownRemoteFolderIds: [], unattemptedRemoteFolderIds: [], failures: []
    })
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        deleteFavoriteLedgersLocal,
        previewManagedFavoriteFolderDeletion,
        deleteManagedRemoteFolders
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'remote', displayName: 'bilimi·远端', keywords: [], enabled: true, priority: 10, isDefault: false, bindingState: 'bound', bilibiliFolderId: 'remote-folder' },
      { id: 'local', displayName: 'bilimi·本地', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开删除模式' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·远端' }))
    fireEvent.click(screen.getByRole('button', { name: '加入删除 bilimi·本地' }))
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))

    const dialog = await screen.findByRole('alertdialog', { name: '删除 bilimi 收藏夹' })
    expect(dialog).toHaveTextContent('bilimi·远端')
    expect(dialog).toHaveTextContent('bilimi·本地')
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    expect(deleteManagedRemoteFolders).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我已确认' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['remote', 'local']))
    expect(deleteManagedRemoteFolders).not.toHaveBeenCalled()
  })
})
