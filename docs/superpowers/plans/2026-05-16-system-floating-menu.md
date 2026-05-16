# System Floating Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real system-level floating action menu that opens beside the desktop seal and dispatches actions to the main Bilimi window.

**Architecture:** Keep the existing floating seal as its own Electron window and add a second transparent `floating-menu` window routed through the existing React renderer entry. The menu UI only captures user intent; Electron main bridges action requests into the main renderer, where `AssistantOverlay` already owns active webview automation.

**Tech Stack:** Electron, electron-vite, React, TypeScript, Vitest, Testing Library.

---

## File Structure

- `electron/main/floatingSealGeometry.ts`
  - Add `createFloatingMenuBounds`, a pure geometry helper for system menu placement.
- `electron/main/floatingSealGeometry.test.ts`
  - Add edge and flip tests for system menu bounds.
- `electron/main/assistantActionSignal.ts`
  - New helper mirroring `assistantOpenSignal.ts`, but for action dispatch to the main renderer.
- `electron/main/assistantActionSignal.test.ts`
  - Unit tests for immediate and delayed action dispatch.
- `electron/main/floatingMenuController.ts`
  - New testable lifecycle controller for a single floating menu window reference.
- `electron/main/floatingMenuController.test.ts`
  - Unit tests for create, close, toggle, destroyed-window cleanup, and closed-window cleanup.
- `electron/main/index.ts`
  - Add `floatingMenuWindow` lifecycle, IPC handlers, and bridge menu actions to the main renderer.
- `electron/preload/index.ts`
  - Expose menu APIs to floating seal/menu renderers and an action listener to the main renderer.
- `src/renderer/src/global.d.ts`
  - Add typings for the new preload APIs.
- `src/renderer/src/features/assistant/FloatingSealApp.tsx`
  - Switch click behavior from opening the main-window panel to toggling the system menu.
- `src/renderer/src/features/assistant/FloatingSealApp.test.tsx`
  - Update click expectation and keep drag suppression tests.
- `src/renderer/src/features/assistant/FloatingMenuApp.tsx`
  - New system menu renderer for `赞 / 藏 / 评 / 阅` labels mapped to existing `赏 / 藏 / 表 / 阅` action values.
- `src/renderer/src/features/assistant/FloatingMenuApp.test.tsx`
  - Verify rendering, dispatch, and close behavior.
- `src/renderer/src/features/assistant/AssistantOverlay.tsx`
  - Add optional external action signal support so main-window automation can be triggered by the system menu.
- `src/renderer/src/features/assistant/assistantOverlay.test.tsx`
  - Verify external action signal routes to existing action behavior.
- `src/renderer/src/App.tsx`
  - Listen for `assistant:run-action` and pass it to `AssistantOverlay`.
- `src/renderer/src/App.test.tsx`
  - Verify menu-initiated action uses the active internal tab.
- `src/renderer/src/main.tsx`
  - Route `window=floating-menu` to `FloatingMenuApp`.
- `src/renderer/src/styles.css`
  - Add compact transparent menu styling.

---

### Task 1: System Menu Geometry

**Files:**
- Modify: `electron/main/floatingSealGeometry.ts`
- Modify: `electron/main/floatingSealGeometry.test.ts`

- [ ] **Step 1: Write the failing geometry tests**

Append these tests to `electron/main/floatingSealGeometry.test.ts`:

```ts
import { createFloatingMenuBounds } from './floatingSealGeometry'

describe('floating menu geometry', () => {
  it('places the system menu above the seal when there is room', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 900, y: 520, width: 92, height: 92 },
        menuSize: { width: 156, height: 214 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 868, y: 294, width: 156, height: 214 })
  })

  it('flips the system menu below the seal near the top edge', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 900, y: 24, width: 92, height: 92 },
        menuSize: { width: 156, height: 214 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 868, y: 128, width: 156, height: 214 })
  })

  it('clamps the system menu inside the active work area', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 1210, y: 790, width: 92, height: 92 },
        menuSize: { width: 156, height: 214 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 1112, y: 564, width: 156, height: 214 })
  })

  it('supports work areas with negative screen coordinates', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: -1200, y: 500, width: 92, height: 92 },
        menuSize: { width: 156, height: 214 },
        workArea: { x: -1280, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: -1232, y: 274, width: 156, height: 214 })
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- electron/main/floatingSealGeometry.test.ts
```

