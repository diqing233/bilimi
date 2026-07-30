import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let workspaceRenderCount = 0
type PatchMeta = { originId: string; mutationId: number }

vi.mock('./FloatingAssistantApp', () => ({
  FloatingAssistantApp: () => {
    workspaceRenderCount += 1
    return <input aria-label="侧边栏工作区状态" defaultValue="保留我" />
  }
}))

import { AssistantSidebar } from './AssistantSidebar'
import { createInitialAssistantPreferences } from '../state/assistantState'

function installDesktopApi({
  width = null,
  patchPreferences
}: {
  width?: number | null
  patchPreferences?: (patch: { assistantSidebarWidthPx?: number | null }, meta?: PatchMeta) => Promise<unknown>
} = {}) {
  const preferences = createInitialAssistantPreferences({ assistantSidebarWidthPx: width })
  let patchChanged: ((patch: { assistantSidebarWidthPx?: number | null }, meta?: PatchMeta) => void) | undefined
  let workspaceChanged: ((payload: { tab?: 'review' | 'notes' | 'ledger' | 'settings'; ledgerId?: string; createLedger?: boolean; sidebar?: boolean }) => void) | undefined
  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      loadPreferences: vi.fn(async () => preferences),
      onOpenAssistant: vi.fn(() => vi.fn()),
      onOpenFloatingAssistantWorkspace: vi.fn((callback) => {
        workspaceChanged = callback
        return vi.fn()
      }),
      onAssistantPreferencesChanged: vi.fn(() => vi.fn()),
      onAssistantPreferencePatchChanged: vi.fn((callback) => {
        patchChanged = callback
        return vi.fn()
      }),
      patchPreferences: vi.fn(patchPreferences ?? (async () => preferences)),
      setAssistantPetHint: vi.fn()
    }
  })
  return {
    notifyPatch: (patch: { assistantSidebarWidthPx?: number | null }, meta?: PatchMeta) => patchChanged?.(patch, meta),
    openWorkspace: (payload: { tab?: 'review' | 'notes' | 'ledger' | 'settings'; ledgerId?: string; createLedger?: boolean; sidebar?: boolean }) => workspaceChanged?.(payload),
    patchPreferences: window.bilimiDesktop.patchPreferences as ReturnType<typeof vi.fn>
  }
}

