# Floating Assistant Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small floating menu with a system-level assistant workspace that opens beside the floating seal and contains `批阅 / 札记 / 掌库` plus all confirmations and feedback.

**Architecture:** Keep the main Electron window as the Bilibili webview host and automation executor. Add a `floating-assistant` renderer entry that owns the assistant UI and talks to the main renderer through main-process IPC request/response routing. Extract reusable assistant surface logic so the system window can run the full workflow without showing a main-window assistant panel.

**Tech Stack:** Electron 35, React 19, TypeScript, Vitest, Testing Library, electron-vite.

---

## File Structure

- Modify `electron/main/floatingSealGeometry.ts`: add `createFloatingAssistantBounds` for a larger workspace beside the seal.
- Modify `electron/main/floatingSealGeometry.test.ts`: red/green geometry tests for side placement and workArea clamp.
- Modify `electron/main/index.ts`: replace floating menu window with floating assistant window, add IPC runtime request forwarding, keep old menu aliases only as compatibility wrappers during transition.
- Modify `electron/preload/index.ts`: expose floating assistant APIs and main-renderer runtime registration.
- Modify `src/renderer/src/global.d.ts`: type the new desktop APIs and runtime payloads.
- Create `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`: shared renderer-side request/response types for the floating assistant bridge.
- Create `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`: system-window app for the complete assistant workspace.
- Create `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`: UI and bridge tests for tabs, actions, confirmations, snapshot loading, and close.
- Modify `src/renderer/src/features/assistant/FloatingSealApp.tsx`: call `toggleFloatingAssistant` while retaining a fallback to `toggleFloatingMenu`.
- Modify `src/renderer/src/features/assistant/FloatingSealApp.test.tsx`: update click expectations and drag suppression tests.
- Modify `src/renderer/src/main.tsx`: route `window=floating-assistant` to `FloatingAssistantApp`.
- Modify `src/renderer/src/App.tsx`: remove visible assistant overlay from the main window and register the automation runtime handler.
- Modify `src/renderer/src/App.test.tsx`: assert the main app does not render the assistant panel and handles runtime requests.
- Modify `src/renderer/src/styles.css`: replace small menu styles with a polished compact workspace style.

## Task 1: Floating Assistant Geometry

**Files:**
- Modify: `electron/main/floatingSealGeometry.ts`
- Modify: `electron/main/floatingSealGeometry.test.ts`

- [ ] **Step 1: Write failing geometry tests**

Add tests:

```ts
it('places the assistant workspace to the left of a right-side seal', () => {
  expect(createFloatingAssistantBounds({
    sealBounds: { x: 1700, y: 500, width: 92, height: 92 },
    workspaceSize: { width: 360, height: 560 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    gap: 12
  })).toEqual({ x: 1328, y: 266, width: 360, height: 560 })
})

it('flips the assistant workspace to the right when the seal is near the left edge', () => {
  expect(createFloatingAssistantBounds({
    sealBounds: { x: 16, y: 500, width: 92, height: 92 },
    workspaceSize: { width: 360, height: 560 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    gap: 12
  })).toEqual({ x: 120, y: 266, width: 360, height: 560 })
})

it('keeps the assistant workspace inside a small work area', () => {
  expect(createFloatingAssistantBounds({
    sealBounds: { x: 300, y: 330, width: 72, height: 72 },
    workspaceSize: { width: 360, height: 560 },
    workArea: { x: 0, y: 0, width: 420, height: 480 },
    gap: 12
  })).toEqual({ x: 48, y: 12, width: 360, height: 456 })
})
```

- [ ] **Step 2: Run red test**

Run: `npm run test -- electron/main/floatingSealGeometry.test.ts`

Expected: FAIL because `createFloatingAssistantBounds` is not exported.

- [ ] **Step 3: Implement minimal geometry**

Add `createFloatingAssistantBounds({ sealBounds, workspaceSize, workArea, gap = 12 })`. Clamp workspace dimensions to `workArea - gap * 2`, prefer left, flip right, then fall back to centered x. Center vertically against the seal and clamp y.

- [ ] **Step 4: Run green test**

Run: `npm run test -- electron/main/floatingSealGeometry.test.ts`

Expected: PASS for all geometry tests.