Expected:

```text
FAIL electron/main/floatingSealGeometry.test.ts
createFloatingMenuBounds is not exported
```

- [ ] **Step 3: Implement the minimal geometry helper**

Append this to `electron/main/floatingSealGeometry.ts`:

```ts
export function createFloatingMenuBounds({
  sealBounds,
  menuSize,
  workArea,
  gap = DEFAULT_GAP
}: {
  sealBounds: Bounds
  menuSize: Size
  workArea: Bounds
  gap?: number
}): Bounds {
  const centeredX = sealBounds.x + Math.round((sealBounds.width - menuSize.width) / 2)
  const aboveY = sealBounds.y - menuSize.height - gap
  const belowY = sealBounds.y + sealBounds.height + gap
  const preferredY =
    aboveY >= workArea.y
      ? aboveY
      : belowY + menuSize.height <= workArea.y + workArea.height
        ? belowY
        : sealBounds.y >= workArea.y + workArea.height / 2
          ? aboveY
          : belowY

  const minX = workArea.x + gap
  const maxX = workArea.x + workArea.width - menuSize.width - gap
  const minY = workArea.y + gap
  const maxY = workArea.y + workArea.height - menuSize.height - gap

  return {
    x: clamp(Math.round(centeredX), minX, Math.max(minX, maxX)),
    y: clamp(Math.round(preferredY), minY, Math.max(minY, maxY)),
    width: menuSize.width,
    height: menuSize.height
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run test -- electron/main/floatingSealGeometry.test.ts
```

Expected:

```text
PASS electron/main/floatingSealGeometry.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add electron/main/floatingSealGeometry.ts electron/main/floatingSealGeometry.test.ts
git commit -m "feat: calculate system floating menu bounds"
```

---

### Task 2: Main Renderer Action Signal Helper

**Files:**
- Create: `electron/main/assistantActionSignal.ts`
- Create: `electron/main/assistantActionSignal.test.ts`

- [ ] **Step 1: Write the failing action signal tests**

Create `electron/main/assistantActionSignal.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { sendAssistantActionWhenReady } from './assistantActionSignal'

function createAssistantActionTarget(isLoading: boolean) {
  let finishLoad: (() => void) | undefined
  const send = vi.fn()
  const once = vi.fn((event: string, callback: () => void) => {
    if (event === 'did-finish-load') {
      finishLoad = callback
    }
  })

  return {
    finishLoad: () => finishLoad?.(),
    target: {
      isDestroyed: () => false,
      webContents: {
        isLoading: () => isLoading,
        once,
        send
      }
    },
    once,
    send
  }
}

describe('sendAssistantActionWhenReady', () => {
  it('sends the assistant action immediately when the renderer is loaded', () => {
    const { target, send, once } = createAssistantActionTarget(false)

    sendAssistantActionWhenReady(target, { action: '赏' })

    expect(send).toHaveBeenCalledWith('assistant:run-action', { action: '赏' })
    expect(once).not.toHaveBeenCalled()
  })

  it('waits for the renderer load to finish before sending the action', () => {
    const { finishLoad, target, send, once } = createAssistantActionTarget(true)

    sendAssistantActionWhenReady(target, { action: '藏' })

    expect(send).not.toHaveBeenCalled()
    expect(once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))

    finishLoad()

    expect(send).toHaveBeenCalledWith('assistant:run-action', { action: '藏' })
  })

  it('does not send to a destroyed target', () => {
    const send = vi.fn()

    sendAssistantActionWhenReady(
      {
        isDestroyed: () => true,
        webContents: {
          isLoading: () => false,
          once: vi.fn(),
          send
        }
      },
      { action: '阅' }
    )

    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- electron/main/assistantActionSignal.test.ts
```

