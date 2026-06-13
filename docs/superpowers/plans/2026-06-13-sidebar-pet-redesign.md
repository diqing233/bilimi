# Sidebar Pet Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the floating assistant functions into a right-side in-window sidebar, and turn the floating seal entry into an independent palace-maid desktop pet that restores Bilimi and shows lightweight status.

**Architecture:** Implement the feature in the existing Electron/React worktree at `C:\Users\diqing\bilimi\.worktrees\bilimi-mvp`. Reuse the existing floating assistant workspace logic by making it embeddable inside the main renderer sidebar, while changing the floating seal window into a pet window that only restores/focuses the main window and receives pet-state updates over IPC. Keep browser automation in the existing main renderer runtime bridge.

**Tech Stack:** Electron 35, electron-vite, React 19, TypeScript, Vitest, Testing Library, existing `webview` runtime bridge.

---

## File Structure

### Electron Main

- `electron/main/mainWindowRestore.ts`
  - New helper that creates, restores, shows, and focuses the main window without toggling any floating function panel.
- `electron/main/mainWindowRestore.test.ts`
  - Unit tests for restore behavior.
- `electron/main/index.ts`
  - Register the pet restore IPC handler.
  - Register pet state fan-out to the pet window.
  - Stop using the floating seal click path to toggle the old floating assistant or menu.

### Preload And Types

- `electron/preload/index.ts`
  - Expose `restoreMainWindowFromPet`, `setAssistantPetState`, and `onAssistantPetStateChanged`.
- `src/renderer/src/global.d.ts`
  - Add pet bridge methods to `Window['bilimiDesktop']`.
- `src/renderer/src/features/assistant/petState.ts`
  - Shared renderer-side pet state model and copy.
- `src/renderer/src/features/assistant/petState.test.ts`
  - Tests for pet state labels and fallback behavior.

### Renderer Pet

- `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
  - New floating pet renderer app.
- `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
  - Tests click-to-restore, drag suppression, and state rendering.
- `src/renderer/src/main.tsx`
  - Route `?window=floating-seal` to `PalaceMaidPetApp`.
- `src/renderer/src/styles.css`
  - Replace floating seal visual styles with palace-maid pet styles.

### In-Window Sidebar

- `src/renderer/src/features/assistant/AssistantSidebar.tsx`
  - New sidebar shell with collapsible icon rail and tab selection.
- `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`
  - Tests default open state, collapse behavior, and tab switching.
- `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
  - Add an embedded mode so existing assistant functionality can render inside the main sidebar.
- `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
  - Add embedded-mode coverage and update close behavior assertions.
- `src/renderer/src/App.tsx`
  - Render the right-side `AssistantSidebar` next to the browser stack.
- `src/renderer/src/App.test.tsx`
  - Update the old "browser shell only" assertion and add runtime coverage for the sidebar.
- `src/renderer/src/styles.css`
  - Add two-column app layout, sidebar open/collapsed widths, and embedded assistant workspace styles.

---

### Task 1: Add Pet State Model And Restore Helper

**Files:**
- Create: `src/renderer/src/features/assistant/petState.ts`
- Create: `src/renderer/src/features/assistant/petState.test.ts`
- Create: `electron/main/mainWindowRestore.ts`
- Create: `electron/main/mainWindowRestore.test.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write the failing pet state test**

Create `src/renderer/src/features/assistant/petState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPetStateView, normalizePetState } from './petState'

describe('petState', () => {
  it('maps all palace maid pet states to visible labels', () => {
    expect(createPetStateView('idle')).toEqual({
      state: 'idle',
      label: '待机',
      bubble: '奴婢候着，陛下唤我便是。'
    })
    expect(createPetStateView('hint').label).toBe('提示')
    expect(createPetStateView('working').label).toBe('处理中')
    expect(createPetStateView('error').label).toBe('出错')
  })

  it('falls back to idle for unknown persisted or IPC values', () => {
    expect(normalizePetState('hint')).toBe('hint')
    expect(normalizePetState('broken')).toBe('idle')
    expect(normalizePetState(undefined)).toBe('idle')
  })
})
```

- [ ] **Step 2: Run the pet state test and confirm the missing module failure**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/petState.test.ts
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/petState.test.ts
Error: Failed to resolve import "./petState"
```

- [ ] **Step 3: Add the pet state model**

Create `src/renderer/src/features/assistant/petState.ts`:

```ts
export type AssistantPetState = 'idle' | 'hint' | 'working' | 'error'

export type AssistantPetStateView = {
  state: AssistantPetState
  label: '待机' | '提示' | '处理中' | '出错'
  bubble: string
}

const STATE_VIEWS: Record<AssistantPetState, AssistantPetStateView> = {
  idle: {
    state: 'idle',
    label: '待机',
    bubble: '奴婢候着，陛下唤我便是。'
  },
  hint: {
    state: 'hint',
    label: '提示',
    bubble: '案头有新动静，请陛下回窗一观。'
  },
  working: {
    state: 'working',
    label: '处理中',
    bubble: '奴婢正在传旨，稍候即回。'
  },
  error: {
    state: 'error',
    label: '出错',
    bubble: '此事似有阻滞，请回侧栏细看。'
  }
}

export function normalizePetState(value: unknown): AssistantPetState {
  return value === 'hint' || value === 'working' || value === 'error' ? value : 'idle'
}

export function createPetStateView(state: AssistantPetState): AssistantPetStateView {
  return STATE_VIEWS[state]
}
```