## Task 2: Floating Seal Opens Assistant Workspace

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingSealApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingSealApp.test.tsx`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: Write failing seal tests**

Change click tests to expect `toggleFloatingAssistant()`:

```ts
const toggleFloatingAssistant = vi.fn()
Object.defineProperty(window, 'bilimiDesktop', {
  configurable: true,
  value: { version: '0.1.0', toggleFloatingAssistant }
})
render(<FloatingSealApp />)
fireEvent.click(screen.getByRole('button', { name: '打开 Bilimi 助手' }))
expect(toggleFloatingAssistant).toHaveBeenCalledOnce()
```

Keep drag tests and assert `toggleFloatingAssistant` is not called after a drag.

- [ ] **Step 2: Run red test**

Run: `npm run test -- src/renderer/src/features/assistant/FloatingSealApp.test.tsx`

Expected: FAIL because the component still calls `toggleFloatingMenu`.

- [ ] **Step 3: Implement minimal bridge rename**

Expose `toggleFloatingAssistant` and `closeFloatingAssistant` in `global.d.ts` and preload. In `FloatingSealApp`, call `toggleFloatingAssistant?.()` first and fall back to `toggleFloatingMenu?.()` for compatibility.

- [ ] **Step 4: Run green test**

Run: `npm run test -- src/renderer/src/features/assistant/FloatingSealApp.test.tsx`

Expected: PASS.

## Task 3: Floating Assistant UI

**Files:**
- Create: `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`
- Create: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Create: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write failing render and interaction tests**

Create tests that define `window.bilimiDesktop` with `requestAssistantSnapshot`, `runAssistantAction`, `generateVideoNote`, `saveVideoNote`, `ensureFavoriteLedgers`, `scanOldFavorites`, `executeOldFavoritePlan`, `savePreferences`, and `closeFloatingAssistant`.

Test cases:

```ts
it('renders the complete floating assistant tabs from a snapshot', async () => {
  render(<FloatingAssistantApp />)
  expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '札记' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '掌库' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '赏' })).toBeInTheDocument()
})

it('asks for coin count inside the floating assistant before running 赐', async () => {
  render(<FloatingAssistantApp />)
  fireEvent.click(await screen.findByRole('button', { name: '赐' }))
  expect(screen.getByText('陛下意欲赐几枚铜钱？')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '赐两枚' }))
  await waitFor(() => expect(runAssistantAction).toHaveBeenCalledWith('赐', expect.objectContaining({ coinCount: 2, pageClickOnly: true })))
})