Expected:

```text
FAIL electron/main/assistantActionSignal.test.ts
Failed to resolve import "./assistantActionSignal"
```

- [ ] **Step 3: Implement the action signal helper**

Create `electron/main/assistantActionSignal.ts`:

```ts
import type { AssistantAction } from '../../src/shared/types'

type AssistantActionTarget = {
  isDestroyed: () => boolean
  webContents: {
    isLoading: () => boolean
    once: (event: 'did-finish-load', callback: () => void) => void
    send: (channel: 'assistant:run-action', payload: AssistantActionPayload) => void
  }
}

export type AssistantActionPayload = {
  action: AssistantAction
}

export function sendAssistantActionWhenReady(
  target: AssistantActionTarget,
  payload: AssistantActionPayload
) {
  const sendActionSignal = () => {
    if (!target.isDestroyed()) {
      target.webContents.send('assistant:run-action', payload)
    }
  }

  if (target.webContents.isLoading()) {
    target.webContents.once('did-finish-load', sendActionSignal)
    return
  }

  sendActionSignal()
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run test -- electron/main/assistantActionSignal.test.ts
```

Expected:

```text
PASS electron/main/assistantActionSignal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add electron/main/assistantActionSignal.ts electron/main/assistantActionSignal.test.ts
git commit -m "feat: add assistant action signal helper"
```

---

### Task 3: Floating Menu Renderer

**Files:**
- Create: `src/renderer/src/features/assistant/FloatingMenuApp.tsx`
- Create: `src/renderer/src/features/assistant/FloatingMenuApp.test.tsx`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: Write the failing floating menu tests**

Create `src/renderer/src/features/assistant/FloatingMenuApp.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatingMenuApp } from './FloatingMenuApp'

describe('FloatingMenuApp', () => {
  it('renders the system menu actions', () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        closeFloatingMenu: vi.fn(),
        runFloatingMenuAction: vi.fn()
      }
    })

    render(<FloatingMenuApp />)

    expect(screen.getByRole('menu', { name: 'Bilimi 悬浮动作' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '赞' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '藏' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '评' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '阅' })).toBeInTheDocument()
  })

  it('dispatches a menu action through the desktop bridge', async () => {
    const runFloatingMenuAction = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        closeFloatingMenu: vi.fn(),
        runFloatingMenuAction
      }
    })

    render(<FloatingMenuApp />)

    fireEvent.click(screen.getByRole('menuitem', { name: '藏' }))

    await waitFor(() => expect(runFloatingMenuAction).toHaveBeenCalledWith('藏'))
  })

  it('closes the menu from the close button', () => {
    const closeFloatingMenu = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        closeFloatingMenu,
        runFloatingMenuAction: vi.fn()
      }
    })

    render(<FloatingMenuApp />)

    fireEvent.click(screen.getByRole('button', { name: '收起悬浮菜单' }))

    expect(closeFloatingMenu).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingMenuApp.test.tsx
```

Expected:

```text
FAIL src/renderer/src/features/assistant/FloatingMenuApp.test.tsx
Failed to resolve import "./FloatingMenuApp"
```

- [ ] **Step 3: Add preload and global typings for menu APIs**

Update `src/renderer/src/global.d.ts` by adding these fields to `BilimiDesktopApi`:

```ts
  closeFloatingMenu?: () => void
  onRunAssistantAction?: (callback: (payload: { action: AssistantAction }) => void) => () => void
  runFloatingMenuAction?: (action: AssistantAction) => Promise<void>
  toggleFloatingMenu?: () => Promise<void>
```

Also update the imports at the top of `global.d.ts`:

```ts
import type { AssistantAction, AssistantPreferences, VideoNote } from '@shared/types'
```

Update `electron/preload/index.ts` inside `contextBridge.exposeInMainWorld('bilimiDesktop', { ... })`:

```ts
  closeFloatingMenu: () => ipcRenderer.send('floating-menu:close'),
  runFloatingMenuAction: (action: AssistantAction) =>
    ipcRenderer.invoke('floating-menu:run-action', action) as Promise<void>,
  toggleFloatingMenu: () => ipcRenderer.invoke('floating-menu:toggle') as Promise<void>,
  onRunAssistantAction: (callback: (payload: { action: AssistantAction }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { action: AssistantAction }
    ) => callback(payload)

    ipcRenderer.on('assistant:run-action', listener)

    return () => {
      ipcRenderer.removeListener('assistant:run-action', listener)
    }
  },
```

Update the preload imports:

```ts
import type { AssistantAction, VideoNote } from '../../src/shared/types'
```

- [ ] **Step 4: Implement the menu component and route**

Create `src/renderer/src/features/assistant/FloatingMenuApp.tsx`:

```tsx
import type { AssistantAction } from '@shared/types'
import { useState } from 'react'

const FLOATING_MENU_ACTIONS: Array<{ action: AssistantAction; label: string; hint: string }> = [
  { action: '赏', label: '赞', hint: '轻赏此条' },
  { action: '藏', label: '藏', hint: '归入内库' },
  { action: '表', label: '评', hint: '拟奏短评' },
  { action: '阅', label: '阅', hint: '本条已阅' }
]

export function FloatingMenuApp() {
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)

  async function runAction(action: AssistantAction) {
    if (runningAction) {
      return
    }

    setRunningAction(action)

    try {
      await window.bilimiDesktop?.runFloatingMenuAction?.(action)
    } finally {
      setRunningAction(null)
    }
  }

  return (
    <main className="floating-menu-shell" aria-label="Bilimi 悬浮菜单">
      <div className="floating-menu" role="menu" aria-label="Bilimi 悬浮动作">
        {FLOATING_MENU_ACTIONS.map((item) => (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            aria-label={item.label}
            className="floating-menu__action"
            disabled={runningAction !== null}
            onClick={() => void runAction(item.action)}
          >
            <strong>{item.label}</strong>
            <span>{item.hint}</span>
          </button>
        ))}
        <button
          type="button"
          className="floating-menu__close"
          aria-label="收起悬浮菜单"
          onClick={() => window.bilimiDesktop?.closeFloatingMenu?.()}
        >
          收
        </button>
      </div>
    </main>
  )
}
```

Modify `src/renderer/src/main.tsx`:

```tsx
import { FloatingMenuApp } from './features/assistant/FloatingMenuApp'
```

Then replace the render branch with:

```tsx
const isFloatingSealWindow = route.get('window') === 'floating-seal'
const isFloatingMenuWindow = route.get('window') === 'floating-menu'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFloatingMenuWindow ? (
      <FloatingMenuApp />
    ) : isFloatingSealWindow ? (
      <FloatingSealApp />
    ) : (
      <App />
    )}
  </React.StrictMode>
)
```

Append this CSS to `src/renderer/src/styles.css`:

```css
body:has(.floating-menu-shell) {
  background: transparent;
}

.floating-menu-shell {
  width: 100vw;
  height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: transparent;
}

.floating-menu {
  width: 144px;
  display: grid;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(113, 81, 48, 0.32);
  background: rgba(247, 234, 205, 0.94);
  box-shadow: 0 18px 34px rgba(24, 9, 5, 0.34);
}

.floating-menu__action,
.floating-menu__close {
  border: 1px solid rgba(116, 55, 32, 0.28);
  background: rgba(255, 248, 235, 0.94);
  color: #58351f;
  cursor: pointer;
  font: 13px "Noto Serif SC", "Songti SC", "SimSun", serif;
}

.floating-menu__action {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 6px 8px;
  text-align: left;
}

.floating-menu__action strong {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: #743720;
  color: #f7ead4;
  font-size: 14px;
}

.floating-menu__action span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.floating-menu__action:disabled {
  opacity: 0.56;
  cursor: wait;
}

.floating-menu__close {
  height: 28px;
  padding: 0 8px;
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingMenuApp.test.tsx
```