describe('AssistantSidebar render isolation', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 })
    workspaceRenderCount = 0
    vi.useFakeTimers()
    installDesktopApi()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the mounted workspace out of collapse and expand chrome renders', async () => {
    render(<AssistantSidebar />)
    await act(async () => undefined)
    const workspaceState = screen.getByRole('textbox', { name: '侧边栏工作区状态' })
    fireEvent.change(workspaceState, { target: { value: '用户未提交的内容' } })
    expect(workspaceRenderCount).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))
    expect(workspaceRenderCount).toBe(1)
    expect(screen.getByRole('complementary', { name: 'bilimi 侧边栏' })).toHaveAttribute('data-closing', 'true')

    act(() => vi.advanceTimersByTime(220))
    expect(workspaceRenderCount).toBe(1)
    expect(workspaceState).toHaveValue('用户未提交的内容')

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    expect(workspaceRenderCount).toBe(1)
    act(() => vi.runOnlyPendingTimers())
    expect(workspaceRenderCount).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))
    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))
    act(() => vi.runOnlyPendingTimers())
    expect(workspaceRenderCount).toBe(1)
    expect(workspaceState).toHaveValue('用户未提交的内容')
  })

  it('keeps the mounted workspace out of the complete resize and delayed save cycle', async () => {
    installDesktopApi({ width: 360 })
    render(<AssistantSidebar />)
    await act(async () => undefined)
    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })
    const renderCountBeforeResize = workspaceRenderCount

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 7 })
    expect(workspaceRenderCount).toBe(renderCountBeforeResize)
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 7 })
    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '380px' })
    expect(workspaceRenderCount).toBe(renderCountBeforeResize)
    fireEvent.pointerUp(window, { clientX: 80, pointerId: 7 })
    expect(workspaceRenderCount).toBe(renderCountBeforeResize)

    act(() => vi.advanceTimersByTime(200))
    await act(async () => undefined)
    expect(workspaceRenderCount).toBe(renderCountBeforeResize)
  })

  it('does not throw when width persistence runs without a desktop preload', async () => {
    render(<AssistantSidebar />)
    await act(async () => undefined)
    Object.defineProperty(window, 'bilimiDesktop', { configurable: true, value: undefined })
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 8 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 8 })
    fireEvent.pointerUp(window, { clientX: 80, pointerId: 8 })

    act(() => vi.advanceTimersByTime(200))
    await act(async () => undefined)
  })

  it('does not let an older local save echo overwrite a newer dragged width', async () => {
    let finishFirstSave: (() => void) | undefined
    const api = installDesktopApi({
      width: 360,
      patchPreferences: () => new Promise<void>((resolve) => { finishFirstSave = resolve })
    })
    render(<AssistantSidebar />)
    await act(async () => undefined)
    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 9 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 9 })
    fireEvent.pointerUp(window, { pointerId: 9 })
    act(() => vi.advanceTimersByTime(200))
    expect(api.patchPreferences).toHaveBeenCalledWith({ assistantSidebarWidthPx: 380 }, expect.any(Object))

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 80, pointerId: 10 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 40, pointerId: 10 })
    fireEvent.pointerUp(window, { pointerId: 10 })
    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '420px' })

    const firstMeta = api.patchPreferences.mock.calls[0][1] as PatchMeta
    act(() => api.notifyPatch({ assistantSidebarWidthPx: 380 }, firstMeta))
    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '420px' })
    act(() => vi.advanceTimersByTime(200))
    expect(api.patchPreferences).toHaveBeenLastCalledWith({ assistantSidebarWidthPx: 420 }, expect.any(Object))
    finishFirstSave?.()
  })

  it('still accepts an external width update that is not a stale local save echo', async () => {
    const api = installDesktopApi({ width: 360 })
    render(<AssistantSidebar />)
    await act(async () => undefined)
    const sidebar = screen.getByRole('complementary', { name: 'bilimi 侧边栏' })

    act(() => api.notifyPatch({ assistantSidebarWidthPx: 440 }, { originId: 'another-window', mutationId: 1 }))

    expect(sidebar).toHaveStyle({ '--assistant-sidebar-width': '440px' })
  })

  it('issues monotonic mutations for repeated widths and ignores only its own stale echo', async () => {
    const api = installDesktopApi({ width: 360 })
    render(<AssistantSidebar />)
    await act(async () => undefined)
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })

    for (const pointerId of [11, 12]) {
      fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId })
      fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId })
      fireEvent.pointerUp(window, { pointerId })
      act(() => vi.advanceTimersByTime(200))
    }

    const firstMeta = api.patchPreferences.mock.calls[0][1] as PatchMeta
    const secondMeta = api.patchPreferences.mock.calls[1][1] as PatchMeta
    expect(secondMeta.originId).toBe(firstMeta.originId)
    expect(secondMeta.mutationId).toBe(firstMeta.mutationId + 1)
  })

  it('keeps later mutations valid when an earlier save rejects', async () => {
    const api = installDesktopApi({
      width: 360,
      patchPreferences: vi.fn()
        .mockRejectedValueOnce(new Error('disk busy'))
        .mockResolvedValueOnce(undefined)
    })
    render(<AssistantSidebar />)
    await act(async () => undefined)
    const resizeHandle = screen.getByRole('separator', { name: '调整侧边栏宽度' })

    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 100, pointerId: 13 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 80, pointerId: 13 })
    fireEvent.pointerUp(window, { pointerId: 13 })
    act(() => vi.advanceTimersByTime(200))
    await act(async () => undefined)
    fireEvent.pointerDown(resizeHandle, { button: 0, buttons: 1, clientX: 80, pointerId: 14 })
    fireEvent.pointerMove(window, { buttons: 1, clientX: 60, pointerId: 14 })
    fireEvent.pointerUp(window, { pointerId: 14 })
    act(() => vi.advanceTimersByTime(200))

    expect(api.patchPreferences.mock.calls[1][1].mutationId).toBeGreaterThan(api.patchPreferences.mock.calls[0][1].mutationId)
  })

  it('rerenders the workspace for a real ledger request while chrome updates stay isolated', async () => {
    const api = installDesktopApi()
    render(<AssistantSidebar />)
    await act(async () => undefined)
    expect(workspaceRenderCount).toBe(1)

    act(() => api.openWorkspace({ tab: 'ledger', ledgerId: 'music', createLedger: true, sidebar: true }))

    expect(workspaceRenderCount).toBe(2)
  })
})