it('closes the system assistant from 合折', async () => {
  render(<FloatingAssistantApp />)
  fireEvent.click(await screen.findByRole('button', { name: '合折' }))
  expect(closeFloatingAssistant).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run red test**

Run: `npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

Expected: FAIL because `FloatingAssistantApp` does not exist.

- [ ] **Step 3: Implement assistant runtime types**

Define:

```ts
export type AssistantSnapshot = {
  preferences: AssistantPreferences
  favoriteLedgerStatus: FavoriteLedgerStatus | null
  videoContentContext: VideoContentContext
  videoTitle: string
}

export type FloatingAssistantActionOptions = {
  coinCount?: 1 | 2
  commentDraft?: string
  pageClickOnly?: boolean
}
```

- [ ] **Step 4: Implement `FloatingAssistantApp`**

Use existing `MemorialPanel`, `CoinPrompt`, `CommentChooser`, and `FavoriteLedgerPanel`. Load snapshot on mount, compute recommendation locally, keep all confirmation state in the floating app, call desktop APIs for actions, notes, and ledger work, and close through `closeFloatingAssistant`.

- [ ] **Step 5: Route the new app**

In `main.tsx`, render `FloatingAssistantApp` when `window=floating-assistant`. Keep `window=floating-menu` routed to `FloatingMenuApp` until the old floating-menu tests are deleted or rewritten in the same feature branch.

- [ ] **Step 6: Add workspace styles**

Add `.floating-assistant-shell`, `.floating-assistant-workspace`, and responsive panel overrides so the workspace uses a stable `360 x 560` surface with internal scrolling and no nested page cards.

- [ ] **Step 7: Run green test**

Run: `npm run test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

Expected: PASS.

## Task 4: Main Process Floating Assistant Window

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/main/floatingMenuController.ts` only if naming reuse becomes confusing
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] **Step 1: Use existing geometry and build checks for main-process coverage**

Do not add BrowserWindow constructor mocks in this task. Main-process window behavior is covered by `createFloatingAssistantBounds` tests from Task 1 plus the production build in Task 4 Step 5. Keep direct BrowserWindow behavior in `index.ts` narrow and observable through named functions/constants.

- [ ] **Step 2: Implement floating assistant window**

Rename constants:

```ts
const FLOATING_ASSISTANT_SIZE = { width: 360, height: 560 }
const FLOATING_ASSISTANT_QUERY = { window: 'floating-assistant' }
```

Use `createFloatingAssistantBounds` in `getFloatingAssistantBounds()`. Keep transparent, frame-less, always-on-top BrowserWindow behavior.

- [ ] **Step 3: Implement runtime request forwarding**

Add a request/response helper in `index.ts`:

```ts
function requestMainAssistantRuntime<T>(request: AssistantRuntimeRequest): Promise<T>
```

It creates an id, sends `assistant-runtime:request` to `mainWindow.webContents`, waits for `assistant-runtime:response`, rejects on timeout or error, and ensures the main window exists before sending.

- [ ] **Step 4: Register IPC handlers**

Add handlers:

- `floating-assistant:toggle`
- `floating-assistant:close`
- `floating-assistant:snapshot`
- `floating-assistant:run-action`
- `floating-assistant:generate-video-note`
- `floating-assistant:ensure-ledgers`
- `floating-assistant:scan-old-favorites`
- `floating-assistant:execute-old-favorite-plan`

Keep old `floating-menu:*` handlers as wrappers so existing tests do not fail before they are updated.

- [ ] **Step 5: Run targeted build check**

Run: `npm run build`

Expected: TypeScript/Electron build succeeds after renderer runtime is implemented in Task 5.

## Task 5: Main Window Runtime Handler

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] **Step 1: Write failing App tests**

Add tests that assert:

```ts
expect(screen.queryByLabelText('案头奏折')).not.toBeInTheDocument()
```

and that `registerAssistantRuntime` receives a handler capable of returning a snapshot and running an action through `runScript`.

- [ ] **Step 2: Run red test**

Run: `npm run test -- src/renderer/src/App.test.tsx`

Expected: FAIL because App still renders `AssistantOverlay` and no runtime registration exists.

- [ ] **Step 3: Implement preload runtime registration**

Expose:

```ts
registerAssistantRuntime(handler: (request: AssistantRuntimeRequest) => Promise<AssistantRuntimeResponsePayload>): () => void
```

The preload listener receives `assistant-runtime:request`, awaits the handler, and sends `assistant-runtime:response` with `{ id, ok: true, payload }` or `{ id, ok: false, error }`.

- [ ] **Step 4: Implement App runtime handler**

In `App`, remove visible `AssistantOverlay`. Register one runtime handler that supports:

- `snapshot`
- `run-action`
- `generate-video-note`
- `ensure-ledgers`
- `scan-old-favorites`
- `execute-old-favorite-plan`

Reuse existing local functions: `readVideoContentContext`, `readVideoNoteSource`, `runScript`, `runVisualFallback`, `ensureFavoriteLedgers`, `scanOldFavorites`, and `executeOldFavoritePlan`.

- [ ] **Step 5: Run green test**

Run: `npm run test -- src/renderer/src/App.test.tsx`

Expected: PASS.

## Task 6: Full Verification and Cleanup

**Files:**
- Review all touched files.
- Avoid staging unrelated pre-existing worktree changes unless they are required by this feature.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm run test -- electron/main/floatingSealGeometry.test.ts src/renderer/src/features/assistant/FloatingSealApp.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/App.test.tsx
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run full test suite**

Run: `npm run test`

Expected: all tests pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: build completes with exit code 0.

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`, open the desktop app, drag the seal, click it, verify the complete assistant workspace opens beside the seal and no main-window assistant panel appears.

- [ ] **Step 5: Final report**

Report changed behavior, verification output, any remaining risks, and whether pre-existing dirty files remain.