- [ ] **Step 4: Write the failing restore helper test**

Create `electron/main/mainWindowRestore.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { restoreMainWindowFromPet } from './mainWindowRestore'

function createWindowState({
  destroyed = false,
  minimized = false,
  visible = true
}: {
  destroyed?: boolean
  minimized?: boolean
  visible?: boolean
} = {}) {
  return {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    isMinimized: vi.fn(() => minimized),
    isVisible: vi.fn(() => visible),
    restore: vi.fn(),
    show: vi.fn()
  }
}

describe('restoreMainWindowFromPet', () => {
  it('creates and focuses the main window when none exists', () => {
    const createdWindow = createWindowState({ visible: false })
    const createMainWindow = vi.fn(() => createdWindow)

    const nextWindow = restoreMainWindowFromPet({
      createMainWindow,
      mainWindow: null
    })

    expect(nextWindow).toBe(createdWindow)
    expect(createMainWindow).toHaveBeenCalledOnce()
    expect(createdWindow.show).toHaveBeenCalledOnce()
    expect(createdWindow.focus).toHaveBeenCalledOnce()
  })

  it('restores, shows, and focuses an existing minimized window', () => {
    const existingWindow = createWindowState({ minimized: true, visible: false })
    const createMainWindow = vi.fn()

    const nextWindow = restoreMainWindowFromPet({
      createMainWindow,
      mainWindow: existingWindow
    })

    expect(nextWindow).toBe(existingWindow)
    expect(createMainWindow).not.toHaveBeenCalled()
    expect(existingWindow.restore).toHaveBeenCalledOnce()
    expect(existingWindow.show).toHaveBeenCalledOnce()
    expect(existingWindow.focus).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 5: Run the restore helper test and confirm the missing module failure**

Run:

```bash
npm run test -- electron/main/mainWindowRestore.test.ts
```

Expected:

```text
FAIL  electron/main/mainWindowRestore.test.ts
Error: Failed to resolve import "./mainWindowRestore"
```

- [ ] **Step 6: Add the restore helper**

Create `electron/main/mainWindowRestore.ts`:

```ts
type RestorableMainWindow = {
  focus: () => void
  isDestroyed: () => boolean
  isMinimized: () => boolean
  isVisible: () => boolean
  restore: () => void
  show: () => void
}

type RestoreMainWindowFromPetArgs<TWindow extends RestorableMainWindow> = {
  createMainWindow: () => TWindow
  mainWindow: TWindow | null
}

export function restoreMainWindowFromPet<TWindow extends RestorableMainWindow>({
  createMainWindow,
  mainWindow
}: RestoreMainWindowFromPetArgs<TWindow>) {
  const activeWindow = !mainWindow || mainWindow.isDestroyed() ? createMainWindow() : mainWindow

  if (activeWindow.isMinimized()) {
    activeWindow.restore()
  }

  if (!activeWindow.isVisible()) {
    activeWindow.show()
  }

  activeWindow.focus()

  return activeWindow
}
```

- [ ] **Step 7: Extend the renderer bridge types**

Modify `src/renderer/src/global.d.ts` by importing `AssistantPetState` and adding the three bridge methods to `BilimiDesktopApi`:

```ts
import type { AssistantPetState } from './features/assistant/petState'
```

```ts
  onAssistantPetStateChanged?: (callback: (state: AssistantPetState) => void) => () => void
  restoreMainWindowFromPet?: () => Promise<void>
  setAssistantPetState?: (state: AssistantPetState) => void
```

- [ ] **Step 8: Expose the preload pet bridge**

Modify `electron/preload/index.ts` by importing the pet type and adding bridge methods inside `contextBridge.exposeInMainWorld('bilimiDesktop', { ... })`:

```ts
import type { AssistantPetState } from '../../src/renderer/src/features/assistant/petState'
```

```ts
  onAssistantPetStateChanged: (callback: (state: AssistantPetState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AssistantPetState) => callback(state)

    ipcRenderer.on('assistant-pet:state-changed', listener)

    return () => {
      ipcRenderer.removeListener('assistant-pet:state-changed', listener)
    }
  },
  restoreMainWindowFromPet: () =>
    ipcRenderer.invoke('assistant-pet:restore-main-window') as Promise<void>,
  setAssistantPetState: (state: AssistantPetState) =>
    ipcRenderer.send('assistant-pet:set-state', state),
```

- [ ] **Step 9: Register the Electron pet IPC handlers**

Modify `electron/main/index.ts`.

Add the imports:

```ts
import { restoreMainWindowFromPet } from './mainWindowRestore'
import type { AssistantPetState } from '../../src/renderer/src/features/assistant/petState'
```

Add state near the existing `mainWindow` and `floatingSealWindow` declarations:

```ts
let assistantPetState: AssistantPetState = 'idle'
```

Add helpers near the other floating-window helpers:

```ts
function sendAssistantPetState() {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  floatingSealWindow.webContents.send('assistant-pet:state-changed', assistantPetState)
}

function setAssistantPetState(state: AssistantPetState) {
  assistantPetState = state
  sendAssistantPetState()
}