Expected:

```text
PASS src/renderer/src/features/assistant/FloatingMenuApp.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add electron/preload/index.ts src/renderer/src/global.d.ts src/renderer/src/main.tsx src/renderer/src/styles.css src/renderer/src/features/assistant/FloatingMenuApp.tsx src/renderer/src/features/assistant/FloatingMenuApp.test.tsx
git commit -m "feat: add system floating menu renderer"
```

---

### Task 4: Floating Seal Click Toggles System Menu

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingSealApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingSealApp.test.tsx`

- [ ] **Step 1: Update the failing click test**

Change the first test in `FloatingSealApp.test.tsx` to:

```tsx
it('asks the desktop shell to toggle the system menu when clicked', () => {
  const toggleFloatingMenu = vi.fn()

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      toggleFloatingMenu
    }
  })

  render(<FloatingSealApp />)

  fireEvent.click(screen.getByRole('button', { name: '打开 Bilimi 助手' }))

  expect(toggleFloatingMenu).toHaveBeenCalledOnce()
})
```

In the drag suppression tests, replace every `openAssistant` mock with `toggleFloatingMenu`, and update the negative expectation:

```tsx
expect(toggleFloatingMenu).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingSealApp.test.tsx
```

Expected:

```text
FAIL src/renderer/src/features/assistant/FloatingSealApp.test.tsx
expected "spy" to be called once, but got 0 times
```

- [ ] **Step 3: Implement click toggle**

In `src/renderer/src/features/assistant/FloatingSealApp.tsx`, replace `openAssistant` with:

```tsx
function toggleMenu() {
  setOpening(true)
  const toggleRequest = window.bilimiDesktop?.toggleFloatingMenu?.()

  void Promise.resolve(toggleRequest).finally(() => {
    window.setTimeout(() => setOpening(false), 160)
  })
}
```

Then replace `openAssistant()` in the click handler with:

```tsx
toggleMenu()
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingSealApp.test.tsx
```

Expected:

```text
PASS src/renderer/src/features/assistant/FloatingSealApp.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/assistant/FloatingSealApp.tsx src/renderer/src/features/assistant/FloatingSealApp.test.tsx
git commit -m "feat: toggle system menu from floating seal"
```

---

### Task 5: Electron Floating Menu Window Lifecycle

**Files:**
- Create: `electron/main/floatingMenuController.ts`
- Create: `electron/main/floatingMenuController.test.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write the failing floating menu controller tests**

Create `electron/main/floatingMenuController.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FloatingMenuController } from './floatingMenuController'

function createTestWindow(destroyed = false) {
  return {
    closeCount: 0,
    destroyed,
    close() {
      this.closeCount += 1
      this.destroyed = true
    },
    isDestroyed() {
      return this.destroyed
    }
  }
}

describe('FloatingMenuController', () => {
  it('creates a menu window when toggled from closed state', () => {
    const createdWindow = createTestWindow()
    const controller = new FloatingMenuController(() => createdWindow)

    expect(controller.toggle()).toBe(createdWindow)
    expect(controller.getWindow()).toBe(createdWindow)
  })

  it('closes the existing menu window when toggled from open state', () => {
    const createdWindow = createTestWindow()
    const controller = new FloatingMenuController(() => createdWindow)

    controller.toggle()

    expect(controller.toggle()).toBeNull()
    expect(createdWindow.closeCount).toBe(1)
    expect(controller.getWindow()).toBeNull()
  })

  it('clears a destroyed menu reference without closing it again', () => {
    const destroyedWindow = createTestWindow(true)
    const controller = new FloatingMenuController(() => destroyedWindow)

    controller.toggle()
    controller.close()

    expect(destroyedWindow.closeCount).toBe(0)
    expect(controller.getWindow()).toBeNull()
  })

  it('clears only the matching closed window reference', () => {
    const firstWindow = createTestWindow()
    const secondWindow = createTestWindow()
    const controller = new FloatingMenuController(() => firstWindow)

    controller.toggle()
    controller.clearIfCurrent(secondWindow)

    expect(controller.getWindow()).toBe(firstWindow)

    controller.clearIfCurrent(firstWindow)

    expect(controller.getWindow()).toBeNull()
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- electron/main/floatingMenuController.test.ts
```

