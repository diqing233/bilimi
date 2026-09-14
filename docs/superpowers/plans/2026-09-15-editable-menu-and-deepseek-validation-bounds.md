# Editable Menus and DeepSeek Validation Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore native right-click editing for app and embedded Bilibili inputs, and ensure a DeepSeek connection test always returns within approximately 42 seconds without changing normal DeepSeek generation policies.

**Architecture:** A small, Electron-independent context-menu helper will build only the standard editable roles from Chromium's `editFlags`; `index.ts` will attach it to the app WebContents and every WebView guest. A separate connection-test adapter will apply a 20-second per-attempt bound and one 2-second transient retry while the shared request executor races non-cooperative fetch implementations against the same configured timeout. The renderer receives retry progress through IPC and continues to own its task cleanup through `finally`.

**Tech Stack:** Electron main/preload/renderer, TypeScript, Vitest.

---

### Task 1: Restore editable-only context menus

**Files:**
- Create: `electron/main/editableContextMenu.ts`
- Create: `electron/main/editableContextMenu.test.ts`
- Modify: `electron/main/index.ts:329-347`

- [x] **Step 1: Write failing helper tests**

```ts
it('opens only native editing roles for an editable target', () => {
  const host = createWebContentsHost()
  const popup = vi.fn()
  installEditableContextMenu(host, { buildMenu: vi.fn(() => ({ popup })) })

  host.emit({ isEditable: true, x: 12, y: 24, editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true } })

  expect(buildMenu).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ role: 'paste', enabled: true }),
    expect.objectContaining({ role: 'selectAll', enabled: true })
  ]))
  expect(popup).toHaveBeenCalledOnce()
})

it('does not create a menu for a non-editable page target', () => {
  // The Bilibili page, links, and video surface must retain their normal behavior.
})
```

- [x] **Step 2: Run the new test and confirm it fails because the helper does not exist**

Run: `npm test -- electron/main/editableContextMenu.test.ts`

Expected: FAIL with module-not-found or missing export.

- [x] **Step 3: Implement the testable helper and attach it at both ownership points**

```ts
// editableContextMenu.ts
if (!params.isEditable || webContents.isDestroyed()) return
const menu = buildMenu(createEditableContextMenuTemplate(params.editFlags))
menu.popup({ x: params.x, y: params.y })

// index.ts
installEditableContextMenu(win.webContents, { buildMenu: (template) => Menu.buildFromTemplate(template) })
webContents.on('did-attach-webview', (_event, guest) => {
  installEditableContextMenu(guest, { buildMenu: (template) => Menu.buildFromTemplate(template) })
})
```

The template must contain only `undo`, `redo`, `cut`, `copy`, `paste`, and `selectAll`, with enabled state taken from `editFlags`. It must not read or write the clipboard.

- [x] **Step 4: Run focused tests**

Run: `npm test -- electron/main/editableContextMenu.test.ts electron/main/index.deepSeekIpcWiring.test.ts`

Expected: PASS.

### Task 2: Give a connection test its own bounded retry policy

**Files:**
- Create: `electron/main/deepseekConnectionTest.ts`
- Create: `electron/main/deepseekConnectionTest.test.ts`
- Modify: `electron/main/deepseekRetry.ts`
- Modify: `electron/main/deepseekRetry.test.ts`
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/main/deepseekService.test.ts`
- Modify: `electron/main/index.ts:1288-1320`

- [x] **Step 1: Write failing policy and timeout tests**

```ts
it('uses two 20-second attempts with one 2-second transient retry for a connection test', async () => {
  await runDeepSeekConnectionTest(config, { generate })
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({
    requestTimeoutMs: 20_000,
    retryDelaysMs: [2_000]
  }))
})

it('settles at the timeout even when fetch ignores AbortSignal', async () => {
  const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined))
  await expect(generateDeepSeekResult({ ...request, fetchImpl, requestTimeoutMs: 10 }))
    .rejects.toMatchObject({ code: 'network-error' })
})
```

- [x] **Step 2: Run the focused tests and confirm they fail under the current two-retry/abort-only implementation**

Run: `npm test -- electron/main/deepseekConnectionTest.test.ts electron/main/deepseekService.test.ts electron/main/deepseekRetry.test.ts`

Expected: FAIL because there is no connection-test adapter, no one-retry option, and an AbortSignal-ignoring fetch never settles.

- [x] **Step 3: Implement policy overrides without changing existing defaults**

```ts
export const DEEPSEEK_CONNECTION_TEST_REQUEST_TIMEOUT_MS = 20_000
export const DEEPSEEK_CONNECTION_TEST_RETRY_DELAYS_MS = [2_000] as const