function restoreMainWindowForPet() {
  mainWindow = restoreMainWindowFromPet({
    createMainWindow,
    mainWindow
  })
}
```

Inside `createFloatingSealWindow()`, after `loadRendererWindow(seal, FLOATING_SEAL_QUERY)` add:

```ts
  seal.webContents.once('did-finish-load', sendAssistantPetState)
```

Inside `registerAssistantPreferenceHandlers()`, add:

```ts
  ipcMain.handle('assistant-pet:restore-main-window', () => {
    restoreMainWindowForPet()
  })
  ipcMain.on('assistant-pet:set-state', (_event, state: AssistantPetState) => {
    setAssistantPetState(state)
  })
```

- [ ] **Step 10: Run focused tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/petState.test.ts electron/main/mainWindowRestore.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/assistant/petState.test.ts
PASS  electron/main/mainWindowRestore.test.ts
```

- [ ] **Step 11: Commit the pet state and restore bridge**

Run:

```bash
git add electron/main/index.ts electron/main/mainWindowRestore.ts electron/main/mainWindowRestore.test.ts electron/preload/index.ts src/renderer/src/features/assistant/petState.ts src/renderer/src/features/assistant/petState.test.ts src/renderer/src/global.d.ts
git commit -m "feat: add assistant pet restore bridge"
```

---

### Task 2: Replace Floating Seal With Palace Maid Pet

**Files:**
- Create: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`
- Create: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write the failing palace maid pet tests**

Create `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PalaceMaidPetApp } from './PalaceMaidPetApp'
import type { AssistantPetState } from './petState'

function installDesktopApi(overrides: Partial<Window['bilimiDesktop']> = {}) {
  const api = {
    version: '0.1.0',
    finishFloatingSealDrag: vi.fn(),
    onAssistantPetStateChanged: vi.fn(),
    restoreMainWindowFromPet: vi.fn().mockResolvedValue(undefined),
    startFloatingSealDrag: vi.fn(),
    ...overrides
  } satisfies Partial<Window['bilimiDesktop']>

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: api
  })

  return api
}