Expected:

```text
FAIL electron/main/floatingMenuController.test.ts
Failed to resolve import "./floatingMenuController"
```

- [ ] **Step 3: Implement the menu controller**

Create `electron/main/floatingMenuController.ts`:

```ts
type FloatingWindow = {
  close: () => void
  isDestroyed: () => boolean
}

export class FloatingMenuController<TWindow extends FloatingWindow> {
  private currentWindow: TWindow | null = null

  constructor(private readonly createWindow: () => TWindow) {}

  getWindow() {
    return this.currentWindow
  }

  close() {
    const windowToClose = this.currentWindow
    this.currentWindow = null

    if (!windowToClose || windowToClose.isDestroyed()) {
      return
    }

    windowToClose.close()
  }

  toggle() {
    if (this.currentWindow && !this.currentWindow.isDestroyed()) {
      this.close()
      return null
    }

    this.currentWindow = this.createWindow()
    return this.currentWindow
  }

  clearIfCurrent(windowToClear: TWindow) {
    if (this.currentWindow === windowToClear) {
      this.currentWindow = null
    }
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run test -- electron/main/floatingMenuController.test.ts
```

Expected:

```text
PASS electron/main/floatingMenuController.test.ts
```

- [ ] **Step 5: Implement menu window bounds and controller wiring**

In `electron/main/index.ts`, update imports:

```ts
import type { AssistantAction, VideoNote } from '../../src/shared/types'
import { sendAssistantActionWhenReady } from './assistantActionSignal'
import { FloatingMenuController } from './floatingMenuController'
```

Update the geometry import:

```ts
import {
  createAssistantPanelPosition,
  createFloatingMenuBounds,
  createFloatingSealDragPosition
} from './floatingSealGeometry'
```

Add constants and state near the existing floating seal constants:

```ts
const FLOATING_MENU_SIZE = { width: 156, height: 214 }
const FLOATING_MENU_QUERY = { window: 'floating-menu' }
```

Add this helper below `getFloatingSealBounds`:

```ts
function getFloatingMenuBounds() {
  const sealBounds = floatingSealWindow?.getBounds() ?? getFloatingSealBounds()
  const display = screen.getDisplayMatching(sealBounds)

  return createFloatingMenuBounds({
    sealBounds,
    menuSize: FLOATING_MENU_SIZE,
    workArea: display.workArea
  })
}
```

- [ ] **Step 6: Add create and controller functions**

Add these functions below `createFloatingSealWindow`:

```ts
function createFloatingMenuWindow() {
  const menu = new BrowserWindow({
    ...getFloatingMenuBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: createPreloadScriptPath(__dirname),
      contextIsolation: true,
      sandbox: false
    }
  })

  menu.setAlwaysOnTop(true, 'floating')
  menu.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  menu.removeMenu()
  menu.on('blur', () => floatingMenuController.close())
  menu.on('closed', () => {
    floatingMenuController.clearIfCurrent(menu)
  })

  loadRendererWindow(menu, FLOATING_MENU_QUERY)

  return menu
}

const floatingMenuController = new FloatingMenuController(createFloatingMenuWindow)

function closeFloatingMenuWindow() {
  floatingMenuController.close()
}

function toggleFloatingMenuWindow() {
  floatingMenuController.toggle()
}
```

- [ ] **Step 7: Close menu during seal drag and dispatch menu actions**

Update `startFloatingSealDrag`:

```ts
function startFloatingSealDrag(screenX: number, screenY: number) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  closeFloatingMenuWindow()
  floatingSealDragSession = {
    startBounds: floatingSealWindow.getBounds(),
    startCursor: { x: screenX, y: screenY }
  }
}
```