await generateDeepSeekResult({
  config,
  request: { kind: 'pet-chat', messages: [{ role: 'user', content: 'Reply with OK.' }] },
  requestTimeoutMs: DEEPSEEK_CONNECTION_TEST_REQUEST_TIMEOUT_MS,
  retryDelaysMs: DEEPSEEK_CONNECTION_TEST_RETRY_DELAYS_MS,
  onRetry
})
```

`retryTransientDeepSeekRequest` keeps its existing `[2_000, 6_000]` default for all callers that do not supply an override. `generateDeepSeekResult` must turn a timeout into `DeepSeekServiceError('network-error', ...)` through an explicit timeout race, rather than relying solely on a provider honoring `AbortSignal`.

- [x] **Step 4: Route the settings IPC through the adapter**

```ts
return runDeepSeekConnectionTest(config, {
  onRetry: (progress) => sendDeepSeekConnectionTestProgress(progress)
})
```

The handler returns the existing `{ ok, message, requestedModel, responseModel }` contract. It neither persists settings nor handles keys; the renderer retains the established save-before-test flow.

- [x] **Step 5: Run focused tests**

Run: `npm test -- electron/main/deepseekConnectionTest.test.ts electron/main/deepseekService.test.ts electron/main/deepseekRetry.test.ts`

Expected: PASS, including the non-cooperative fetch case and unchanged default retry behavior.

### Task 3: Surface retry status and preserve task cleanup

**Files:**
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx:4344-4381`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

- [x] **Step 1: Write failing renderer/preload contract tests**

```ts
it('reports the single allowed connection-test retry without disabling normal task cleanup', async () => {
  publishConnectionTestProgress({ attempt: 2, totalAttempts: 2, delayMs: 2_000 })
  expect(globalFeedback()).toContain('正在重试（2/2）')
  resolveConnectionTest({ ok: false, message: 'DeepSeek request timed out after 20 seconds.' })
  await expect(saveAndTest()).resolves.toBeUndefined()
  expect(saveAndTestButton()).toHaveTextContent('保存并测试')
})
```

- [x] **Step 2: Run the focused renderer test and confirm it fails because progress is not delivered**

Run: `npm test -- src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

Expected: FAIL on the missing progress subscription or retry text.

- [x] **Step 3: Add a narrow progress IPC subscription**

```ts
// preload/global type
onDeepSeekConnectionTestProgress(callback): () => void

// renderer listener
setGlobalFeedback(`DeepSeek 服务暂时繁忙，正在重试（${progress.attempt}/${progress.totalAttempts}）。`)
```

The listener only reports an already-started retry. It must not store credentials, alter settings, create tasks, or change completion ownership; the existing `finally { finishDeepSeekTask() }` remains the only task-cleanup path.

- [x] **Step 4: Run affected and full verification**

Run: `npm test -- electron/main/editableContextMenu.test.ts electron/main/deepseekConnectionTest.test.ts electron/main/deepseekService.test.ts electron/main/deepseekRetry.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

Run: `npm test`

Run: `npm run build`

Expected: all tests and production build pass.

- [ ] **Step 5: Perform Electron UI acceptance**

In the development app, right-click each of the DeepSeek key/model/address fields and the Bilibili search input: confirm the editable menu appears and Paste is available when the system clipboard allows it. Right-click non-editable Bilibili content: confirm the custom editing menu does not appear. Use an intentionally unavailable test endpoint: confirm the visible verification state settles within the configured bound, the button returns to `保存并测试`, and no Bilibili action occurs.

### Task 4: Record requirement-by-requirement evidence and commit one topic-scoped change

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-15-deepseek-401-authorization-diagnosis.md`
- Modify: `docs/superpowers/plans/2026-09-15-editable-menu-and-deepseek-validation-bounds.md`

- [x] **Step 1: Update I004, I005, and I006 separately**

Record exact code locations, focused/full test commands, actual results, UI acceptance evidence, and any unavailable desktop automation condition. Do not mark an item as UI-verified without an observed Electron interaction.

- [x] **Step 2: Check final scope and commit**

Run: `git diff --check`

Run: `git status --short`

Run: `git diff --stat`

Expected: only the files listed in this plan and the existing topic ledger are changed. Create one local `main` commit after the requested verification passes; do not package or push.