describe('PalaceMaidPetApp', () => {
  it('restores the main Bilimi window when clicked', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开 Bilimi' }))

    expect(api.restoreMainWindowFromPet).toHaveBeenCalledOnce()
  })

  it('renders pet state changes from the desktop shell', () => {
    let stateChanged: ((state: AssistantPetState) => void) | undefined
    installDesktopApi({
      onAssistantPetStateChanged: vi.fn((callback) => {
        stateChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)

    expect(screen.getByText('待机')).toBeInTheDocument()

    stateChanged?.('working')

    expect(screen.getByText('处理中')).toBeInTheDocument()
    expect(screen.getByText('奴婢正在传旨，稍候即回。')).toBeInTheDocument()
  })

  it('keeps dragging from restoring the main window', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi' })

    fireEvent.pointerDown(pet, { clientX: 10, clientY: 10, screenX: 110, screenY: 210, pointerId: 1 })
    fireEvent.pointerMove(pet, { clientX: 28, clientY: 22, screenX: 128, screenY: 222, pointerId: 1 })
    fireEvent.pointerUp(pet, { clientX: 28, clientY: 22, screenX: 128, screenY: 222, pointerId: 1 })
    fireEvent.click(pet)

    expect(api.startFloatingSealDrag).toHaveBeenCalledWith(110, 210)
    expect(api.finishFloatingSealDrag).toHaveBeenCalledOnce()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the pet tests and confirm the missing component failure**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
Error: Failed to resolve import "./PalaceMaidPetApp"
```

- [ ] **Step 3: Add the palace maid pet component**

Create `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import {
  createPetStateView,
  normalizePetState,
  type AssistantPetState
} from './petState'

const DRAG_THRESHOLD_PX = 5

type DragState = {
  startClientX: number
  startClientY: number
  moved: boolean
}

export function PalaceMaidPetApp() {
  const dragState = useRef<DragState | null>(null)
  const suppressNextClick = useRef(false)
  const [pressed, setPressed] = useState(false)
  const [petState, setPetState] = useState<AssistantPetState>('idle')
  const stateView = createPetStateView(petState)

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPetStateChanged?.((state) => {
      setPetState(normalizePetState(state))
    })
  }, [])

  function startDrag(clientX: number, clientY: number, screenX: number, screenY: number) {
    setPressed(true)
    dragState.current = {
      startClientX: clientX,
      startClientY: clientY,
      moved: false
    }
    window.bilimiDesktop?.startFloatingSealDrag?.(screenX, screenY)
  }

  function moveDrag(clientX: number, clientY: number) {
    const currentDrag = dragState.current

    if (!currentDrag) {
      return
    }

    const moved =
      currentDrag.moved ||
      Math.hypot(clientX - currentDrag.startClientX, clientY - currentDrag.startClientY) >=
        DRAG_THRESHOLD_PX

    dragState.current = {
      ...currentDrag,
      moved
    }

    if (moved) {
      setPressed(false)
    }
  }

  function finishDrag() {
    const currentDrag = dragState.current

    if (!currentDrag) {
      setPressed(false)
      return false
    }

    dragState.current = null
    setPressed(false)
    window.bilimiDesktop?.finishFloatingSealDrag?.()

    if (currentDrag.moved) {
      suppressNextClick.current = true
      return true
    }

    return false
  }

  function restoreMainWindow() {
    setPetState('hint')
    void window.bilimiDesktop?.restoreMainWindowFromPet?.()
  }

  return (
    <main className="palace-maid-pet-shell" aria-label="Bilimi 小宫女">
      <button
        className="palace-maid-pet"
        type="button"
        aria-label="打开 Bilimi"
        title="打开 Bilimi"
        data-pet-state={stateView.state}
        data-pressed={pressed ? 'true' : 'false'}
        onClick={(event) => {
          const finishedDrag = finishDrag()

          if (finishedDrag || suppressNextClick.current) {
            suppressNextClick.current = false
            event.preventDefault()
            return
          }

          restoreMainWindow()
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          startDrag(event.clientX, event.clientY, event.screenX, event.screenY)
        }}
        onPointerMove={(event) => {
          moveDrag(event.clientX, event.clientY)
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          finishDrag()
        }}
        onPointerCancel={() => {
          dragState.current = null
          setPressed(false)
        }}
      >
        <span className="palace-maid-pet__halo" aria-hidden="true" />
        <span className="palace-maid-pet__figure" aria-hidden="true">
          <span className="palace-maid-pet__hair" />
          <span className="palace-maid-pet__face">
            <span className="palace-maid-pet__eye palace-maid-pet__eye--left" />
            <span className="palace-maid-pet__eye palace-maid-pet__eye--right" />
            <span className="palace-maid-pet__mouth" />
          </span>
          <span className="palace-maid-pet__robe" />
        </span>
        <span className="palace-maid-pet__bubble">
          <strong>{stateView.label}</strong>
          <span>{stateView.bubble}</span>
        </span>
      </button>
    </main>
  )
}
```

- [ ] **Step 4: Route the floating seal window to the pet**

Modify `src/renderer/src/main.tsx`.

Replace:

```ts
import { FloatingSealApp } from './features/assistant/FloatingSealApp'
```

With:

```ts
import { PalaceMaidPetApp } from './features/assistant/PalaceMaidPetApp'
```

Replace the floating seal route render:

```tsx
    ) : isFloatingSealWindow ? (
      <PalaceMaidPetApp />
```

- [ ] **Step 5: Add pet visual styles**

Append these styles to `src/renderer/src/styles.css`:

```css
.palace-maid-pet-shell {
  width: 148px;
  height: 148px;
  display: grid;
  place-items: center;
  overflow: visible;
  background: transparent;
}

.palace-maid-pet {
  position: relative;
  width: 96px;
  height: 112px;
  border: none;
  background: transparent;
  cursor: grab;
  touch-action: none;
  filter: drop-shadow(0 14px 18px rgba(24, 9, 5, 0.35));
}

.palace-maid-pet[data-pressed="true"] {
  cursor: grabbing;
}

.palace-maid-pet__halo {
  position: absolute;
  inset: 18px 10px 4px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(255, 231, 184, 0.46), transparent 68%);
  opacity: 0.9;
}

.palace-maid-pet__figure {
  position: absolute;
  left: 18px;
  top: 8px;
  width: 60px;
  height: 88px;
}

.palace-maid-pet__hair {
  position: absolute;
  left: 8px;
  top: 0;
  width: 44px;
  height: 38px;
  border-radius: 20px 20px 14px 14px;
  background: #2b1a14;
}

.palace-maid-pet__hair::before,
.palace-maid-pet__hair::after {
  content: "";
  position: absolute;
  top: 8px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #2b1a14;
}

.palace-maid-pet__hair::before {
  left: -8px;
}

.palace-maid-pet__hair::after {
  right: -8px;
}

.palace-maid-pet__face {
  position: absolute;
  left: 11px;
  top: 19px;
  width: 38px;
  height: 34px;
  border: 2px solid rgba(93, 45, 25, 0.18);
  border-radius: 16px 16px 18px 18px;
  background: #ffe6ca;
}

.palace-maid-pet__eye {
  position: absolute;
  top: 14px;
  width: 5px;
  height: 6px;
  border-radius: 999px;
  background: #352017;
}

.palace-maid-pet__eye--left {
  left: 10px;
}

.palace-maid-pet__eye--right {
  right: 10px;
}

.palace-maid-pet__mouth {
  position: absolute;
  left: 16px;
  bottom: 7px;
  width: 8px;
  height: 4px;
  border-bottom: 2px solid #8a4d42;
  border-radius: 0 0 999px 999px;
}

.palace-maid-pet__robe {
  position: absolute;
  left: 7px;
  top: 49px;
  width: 46px;
  height: 38px;
  border: 2px solid rgba(90, 52, 31, 0.22);
  border-radius: 16px 16px 20px 20px;
  background:
    linear-gradient(90deg, transparent 45%, rgba(120, 55, 32, 0.28) 46%, rgba(120, 55, 32, 0.28) 54%, transparent 55%),
    linear-gradient(180deg, #f7dca8, #9d4e35);
}

.palace-maid-pet__bubble {
  position: absolute;
  left: 66px;
  bottom: 24px;
  width: 164px;
  display: none;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid rgba(113, 81, 48, 0.26);
  border-radius: 8px;
  background: rgba(251, 244, 232, 0.96);
  color: #5b3d23;
  text-align: left;
  box-shadow: 0 12px 26px rgba(24, 9, 5, 0.22);
}

.palace-maid-pet:hover .palace-maid-pet__bubble,
.palace-maid-pet:focus-visible .palace-maid-pet__bubble,
.palace-maid-pet[data-pet-state="hint"] .palace-maid-pet__bubble,
.palace-maid-pet[data-pet-state="working"] .palace-maid-pet__bubble,
.palace-maid-pet[data-pet-state="error"] .palace-maid-pet__bubble {
  display: grid;
}

.palace-maid-pet__bubble strong {
  font-size: 12px;
}

.palace-maid-pet__bubble span {
  font-size: 12px;
  line-height: 1.35;
}

.palace-maid-pet[data-pet-state="working"] .palace-maid-pet__halo {
  animation: palace-maid-pulse 900ms ease-in-out infinite;
}

.palace-maid-pet[data-pet-state="error"] .palace-maid-pet__robe {
  background:
    linear-gradient(90deg, transparent 45%, rgba(120, 55, 32, 0.28) 46%, rgba(120, 55, 32, 0.28) 54%, transparent 55%),
    linear-gradient(180deg, #f2d3a3, #8f352f);
}

@keyframes palace-maid-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.72;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}
```

- [ ] **Step 6: Run the palace maid pet tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
```

- [ ] **Step 7: Commit the pet renderer**

Run:

```bash
git add src/renderer/src/features/assistant/PalaceMaidPetApp.tsx src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx src/renderer/src/main.tsx src/renderer/src/styles.css
git commit -m "feat: replace floating seal with palace maid pet"
```

---

### Task 3: Make The Assistant Workspace Embeddable

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Add an embedded-mode test for the assistant workspace**

Append this test to `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`:

```tsx
  it('renders as an embedded sidebar workspace and collapses instead of closing a floating window', async () => {
    const closeFloatingAssistant = vi.fn()
    const onRequestCollapse = vi.fn()
    installDesktopApi({ closeFloatingAssistant })

    render(<FloatingAssistantApp mode="sidebar" onRequestCollapse={onRequestCollapse} />)

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '礼记' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '掌库' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }))

    expect(onRequestCollapse).toHaveBeenCalledOnce()
    expect(closeFloatingAssistant).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the embedded-mode test and confirm the prop/type failure**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
TypeError or TypeScript error showing FloatingAssistantApp does not accept mode/onRequestCollapse yet
```

- [ ] **Step 3: Add props and controlled tab helpers to `FloatingAssistantApp`**

Modify the top of `src/renderer/src/features/assistant/FloatingAssistantApp.tsx` after the constants:

```ts
type AssistantWorkspaceTab = 'review' | 'notes' | 'ledger'

type FloatingAssistantAppProps = {
  mode?: 'floating' | 'sidebar'
  activeTab?: AssistantWorkspaceTab
  onActiveTabChange?: (tab: AssistantWorkspaceTab) => void
  onRequestCollapse?: () => void
}
```

Change the component signature:

```tsx
export function FloatingAssistantApp({
  mode = 'floating',
  activeTab: controlledActiveTab,
  onActiveTabChange,
  onRequestCollapse
}: FloatingAssistantAppProps = {}) {
```

Replace the existing active tab state:

```ts
  const [uncontrolledActiveTab, setUncontrolledActiveTab] = useState<AssistantWorkspaceTab>('review')
```

Add these derived values below the state declarations:

```ts
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab
  const isSidebarMode = mode === 'sidebar'

  function setActiveTab(tab: AssistantWorkspaceTab) {
    if (!controlledActiveTab) {
      setUncontrolledActiveTab(tab)
    }

    onActiveTabChange?.(tab)
  }
```

Replace the `closeAssistant` function:

```ts
  function closeAssistant() {
    if (isSidebarMode) {
      onRequestCollapse?.()
      return
    }

    window.bilimiDesktop?.closeFloatingAssistant?.()
  }
```

Replace the outer return wrapper with mode-aware classes and labels:

```tsx
  const workspace = (
    <section
      className={isSidebarMode ? 'assistant-sidebar-workspace' : 'floating-assistant-workspace'}
    >
      {/* keep the existing tablist, tab panels, prompts, and dialogs here */}
    </section>
  )

  if (isSidebarMode) {
    return (
      <div className="assistant-sidebar-embed" aria-label="Bilimi 应用侧栏">
        {workspace}
      </div>
    )
  }

  return (
    <main className="floating-assistant-shell" aria-label="Bilimi 悬浮助手">
      {workspace}
    </main>
  )
```

Inside the tablist, update labels to the requested sidebar labels:

```tsx
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'review'}
            onClick={() => setActiveTab('review')}
          >
            批阅
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'notes'}
            onClick={() => setActiveTab('notes')}
          >
            礼记
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ledger'}
            onClick={() => setActiveTab('ledger')}
          >
            掌库
          </button>
```

Change the `MemorialPanel` close button label when embedded by passing a new prop:

```tsx
            closeLabel={isSidebarMode ? '收起侧栏' : '合折'}
```

- [ ] **Step 4: Add `closeLabel` support to `MemorialPanel`**

Modify `src/renderer/src/features/assistant/MemorialPanel.tsx`.

Add prop type:

```ts
  closeLabel?: string
```

Add the default value in the function parameters:

```ts
  closeLabel = '合折'
```

Replace the close button text:

```tsx
        <button className="memorial-panel__close" type="button" onClick={onClose}>
          {closeLabel}
        </button>
```

- [ ] **Step 5: Add embedded workspace CSS**

Append to `src/renderer/src/styles.css`:

```css
.assistant-sidebar-embed {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.assistant-sidebar-workspace {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  padding: 12px;
  background: linear-gradient(180deg, #f4ead4 0%, #eadbc0 100%);
  color: #3f2a1a;
  overflow: hidden;
}

.assistant-sidebar-workspace .floating-assistant-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.assistant-sidebar-workspace > .memorial-panel,
.assistant-sidebar-workspace > .favorite-ledger-panel {
  min-height: 0;
}

.assistant-sidebar-workspace .memorial-panel,
.assistant-sidebar-workspace .favorite-ledger-panel {
  width: 100%;
  max-height: none;
  box-shadow: none;
}

.assistant-sidebar-workspace .memorial-panel__paper {
  height: 100%;
  max-height: none;
  box-sizing: border-box;
  overflow: auto;
  box-shadow: none;
}

.assistant-sidebar-workspace .favorite-ledger-panel {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
}
```

- [ ] **Step 6: Run the assistant workspace tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

- [ ] **Step 7: Commit embedded assistant workspace support**

Run:

```bash
git add src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/features/assistant/MemorialPanel.tsx src/renderer/src/styles.css
git commit -m "feat: make assistant workspace embeddable"
```

---

### Task 4: Add The Main Window Sidebar

**Files:**
- Create: `src/renderer/src/features/assistant/AssistantSidebar.tsx`
- Create: `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write the failing sidebar component tests**

Create `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantSidebar } from './AssistantSidebar'

function installDesktopApi() {
  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      loadPreferences: vi.fn(),
      onAssistantSnapshotChanged: vi.fn(),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(undefined),
      savePreferences: vi.fn()
    }
  })
}