Add this function near `openAssistantFromFloatingSeal`:

```ts
function runAssistantActionFromFloatingMenu(action: AssistantAction) {
  closeFloatingMenuWindow()

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
  sendAssistantActionWhenReady(mainWindow, { action })
}
```

- [ ] **Step 8: Register IPC handlers**

Inside `registerAssistantPreferenceHandlers`, add:

```ts
  ipcMain.handle('floating-menu:toggle', () => {
    toggleFloatingMenuWindow()
  })
  ipcMain.handle('floating-menu:run-action', (_event, action: AssistantAction) => {
    runAssistantActionFromFloatingMenu(action)
  })
  ipcMain.on('floating-menu:close', () => {
    closeFloatingMenuWindow()
  })
```

- [ ] **Step 9: Run main helper tests and build**

Run:

```bash
npm run test -- electron/main/floatingMenuController.test.ts electron/main/floatingSealGeometry.test.ts electron/main/assistantActionSignal.test.ts electron/main/assistantOpenSignal.test.ts
npm run build
```

Expected:

```text
PASS electron/main/floatingMenuController.test.ts
PASS electron/main/floatingSealGeometry.test.ts
PASS electron/main/assistantActionSignal.test.ts
PASS electron/main/assistantOpenSignal.test.ts
electron-vite v3 build completed successfully
```

- [ ] **Step 10: Commit**

```bash
git add electron/main/floatingMenuController.ts electron/main/floatingMenuController.test.ts electron/main/index.ts
git commit -m "feat: manage system floating menu window"
```

---

### Task 6: Main Renderer Receives Menu Action Signals

**Files:**
- Modify: `src/renderer/src/features/assistant/AssistantOverlay.tsx`
- Modify: `src/renderer/src/features/assistant/assistantOverlay.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Add a failing AssistantOverlay external action test**

Append this test to `src/renderer/src/features/assistant/assistantOverlay.test.tsx`:

```tsx
it('runs an externally requested assistant action through the existing action path', async () => {
  const runScript = vi.fn().mockResolvedValue({
    ok: true,
    steps: ['like', 'favorite'],
    missingTargets: [],
    message: '已归档'
  })

  const { rerender } = render(
    <AssistantOverlay
      runActionSignal={0}
      runRequestedAction={undefined}
      runScript={runScript}
    />
  )

  rerender(
    <AssistantOverlay
      runActionSignal={1}
      runRequestedAction="藏"
      runScript={runScript}
    />
  )

  await waitFor(() =>
    expect(runScript).toHaveBeenCalledWith(expect.stringContaining('"action":"藏"'))
  )
})
```

If the test file does not import `waitFor`, update the import:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/assistantOverlay.test.tsx
```

Expected:

```text
FAIL src/renderer/src/features/assistant/assistantOverlay.test.tsx
Property 'runActionSignal' does not exist
```

- [ ] **Step 3: Add external action props to AssistantOverlay**

In `AssistantOverlayProps`, add:

```ts
  runActionSignal?: number
  runRequestedAction?: AssistantAction
```

In the function destructuring, add defaults:

```ts
  runActionSignal = 0,
  runRequestedAction,
```

After `handleAction` is defined and before the early return, add:

```tsx
  useEffect(() => {
    if (runActionSignal <= 0 || !runRequestedAction) {
      return
    }

    setOpen(true)
    setPanelMinimized(false)
    handleAction(runRequestedAction)
  }, [runActionSignal, runRequestedAction])
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/assistantOverlay.test.tsx
```

Expected:

```text
PASS src/renderer/src/features/assistant/assistantOverlay.test.tsx
```

- [ ] **Step 5: Add a failing App bridge test**

Append this test to `src/renderer/src/App.test.tsx`:

```tsx
it('runs a system floating menu action against the active internal tab', async () => {
  let runActionCallback: ((payload: { action: '藏' }) => void) | undefined

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      loadPreferences: vi.fn(),
      savePreferences: vi.fn(async (preferences: AssistantPreferences) => preferences),
      onRunAssistantAction: vi.fn((callback: (payload: { action: '藏' }) => void) => {
        runActionCallback = callback
        return vi.fn()
      })
    }
  })

  render(<App />)

  const webview = document.getElementById('bilimi-webview') as HTMLElement & {
    executeJavaScript?: (script: string) => Promise<unknown>
  }
  const executeJavaScript = vi.fn(async (script: string) =>
    isLedgerStatusScript(script)
      ? emptyLedgerStatus()
      : {
          ok: true,
          steps: ['favorite'],
          missingTargets: [],
          message: 'system menu action'
        }
  )
  Object.assign(webview, { executeJavaScript })

  act(() => {
    runActionCallback?.({ action: '藏' })
  })

  await waitFor(() =>
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('"action":"藏"'))
  )
})
```

- [ ] **Step 6: Run the App test and verify RED**

Run:

```bash
npm run test -- src/renderer/src/App.test.tsx
```

Expected:

```text
FAIL src/renderer/src/App.test.tsx
expected executeJavaScript to have been called
```

- [ ] **Step 7: Wire App to the desktop action listener**

In `src/renderer/src/App.tsx`, import `AssistantAction`:

```ts
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  BrowserTabModel,
  FavoriteLedgerStatus,
  VideoNote,
  VideoNoteExtractionResult
} from '@shared/types'
```

Add state next to the existing assistant open signal state:

```ts
  const [assistantRunActionSignal, setAssistantRunActionSignal] = useState(0)
  const [assistantRequestedAction, setAssistantRequestedAction] = useState<AssistantAction | undefined>()
```

Add this effect near the `onOpenAssistant` effect:

```tsx
  useEffect(() => {
    return window.bilimiDesktop?.onRunAssistantAction?.((payload) => {
      setAssistantRequestedAction(payload.action)
      setAssistantRunActionSignal((current) => current + 1)
    })
  }, [])
```

Pass the props to `AssistantOverlay`:

```tsx
        runActionSignal={assistantRunActionSignal}
        runRequestedAction={assistantRequestedAction}
```

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/assistantOverlay.test.tsx src/renderer/src/App.test.tsx
```

Expected:

```text
PASS src/renderer/src/features/assistant/assistantOverlay.test.tsx
PASS src/renderer/src/App.test.tsx
```

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/features/assistant/AssistantOverlay.tsx src/renderer/src/features/assistant/assistantOverlay.test.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx
git commit -m "feat: run assistant actions from system menu"
```

---

### Task 7: Full Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run the full automated test suite**

Run:

```bash
npm run test
```

Expected:

```text
Test Files  all passed
Tests       all passed
```

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected:

```text
electron-vite v3 build completed successfully
```

- [ ] **Step 3: Start the desktop app for manual verification**

Run:

```bash
npm run dev
```

Manual checks:

- Drag the floating seal and confirm it follows the cursor naturally.
- Click the floating seal and confirm the system menu opens beside it.
- Drag the seal while the menu is open and confirm the stale menu closes.
- Move the seal near each screen edge and confirm the menu stays visible.
- Click `藏` and confirm the main window receives the action and runs against the active webview.

- [ ] **Step 4: Commit any verification-only fixes**

If verification required small fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize system floating menu"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- System-level menu window: Task 5.
- Menu near seal with edge handling: Task 1 and Task 5.
- Floating seal click and drag behavior: Task 4 and Task 5.
- Menu actions bridged to active webview automation: Task 2, Task 3, and Task 6.
- Main renderer route for `window=floating-menu`: Task 3.
- Verification coverage: Task 7.

Placeholder scan:

- Placeholder scan was clean after review.

Type consistency:

- `AssistantAction` is reused from `@shared/types`.
- `assistant:run-action` payload is consistently `{ action: AssistantAction }`.
- Preload names are consistently `toggleFloatingMenu`, `closeFloatingMenu`, `runFloatingMenuAction`, and `onRunAssistantAction`.