describe('AssistantSidebar', () => {
  it('opens by default with the 批阅 tab selected', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
    expect(await screen.findByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('collapses to the icon rail and expands from a tab icon', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    expect(screen.queryByRole('tab', { name: '批阅' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开掌库' }))

    expect(await screen.findByRole('tab', { name: '掌库' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})
```

- [ ] **Step 2: Run the sidebar tests and confirm the missing module failure**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/AssistantSidebar.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/AssistantSidebar.test.tsx
Error: Failed to resolve import "./AssistantSidebar"
```

- [ ] **Step 3: Add the sidebar component**

Create `src/renderer/src/features/assistant/AssistantSidebar.tsx`:

```tsx
import { useState } from 'react'
import { FloatingAssistantApp } from './FloatingAssistantApp'

type AssistantSidebarTab = 'review' | 'notes' | 'ledger'

const RAIL_TABS: Array<{
  id: AssistantSidebarTab
  label: string
  icon: string
  openLabel: string
}> = [
  { id: 'review', label: '批阅', icon: '批', openLabel: '打开批阅' },
  { id: 'notes', label: '礼记', icon: '记', openLabel: '打开礼记' },
  { id: 'ledger', label: '掌库', icon: '库', openLabel: '打开掌库' }
]

export function AssistantSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<AssistantSidebarTab>('review')

  function openTab(tab: AssistantSidebarTab) {
    setActiveTab(tab)
    setCollapsed(false)
  }

  return (
    <aside
      className="assistant-sidebar"
      aria-label="Bilimi 侧边栏"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <nav className="assistant-sidebar__rail" aria-label="侧边栏图标栏">
        <button
          type="button"
          className="assistant-sidebar__rail-button"
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? '展' : '收'}
        </button>
        {RAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="assistant-sidebar__rail-button"
            aria-label={tab.openLabel}
            aria-pressed={activeTab === tab.id && !collapsed}
            onClick={() => openTab(tab.id)}
          >
            <strong>{tab.icon}</strong>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
      {collapsed ? null : (
        <FloatingAssistantApp
          mode="sidebar"
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onRequestCollapse={() => setCollapsed(true)}
        />
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Render the sidebar inside `App`**

Modify `src/renderer/src/App.tsx`.

Add the import:

```ts
import { AssistantSidebar } from './features/assistant/AssistantSidebar'
```

Replace the final JSX return with:

```tsx
  return (
    <div className="app-shell" data-tabs-visible="true">
      <div className="app-main">
        <div className="browser-tabs" role="tablist" aria-label="网页标签">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="browser-tabs__item"
              data-selected={tab.id === activeTabId ? 'true' : 'false'}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeTabId}
                className="browser-tabs__tab"
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.title}
              </button>
              {tab.id !== HOME_TAB_ID ? (
                <button
                  type="button"
                  className="browser-tabs__close"
                  aria-label={`关闭 ${tab.title}`}
                  title={`关闭 ${tab.title}`}
                  onClick={() => closeInternalTab(tab.id)}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="browser-stack">
          {tabs.map((tab) => (
            <BiliWebview
              key={tab.id}
              active={tab.id === activeTabId}
              tabId={tab.id}
              url={tab.url}
              onLocationChange={updateTabUrl}
              onOpenInTab={openInternalTab}
              onReady={handleWebviewReady}
              onTitleChange={updateTabTitle}
            />
          ))}
        </div>
      </div>
      <AssistantSidebar />
    </div>
  )
```

- [ ] **Step 5: Update the App test that expected no assistant UI**

Modify `src/renderer/src/App.test.tsx`.

Replace the test named `renders only the browser shell in the main renderer window` with:

```tsx
  it('renders the browser shell with the in-window assistant sidebar', async () => {
    renderAppWithRuntimeBridge()

    expect(document.querySelector('.seal-button')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '礼记' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '掌库' })).toBeInTheDocument()
    expect(window.bilimiDesktop.registerAssistantRuntime).toHaveBeenCalled()
  })
```

- [ ] **Step 6: Add two-column layout and rail CSS**

Modify `src/renderer/src/styles.css`.

Replace `.app-shell` and `.app-shell[data-tabs-visible="false"]` with:

```css
.app-shell {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  background: #050505;
  overflow: hidden;
}

.app-main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 42px minmax(0, 1fr);
}

.app-shell[data-tabs-visible="false"] .app-main {
  grid-template-rows: minmax(0, 1fr);
}
```

Append sidebar styles:

```css
.assistant-sidebar {
  width: 430px;
  min-width: 430px;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  border-left: 1px solid rgba(64, 38, 23, 0.32);
  background: #eadbc0;
}

.assistant-sidebar[data-collapsed="true"] {
  width: 54px;
  min-width: 54px;
  grid-template-columns: 54px;
}

.assistant-sidebar__rail {
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 8px 6px;
  border-right: 1px solid rgba(113, 81, 48, 0.2);
  background: linear-gradient(180deg, #251914, #3b2218);
}

.assistant-sidebar__rail-button {
  width: 42px;
  min-height: 42px;
  display: grid;
  place-items: center;
  gap: 2px;
  border: 1px solid rgba(255, 238, 204, 0.18);
  border-radius: 7px;
  background: rgba(255, 248, 235, 0.08);
  color: #f8ead4;
  cursor: pointer;
  font: 12px "Noto Serif SC", "Songti SC", "SimSun", serif;
}

.assistant-sidebar__rail-button:hover,
.assistant-sidebar__rail-button:focus-visible,
.assistant-sidebar__rail-button[aria-pressed="true"] {
  border-color: rgba(255, 229, 171, 0.42);
  background: rgba(255, 244, 219, 0.18);
}

.assistant-sidebar__rail-button strong {
  font-size: 14px;
  line-height: 1;
}

.assistant-sidebar__rail-button span {
  font-size: 10px;
  line-height: 1;
}
```

- [ ] **Step 7: Run focused sidebar and App tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/AssistantSidebar.test.tsx src/renderer/src/App.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/AssistantSidebar.test.tsx
PASS  src/renderer/src/App.test.tsx
```

- [ ] **Step 8: Commit the in-window sidebar**

Run:

```bash
git add src/renderer/src/features/assistant/AssistantSidebar.tsx src/renderer/src/features/assistant/AssistantSidebar.test.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/styles.css
git commit -m "feat: move assistant workspace into sidebar"
```

---

### Task 5: Wire Sidebar Actions To Pet Status

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] **Step 1: Add a test for pet status updates during sidebar actions**

Append this test to `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`:

```tsx
  it('reports working and hint pet states around successful sidebar actions', async () => {
    const setAssistantPetState = vi.fn()
    const runAssistantAction = vi.fn().mockResolvedValue(createResult('动作已完成。'))
    installDesktopApi({
      runAssistantAction,
      setAssistantPetState
    })

    render(<FloatingAssistantApp mode="sidebar" />)

    fireEvent.click(await screen.findByRole('button', { name: /藏.*归入内库/ }))

    await waitFor(() => expect(runAssistantAction).toHaveBeenCalled())
    expect(setAssistantPetState).toHaveBeenNthCalledWith(1, 'working')
    expect(setAssistantPetState).toHaveBeenLastCalledWith('hint')
  })
```

- [ ] **Step 2: Run the status test and confirm it fails**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected:

```text
FAIL  src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
Expected setAssistantPetState to have been called
```

- [ ] **Step 3: Update `runAction` to notify pet status**

Modify `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`.

Inside `runAction`, immediately after `setRunningAction(action)`, add:

```ts
    window.bilimiDesktop?.setAssistantPetState?.('working')
```

Inside the successful result block, after `setFeedback({ ... })`, add:

```ts
      window.bilimiDesktop?.setAssistantPetState?.(result.ok ? 'hint' : 'error')
```

Inside the `catch` block, after `setFeedback({ ... })`, add:

```ts
      window.bilimiDesktop?.setAssistantPetState?.('error')
```

- [ ] **Step 4: Run the workspace tests again**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected:

```text
PASS  src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

- [ ] **Step 5: Commit pet status wiring**

Run:

```bash
git add src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
git commit -m "feat: report assistant action status to pet"
```

---

### Task 6: Disable Old Floating Function Panel Entry Points

**Files:**
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/floatingMenuToggleFlow.test.ts`

- [ ] **Step 1: Add a regression assertion that pet click does not toggle floating panels**

Append this assertion to the first `PalaceMaidPetApp` test:

```tsx
    expect(window.bilimiDesktop.toggleFloatingAssistant).toBeUndefined()
    expect(window.bilimiDesktop.toggleFloatingMenu).toBeUndefined()
```

- [ ] **Step 2: Replace old toggle tests with restore-only tests**

Modify `electron/main/floatingMenuToggleFlow.test.ts`.

Keep the old tests for `toggleFloatingMenuFromSeal` and `toggleFloatingAssistantFromSeal` only if their helpers still remain imported by other code. Add a new test that documents the chosen restore-only behavior:

```ts
import { restoreMainWindowFromPet } from './mainWindowRestore'
```

```ts
describe('pet restore flow', () => {
  it('focuses the main window without toggling a floating panel', () => {
    const existingWindow = createWindowState({ minimized: true, visible: false })
    const createMainWindow = vi.fn()
    const toggleFloatingAssistant = vi.fn()
    const toggleFloatingMenu = vi.fn()

    const nextWindow = restoreMainWindowFromPet({
      createMainWindow,
      mainWindow: existingWindow
    })

    expect(nextWindow).toBe(existingWindow)
    expect(existingWindow.restore).toHaveBeenCalledOnce()
    expect(existingWindow.show).toHaveBeenCalledOnce()
    expect(existingWindow.focus).toHaveBeenCalledOnce()
    expect(toggleFloatingAssistant).not.toHaveBeenCalled()
    expect(toggleFloatingMenu).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Stop calling floating panel toggles from pet-visible paths**

Modify `electron/main/index.ts`.

Leave `createFloatingAssistantWindow`, `createFloatingMenuWindow`, and their controller code in place if existing tests still cover them, but do not call them from pet click. Confirm the pet restore handler from Task 1 is the only handler used by `PalaceMaidPetApp`.

If `ipcMain.handle('assistant:open-from-floating-seal')`, `ipcMain.handle('floating-menu:toggle')`, or `ipcMain.handle('floating-assistant:toggle')` are no longer used by any renderer path, change their handlers to restore the main window and avoid opening panels:

```ts
  ipcMain.handle('assistant:open-from-floating-seal', () => {
    restoreMainWindowForPet()
  })
  ipcMain.handle('floating-menu:toggle', () => {
    restoreMainWindowForPet()
  })
  ipcMain.handle('floating-assistant:toggle', () => {
    restoreMainWindowForPet()
  })
```

- [ ] **Step 4: Run focused regression tests**

Run:

```bash
npm run test -- src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx electron/main/floatingMenuToggleFlow.test.ts
```

Expected:

```text
PASS  src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
PASS  electron/main/floatingMenuToggleFlow.test.ts
```

- [ ] **Step 5: Commit old panel entry-point removal**

Run:

```bash
git add electron/main/index.ts electron/main/floatingMenuToggleFlow.test.ts src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx
git commit -m "fix: prevent pet from opening floating panels"
```

---

### Task 7: Final Verification

**Files:**
- Verify all files modified by Tasks 1-6.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm run test
```

Expected:

```text
Test Files: all pass
Tests: all pass
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

- [ ] **Step 3: Check formatting-sensitive diff issues**

Run:

```bash
git diff --check
```

Expected:

```text
exit code 0
```

- [ ] **Step 4: Manually verify the desktop behavior on Windows**

Run:

```bash
npm run dev
```

Verify:

1. The main Bilimi window opens with Bilibili content on the left and the Bilimi sidebar on the right.
2. The Bilibili content area narrows for the sidebar and is not covered by it.
3. The sidebar starts open on `批阅`.
4. The sidebar collapses to the icon rail and reopens from `批阅`, `礼记`, and `掌库`.
5. No separate floating function panel appears when clicking the pet.
6. The floating window shows a Q-style palace maid pet.
7. Minimizing the main window leaves the pet visible.
8. Clicking the pet restores and focuses the main window.
9. Running a sidebar action changes the pet to `处理中`, then `提示` on success or `出错` on failure.

- [ ] **Step 5: Inspect final git status**

Run:

```bash
git status --short
```

Expected:

```text
empty output, except intentionally ignored local log/temp files
```

---

## Self-Review Notes

### Spec Coverage

1. Main window shows Bilibili plus right-side sidebar by default: Task 4.
2. Browser content resizes instead of being covered: Task 4 CSS grid.
3. Sidebar collapses to icon rail and expands from tab icons: Task 4.
4. `批阅`, `礼记`, and `掌库` remain available: Task 3 and Task 4.
5. Old floating function panel no longer appears from the floating entry: Task 2 and Task 6.
6. Floating entry becomes independent palace-maid pet: Task 2.
7. Pet click restores or opens the main window: Task 1 and Task 2.
8. Pet supports `待机`, `提示`, `处理中`, and `出错`: Task 1 and Task 5.
9. Primary actions remain in the sidebar: Task 3, Task 4, and Task 6.

### Placeholder Scan

The plan specifies concrete files, commands, expected outputs, and code snippets for each change. It avoids unresolved implementation markers.

### Type Consistency

Pet status uses `AssistantPetState = 'idle' | 'hint' | 'working' | 'error'` in `petState.ts`, `global.d.ts`, preload, and Electron IPC. Sidebar tabs use `review | notes | ledger`, matching the existing assistant workspace tab model.
