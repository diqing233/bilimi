# Staging Ledger Pending Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `inbox` default ledger to `Bilimi路鏆傚瓨` and add a persistent local pending-classification queue that old-favorite organization and new favorite fallback can use without forcing repeated scans.

**Architecture:** Keep `inbox` as the stable default ledger id and split remote favorite storage from local queue state. Add a focused shared queue model, persist it through the Electron store, expose it through the existing preload/runtime bridge, and let the ledger panel render queue status separately from old-favorite preview groups.

**Tech Stack:** Electron, React, TypeScript, electron-store, Vitest, Testing Library.

---

## File Structure

- Modify `src/shared/types.ts`
  - Add `PendingFavoriteQueueItem`, queue source/status types, queue snapshot/update types.
  - Keep the queue out of `AssistantPreferences`; expose it through dedicated store-backed bridge methods.
- Modify `src/shared/favoriteLedgers.ts`
  - Change new default `inbox` display name to `Bilimi路鏆傚瓨`.
  - Add compatibility helpers for legacy `Bilimi路寰呭垎绫籤 names while preserving stable id `inbox`.
- Modify `src/shared/favoriteLedgers.test.ts`
  - Update default-name expectations and add legacy compatibility coverage.
- Create `src/shared/pendingFavoriteQueue.ts`
  - Normalize, upsert, archive, dismiss, and summarize pending queue items.
- Create `src/shared/pendingFavoriteQueue.test.ts`
  - Unit tests for upsert, merge by `aid`, pending-only load, archived/dismissed status, and summary counts.
- Modify `electron/main/store.ts`
  - Persist `pendingFavoriteQueue`.
  - Add `loadPendingFavoriteQueue`, `savePendingFavoriteQueue`, `upsertPendingFavoriteQueueItems`, and `updatePendingFavoriteQueueItemStatus`.
- Modify `electron/main/store.test.ts`
  - Store-level tests for queue persistence, normalization, and status updates.
- Modify `electron/preload/index.ts`
  - Expose `loadPendingFavoriteQueue`, `upsertPendingFavoriteQueueItems`, and `updatePendingFavoriteQueueItemStatus`.
- Modify `src/renderer/src/global.d.ts`
  - Add the queue bridge methods to `BilimiDesktopApi`.
- Modify `electron/main/index.ts`
  - Add IPC handlers for local queue load/save/update.
- Modify `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
  - Mark unresolved old-favorite preview items as queue candidates instead of default-selected `inbox` archive operations.
- Modify `src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`
  - Cover unresolved old favorites becoming queue candidates and not selected `inbox` append targets.
- Modify `src/renderer/src/App.tsx`
  - After old-favorite scan, persist unresolved items to queue.
  - After new favorite fallback succeeds into `inbox`, persist the current video to queue.
  - Do not create queue items when real `inbox` favorite write fails.
- Modify `src/renderer/src/App.test.tsx`
  - Integration tests for old-favorite queue persistence and new favorite fallback queue behavior.
- Modify `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
  - Load and pass queue items into `FavoriteLedgerPanel`.
- Modify `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
  - Add props for queue items and queue item status updates.
  - Render a fixed pending queue summary above ledger chips.
  - Exclude unresolved `inbox` old-favorite targets from confirm execution.
- Modify `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
  - Component tests for queue summary, no rescan requirement, and archived item hiding.
- Modify `src/renderer/src/styles.css` and `src/renderer/src/styles.test.ts`
  - Add compact, non-card nested styling for the queue band and list.
- Modify `README.md`
  - Document `Bilimi路鏆傚瓨` and the local pending queue.

Per `AGENTS.md`, implementation should be committed once after the whole requirement is complete and verified.

---

### Task 1: Rename `inbox` Ledger and Preserve Legacy Compatibility

**Files:**
- Modify: `src/shared/favoriteLedgers.ts`
- Modify: `src/shared/favoriteLedgers.test.ts`

- [ ] **Step 1: Write failing tests for the new default name**

In `src/shared/favoriteLedgers.test.ts`, update the default-ledger test to expect the `inbox` ledger display name to be `Bilimi路鏆傚瓨`, and add a compatibility test:

```ts
it('uses Bilimi staging as the inbox display name', () => {
  const inboxLedger = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')

  expect(inboxLedger).toEqual(
    expect.objectContaining({
      id: 'inbox',
      displayName: 'Bilimi路鏆傚瓨',
      enabled: true,
      isDefault: true
    })
  )
})

it('keeps a saved legacy pending-classification inbox ledger as inbox', () => {
  const ledgers = normalizeFavoriteLedgers([
    {
      id: 'inbox',
      displayName: 'Bilimi路寰呭垎绫?,
      keywords: ['绋嶅悗', '寰呯湅'],
      enabled: true,
      priority: 80,
      isDefault: true
    }
  ])

  expect(ledgers.filter((ledger) => ledger.id === 'inbox')).toHaveLength(1)
  expect(ledgers.find((ledger) => ledger.id === 'inbox')?.displayName).toBe('Bilimi路寰呭垎绫?)
})
```

- [ ] **Step 2: Run the targeted test and verify failure**

Run:

```bash
npm test -- src/shared/favoriteLedgers.test.ts
```

Expected: FAIL because `createDefaultFavoriteLedgers()` still returns `Bilimi路寰呭垎绫籤 for `inbox`.

- [ ] **Step 3: Implement the default-name change**

In `src/shared/favoriteLedgers.ts`, change only the `inbox` tuple display name and keep id/keywords stable:

```ts
['inbox', '鏆傚瓨', ['绋嶅悗', '寰呯湅', '鏆傚瓨', '鏀惰棌', '寰呭垎绫?]]
```

Add a legacy-name set near retired defaults:

```ts
const LEGACY_INBOX_FAVORITE_LEDGER_NAMES = new Set([
  `${BILIMI_LEDGER_PREFIX}寰呭垎绫籤
])
```

Do not normalize legacy saved `inbox` display names automatically. The compatibility rule is recognition, not silent remote rename.

- [ ] **Step 4: Run the targeted test and verify pass**

Run:

```bash
npm test -- src/shared/favoriteLedgers.test.ts
```

Expected: PASS.

---

### Task 2: Add Shared Pending Queue Model

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/pendingFavoriteQueue.ts`
- Create: `src/shared/pendingFavoriteQueue.test.ts`

- [ ] **Step 1: Add queue types**

In `src/shared/types.ts`, add:

```ts
export type PendingFavoriteQueueSource = 'old-favorite-scan' | 'new-favorite'

export type PendingFavoriteQueueStatus = 'pending' | 'archived' | 'dismissed'

export type PendingFavoriteQueueItem = {
  aid: number
  title: string
  source: PendingFavoriteQueueSource
  sourceFolderTitle?: string
  originalTargetLedgerId?: FavoriteLedgerId
  suggestedLedgerIds: FavoriteLedgerId[]
  candidateLedgerNames: string[]
  reason: string
  createdAt: string
  updatedAt: string
  status: PendingFavoriteQueueStatus
}

export type PendingFavoriteQueueSummary = {
  totalPending: number
  suggestedExistingCount: number
  suggestedCandidateLedgerCount: number
  stagingCount: number
}
```

- [ ] **Step 2: Write failing model tests**

Create `src/shared/pendingFavoriteQueue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  archivePendingFavoriteQueueItem,
  createPendingFavoriteQueueSummary,
  normalizePendingFavoriteQueue,
  upsertPendingFavoriteQueueItems
} from './pendingFavoriteQueue'
import type { PendingFavoriteQueueItem } from './types'

function item(overrides: Partial<PendingFavoriteQueueItem> = {}): PendingFavoriteQueueItem {
  return {
    aid: 101,
    title: '鏈垎绫昏棰?,
    source: 'old-favorite-scan',
    sourceFolderTitle: '榛樿鏀惰棌澶?,
    originalTargetLedgerId: 'inbox',
    suggestedLedgerIds: [],
    candidateLedgerNames: [],
    reason: '娌℃湁鏄庣‘鍛戒腑',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    status: 'pending',
    ...overrides
  }
}

describe('pending favorite queue', () => {
  it('loads only valid pending queue items by default', () => {
    expect(
      normalizePendingFavoriteQueue([
        item({ aid: 1, status: 'pending' }),
        item({ aid: 2, status: 'archived' }),
        { title: 'broken' }
      ])
    ).toEqual([item({ aid: 1, status: 'pending' })])
  })

  it('upserts by aid and preserves original createdAt', () => {
    const result = upsertPendingFavoriteQueueItems(
      [item({ aid: 1, title: 'old', createdAt: '2026-06-28T00:00:00.000Z' })],
      [item({ aid: 1, title: 'new', suggestedLedgerIds: ['knowledge'] })],
      '2026-06-28T01:00:00.000Z'
    )

    expect(result).toEqual([
      item({
        aid: 1,
        title: 'new',
        suggestedLedgerIds: ['knowledge'],
        createdAt: '2026-06-28T00:00:00.000Z',
        updatedAt: '2026-06-28T01:00:00.000Z'
      })
    ])
  })

  it('summarizes pending queue work', () => {
    expect(
      createPendingFavoriteQueueSummary([
        item({ aid: 1, suggestedLedgerIds: ['knowledge'] }),
        item({ aid: 2, candidateLedgerNames: ['Bilimi路鎽勫奖'] }),
        item({ aid: 3 })
      ])
    ).toEqual({
      totalPending: 3,
      suggestedExistingCount: 1,
      suggestedCandidateLedgerCount: 1,
      stagingCount: 1
    })
  })

  it('archives an item and hides it from default normalization', () => {
    const archived = archivePendingFavoriteQueueItem([item({ aid: 1 })], 1, '2026-06-28T02:00:00.000Z')

    expect(archived[0]).toMatchObject({ aid: 1, status: 'archived' })
    expect(normalizePendingFavoriteQueue(archived)).toEqual([])
  })
})
```

- [ ] **Step 3: Run model tests and verify failure**

Run:

```bash
npm test -- src/shared/pendingFavoriteQueue.test.ts
```

Expected: FAIL because `pendingFavoriteQueue.ts` does not exist.

- [ ] **Step 4: Implement queue helpers**

Create `src/shared/pendingFavoriteQueue.ts`:

```ts
import type {
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  PendingFavoriteQueueSummary
} from './types'

function isStatus(value: unknown): value is PendingFavoriteQueueStatus {
  return value === 'pending' || value === 'archived' || value === 'dismissed'
}

function normalizeItem(value: unknown): PendingFavoriteQueueItem | null {
  const item = value as Partial<PendingFavoriteQueueItem>
  if (!item || typeof item.aid !== 'number' || !Number.isFinite(item.aid) || !item.title) {
    return null
  }

  return {
    aid: item.aid,
    title: String(item.title),
    source: item.source === 'new-favorite' ? 'new-favorite' : 'old-favorite-scan',
    sourceFolderTitle: item.sourceFolderTitle,
    originalTargetLedgerId: item.originalTargetLedgerId,
    suggestedLedgerIds: Array.isArray(item.suggestedLedgerIds) ? item.suggestedLedgerIds : [],
    candidateLedgerNames: Array.isArray(item.candidateLedgerNames) ? item.candidateLedgerNames : [],
    reason: item.reason || '绛夊緟鍒嗙被',
    createdAt: item.createdAt || new Date(0).toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date(0).toISOString(),
    status: isStatus(item.status) ? item.status : 'pending'
  }
}

export function normalizePendingFavoriteQueue(items: unknown[]): PendingFavoriteQueueItem[] {
  return items
    .map(normalizeItem)
    .filter((item): item is PendingFavoriteQueueItem => Boolean(item))
    .filter((item) => item.status === 'pending')
}

export function upsertPendingFavoriteQueueItems(
  current: PendingFavoriteQueueItem[],
  incoming: PendingFavoriteQueueItem[],
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  const byAid = new Map(current.map((item) => [item.aid, item]))

  for (const item of incoming) {
    const existing = byAid.get(item.aid)
    byAid.set(item.aid, {
      ...item,
      createdAt: existing?.createdAt ?? item.createdAt ?? now,
      updatedAt: now,
      status: 'pending'
    })
  }

  return [...byAid.values()]
}

export function updatePendingFavoriteQueueItemStatus(
  current: PendingFavoriteQueueItem[],
  aid: number,
  status: PendingFavoriteQueueStatus,
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  return current.map((item) =>
    item.aid === aid
      ? {
          ...item,
          status,
          updatedAt: now
        }
      : item
  )
}

export function archivePendingFavoriteQueueItem(
  current: PendingFavoriteQueueItem[],
  aid: number,
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  return updatePendingFavoriteQueueItemStatus(current, aid, 'archived', now)
}

export function createPendingFavoriteQueueSummary(
  items: PendingFavoriteQueueItem[]
): PendingFavoriteQueueSummary {
  const pendingItems = items.filter((item) => item.status === 'pending')

  return {
    totalPending: pendingItems.length,
    suggestedExistingCount: pendingItems.filter((item) => item.suggestedLedgerIds.length > 0).length,
    suggestedCandidateLedgerCount: pendingItems.filter((item) => item.candidateLedgerNames.length > 0).length,
    stagingCount: pendingItems.filter(
      (item) => item.suggestedLedgerIds.length === 0 && item.candidateLedgerNames.length === 0
    ).length
  }
}
```

- [ ] **Step 5: Run model tests and verify pass**

Run:

```bash
npm test -- src/shared/pendingFavoriteQueue.test.ts
```

Expected: PASS.

---

### Task 3: Persist Queue in Electron Store and Preload Bridge

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

- [ ] **Step 1: Write failing store tests**

In `electron/main/store.test.ts`, extend imports:

```ts
import {
  loadPendingFavoriteQueue,
  savePendingFavoriteQueue,
  upsertPendingFavoriteQueueItems,
  updatePendingFavoriteQueueItemStatus
} from './store'
```

Add a helper item and tests:

```ts
const pendingQueueItem = {
  aid: 202,
  title: '寰呭垎绫绘棫钘?,
  source: 'old-favorite-scan' as const,
  sourceFolderTitle: '榛樿鏀惰棌澶?,
  originalTargetLedgerId: 'inbox',
  suggestedLedgerIds: [],
  candidateLedgerNames: ['Bilimi路鎽勫奖'],
  reason: '楂橀鏍囩寤鸿鏂板缓',
  createdAt: '2026-06-28T00:00:00.000Z',
  updatedAt: '2026-06-28T00:00:00.000Z',
  status: 'pending' as const
}

describe('pending favorite queue store helpers', () => {
  it('loads an empty pending queue by default', () => {
    const store = createFakeStore()

    expect(loadPendingFavoriteQueue(store)).toEqual([])
  })

  it('saves, upserts, and updates pending queue items', () => {
    const store = createFakeStore()

    expect(savePendingFavoriteQueue(store, [pendingQueueItem])).toEqual([pendingQueueItem])
    expect(
      upsertPendingFavoriteQueueItems(
        store,
        [{ ...pendingQueueItem, title: '鏇存柊鏍囬', suggestedLedgerIds: ['knowledge'] }],
        '2026-06-28T01:00:00.000Z'
      )
    ).toEqual([
      {
        ...pendingQueueItem,
        title: '鏇存柊鏍囬',
        suggestedLedgerIds: ['knowledge'],
        updatedAt: '2026-06-28T01:00:00.000Z'
      }
    ])
    expect(updatePendingFavoriteQueueItemStatus(store, 202, 'archived', '2026-06-28T02:00:00.000Z')).toEqual([])
  })
})
```

Update `createFakeStore()` snapshot to include `pendingFavoriteQueue: initial.pendingFavoriteQueue ?? []` after the implementation type fails.

- [ ] **Step 2: Run store tests and verify failure**

Run:

```bash
npm test -- electron/main/store.test.ts
```

Expected: FAIL because store queue functions and state field do not exist.

- [ ] **Step 3: Implement store state and helpers**

In `electron/main/store.ts`, import queue helpers and types:

```ts
import {
  normalizePendingFavoriteQueue,
  upsertPendingFavoriteQueueItems as mergePendingFavoriteQueueItems,
  updatePendingFavoriteQueueItemStatus as setPendingFavoriteQueueItemStatus
} from '../../src/shared/pendingFavoriteQueue'
import type { PendingFavoriteQueueItem, PendingFavoriteQueueStatus } from '../../src/shared/types'
```

Add to `DesktopStoreState`:

```ts
pendingFavoriteQueue: PendingFavoriteQueueItem[]
```

Add to `DEFAULT_DESKTOP_STORE_STATE`:

```ts
pendingFavoriteQueue: []
```

Add helpers:

```ts
export function loadPendingFavoriteQueue(
  store: AssistantStoreLike = getDesktopStore()
): PendingFavoriteQueueItem[] {
  return normalizePendingFavoriteQueue(store.get('pendingFavoriteQueue') ?? [])
}

export function savePendingFavoriteQueue(
  store: AssistantStoreLike = getDesktopStore(),
  items: PendingFavoriteQueueItem[]
): PendingFavoriteQueueItem[] {
  store.set('pendingFavoriteQueue', items)
  return loadPendingFavoriteQueue(store)
}

export function upsertPendingFavoriteQueueItems(
  store: AssistantStoreLike = getDesktopStore(),
  items: PendingFavoriteQueueItem[],
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  const nextItems = mergePendingFavoriteQueueItems(loadPendingFavoriteQueue(store), items, now)
  store.set('pendingFavoriteQueue', nextItems)
  return loadPendingFavoriteQueue(store)
}

export function updatePendingFavoriteQueueItemStatus(
  store: AssistantStoreLike = getDesktopStore(),
  aid: number,
  status: PendingFavoriteQueueStatus,
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  const nextItems = setPendingFavoriteQueueItemStatus(loadPendingFavoriteQueue(store), aid, status, now)
  store.set('pendingFavoriteQueue', nextItems)
  return loadPendingFavoriteQueue(store)
}
```

- [ ] **Step 4: Add IPC/preload API**

In `electron/main/index.ts`, import the queue helpers and add handlers inside `registerAssistantPreferenceHandlers()`:

```ts
ipcMain.handle('pending-favorite-queue:load', () => loadPendingFavoriteQueue(getDesktopStore()))
ipcMain.handle('pending-favorite-queue:upsert', (_event, items: PendingFavoriteQueueItem[]) =>
  upsertPendingFavoriteQueueItems(getDesktopStore(), items)
)
ipcMain.handle(
  'pending-favorite-queue:update-status',
  (_event, aid: number, status: PendingFavoriteQueueStatus) =>
    updatePendingFavoriteQueueItemStatus(getDesktopStore(), aid, status)
)
```

In `electron/preload/index.ts`, expose:

```ts
loadPendingFavoriteQueue: () =>
  ipcRenderer.invoke('pending-favorite-queue:load') as Promise<PendingFavoriteQueueItem[]>,
upsertPendingFavoriteQueueItems: (items: PendingFavoriteQueueItem[]) =>
  ipcRenderer.invoke('pending-favorite-queue:upsert', items) as Promise<PendingFavoriteQueueItem[]>,
updatePendingFavoriteQueueItemStatus: (aid: number, status: PendingFavoriteQueueStatus) =>
  ipcRenderer.invoke('pending-favorite-queue:update-status', aid, status) as Promise<PendingFavoriteQueueItem[]>,
```

In `src/renderer/src/global.d.ts`, add matching methods to `BilimiDesktopApi`.

- [ ] **Step 5: Run store tests and typecheck**

Run:

```bash
npm test -- electron/main/store.test.ts
npm run typecheck
```

Expected: both PASS.

---

### Task 4: Persist Old-Favorite Unresolved Items to Queue

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing preview tests**

In `src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`, add a case where a scanned video only resolves to `inbox`:

```ts
it('keeps old favorite inbox fallback unselected for local pending queue handling', () => {
  const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
    ledger.id === 'inbox' ? { ...ledger, bilibiliFolderId: 'inbox-folder' } : ledger
  )

  const preview = createFavoriteLedgerPreview({
    ledgers,
    sourceFolders: [
      {
        id: 'source-1',
        title: '榛樿鏀惰棌澶?,
        videos: [{ aid: 1, title: '寰堥毦鍒ゆ柇鐨勮棰?, tags: [] }]
      }
    ],
    targetMembership: {},
    multiArchiveMode: 'off'
  })

  expect(preview.items[0].targetLedgerId).toBe('inbox')
  expect(preview.items[0].selected).toBe(false)
  expect(preview.items[0].targets?.find((target) => target.ledgerId === 'inbox')?.selected).toBe(false)
})
```

- [ ] **Step 2: Run preview tests and verify failure**

Run:

```bash
npm test -- src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts
```

Expected: FAIL because current fallback selects `inbox` when it has a folder id.

- [ ] **Step 3: Make `inbox` unselected for old-favorite preview**

In `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`, change selection logic so `inbox` targets are never selected by default during old-favorite scans:

```ts
const selected =
  Boolean(targetFolderId) &&
  targetLedger?.id !== 'inbox' &&
  !alreadyInTarget &&
  !classification.reviewRequired
```

In `previewTargetsForVideo()`, when pushing the final `inbox` fallback target:

```ts
selected: false
```

- [ ] **Step 4: Add App old-favorite queue persistence test**

In `src/renderer/src/App.test.tsx`, add a bridge mock for `upsertPendingFavoriteQueueItems` and assert it receives unresolved old-favorite items after `scan-old-favorites`:

```ts
it('persists unresolved old favorite items to the pending queue without appending them to staging', async () => {
  const upsertPendingFavoriteQueueItems = vi.fn().mockResolvedValue([])
  const { requestRuntime } = renderAppWithRuntimeBridge({ upsertPendingFavoriteQueueItems })
  const webview = document.getElementById('bilimi-webview') as HTMLElement & {
    executeJavaScript?: (script: string) => Promise<unknown>
  }
  Object.assign(webview, {
    executeJavaScript: vi.fn(async (script: string) => {
      if (script.includes(OLD_FAVORITE_SCAN_SCRIPT_MARKER)) {
        return {
          ok: true,
          sourceFolders: [
            {
              id: '101',
              title: '默认收藏夹',
              videos: [{ aid: 1001, title: '难判断旧藏', description: '没有明显分类线索' }]
            }
          ],
          targetMembership: {},
          skippedSourceFolderTitles: [],
          steps: ['api:favorite:list'],
          missingTargets: [],
          message: 'old favorites scanned'
        }
      }

      return emptyLedgerStatus()
    })
  })

  const preview = await requestRuntime({ id: 'scan-pending-1', type: 'scan-old-favorites' })

  expect(preview).toEqual(
    expect.objectContaining({
      items: [expect.objectContaining({ targetLedgerId: 'inbox', selected: false })]
    })
  )
  expect(upsertPendingFavoriteQueueItems).toHaveBeenCalledWith([
    expect.objectContaining({
      aid: 1001,
      title: '难判断旧藏',
      source: 'old-favorite-scan',
      sourceFolderTitle: '默认收藏夹',
      originalTargetLedgerId: 'inbox',
      status: 'pending'
    })
  ])
})
```

- [ ] **Step 5: Implement App queue conversion**

In `src/renderer/src/App.tsx`, import `PendingFavoriteQueueItem` and add:

```ts
function pendingQueueItemsFromOldFavoritePreview(
  preview: FavoriteLedgerPreview,
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  return preview.items
    .filter((item) => item.targetLedgerId === 'inbox' || item.targets?.every((target) => !target.selected))
    .map((item) => ({
      aid: item.aid,
      title: item.title,
      source: 'old-favorite-scan',
      sourceFolderTitle: item.sourceFolderTitle,
      originalTargetLedgerId: item.targetLedgerId,
      suggestedLedgerIds: (item.targets ?? [])
        .filter((target) => target.ledgerId !== 'inbox' && !target.selectedCandidateTarget)
        .map((target) => target.ledgerId),
      candidateLedgerNames: (item.candidateTargets ?? []).map((target) => target.displayName),
      reason: item.reviewRequired ? '闇€瑕佸鏍稿悗鍐嶅綊妗? : '娌℃湁鏄庣‘鍛戒腑鍙洿鎺ュ綊妗ｇ殑鍐岀洰',
      createdAt: now,
      updatedAt: now,
      status: 'pending'
    }))
}
```

After `createFavoriteLedgerPreview(...)` in `scanOldFavorites()`, call:

```ts
const queueItems = pendingQueueItemsFromOldFavoritePreview(preview)
if (queueItems.length > 0) {
  await window.bilimiDesktop?.upsertPendingFavoriteQueueItems?.(queueItems)
}
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npm test -- src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/App.test.tsx
```

Expected: PASS.

---

### Task 5: Persist New Favorite `inbox` Fallback Items to Queue

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing App test for new favorite fallback**

Add these `App.test.tsx` cases where `planFavoriteArchiveTargets()` resolves to `inbox`:

```ts
it('adds successful new favorite inbox fallback to the pending queue', async () => {
  const upsertPendingFavoriteQueueItems = vi.fn().mockResolvedValue([])
  const { requestRuntime } = renderAppWithRuntimeBridge({ upsertPendingFavoriteQueueItems })
  const webview = document.getElementById('bilimi-webview') as HTMLElement & {
    executeJavaScript?: (script: string) => Promise<unknown>
  }
  Object.assign(webview, {
    executeJavaScript: vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 3001,
          title: '没有分类线索的新收藏',
          pageText: '随手收藏，稍后再看',
          tags: []
        }
      }

      if (script.includes('/x/v3/fav/resource/deal')) {
        return {
          ok: true,
          steps: ['api:favorite:list', 'api:favorite:add'],
          missingTargets: [],
          message: '已用 B 站接口归入 Bilimi 收藏夹。'
        }
      }

      return {
        ok: true,
        steps: ['favorite:open', 'favorite:folder', 'favorite'],
        missingTargets: [],
        message: '已按内容归入内库。'
      }
    })
  })

  await requestRuntime({ id: 'run-inbox-pending', type: 'run-action', action: '藏' })

  expect(upsertPendingFavoriteQueueItems).toHaveBeenCalledWith([
    expect.objectContaining({
      aid: 3001,
      title: '没有分类线索的新收藏',
      source: 'new-favorite',
      originalTargetLedgerId: 'inbox',
      status: 'pending'
    })
  ])
})

it('does not add a queue item when inbox favorite fallback fails', async () => {
  const upsertPendingFavoriteQueueItems = vi.fn().mockResolvedValue([])
  const { requestRuntime } = renderAppWithRuntimeBridge({ upsertPendingFavoriteQueueItems })
  const webview = document.getElementById('bilimi-webview') as HTMLElement & {
    executeJavaScript?: (script: string) => Promise<unknown>
  }
  Object.assign(webview, {
    executeJavaScript: vi.fn(async (script: string) => {
      if (script.includes(VIDEO_CONTENT_CONTEXT_SCRIPT_MARKER)) {
        return {
          aid: 3002,
          title: '暂存失败的新收藏',
          pageText: '随手收藏，稍后再看',
          tags: []
        }
      }

      return {
        ok: false,
        steps: ['api:favorite:list'],
        missingTargets: ['favorite-inbox'],
        message: '暂存收藏失败。'
      }
    })
  })

  await requestRuntime({ id: 'run-inbox-failed', type: 'run-action', action: '藏' })

  expect(upsertPendingFavoriteQueueItems).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run App tests and verify failure**

Run:

```bash
npm test -- src/renderer/src/App.test.tsx
```

Expected: FAIL because new favorite fallback currently records preference feedback only.

- [ ] **Step 3: Implement new-favorite queue write**

In `src/renderer/src/App.tsx`, add:

```ts
function pendingQueueItemFromCurrentVideo(
  context: VideoContentContext,
  targetLedgerId: string,
  now = new Date().toISOString()
): PendingFavoriteQueueItem | null {
  const aid = Number(context.aid)
  if (!Number.isFinite(aid)) {
    return null
  }

  return {
    aid,
    title: context.title || '鏈懡鍚嶈棰?,
    source: 'new-favorite',
    originalTargetLedgerId: targetLedgerId,
    suggestedLedgerIds: [],
    candidateLedgerNames: [],
    reason: '鏂版敹钘忔殏鏃舵病鏈夋槑纭垎绫?,
    createdAt: now,
    updatedAt: now,
    status: 'pending'
  }
}
```

After `executeAssistantAction()` returns in `runAssistantRuntimeAction()`, add:

```ts
if (result.ok && targetLedgerId === 'inbox') {
  const item = pendingQueueItemFromCurrentVideo(videoContentContext, targetLedgerId)
  if (item) {
    await window.bilimiDesktop?.upsertPendingFavoriteQueueItems?.([item])
  }
}
```

- [ ] **Step 4: Run App tests**

Run:

```bash
npm test -- src/renderer/src/App.test.tsx
```

Expected: PASS.

---

### Task 6: Render Pending Queue in 鎺屽簱

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: Write failing component tests**

In `FavoriteLedgerPanel.test.tsx`, pass a `pendingQueueItems` prop and assert summary rendering:

```ts
it('shows pending classification queue without scanning old favorites again', () => {
  renderPanel({
    pendingQueueItems: [
      {
        aid: 1,
        title: '寰呭垎鎷ｈ棰?,
        source: 'old-favorite-scan',
        sourceFolderTitle: '榛樿鏀惰棌澶?,
        originalTargetLedgerId: 'inbox',
        suggestedLedgerIds: ['knowledge'],
        candidateLedgerNames: [],
        reason: '娌℃湁鏄庣‘鍛戒腑',
        createdAt: '2026-06-28T00:00:00.000Z',
        updatedAt: '2026-06-28T00:00:00.000Z',
        status: 'pending'
      }
    ]
  })

  expect(screen.getByRole('region', { name: '寰呭垎绫婚槦鍒? })).toBeInTheDocument()
  expect(screen.getByText('寰呭垎绫婚槦鍒?1 鏉?)).toBeInTheDocument()
  expect(screen.getByText('鍙綊鍏ュ凡鏈夊唽鐩?1 鏉?)).toBeInTheDocument()
  expect(screen.getByText('寰呭垎鎷ｈ棰?)).toBeInTheDocument()
})
```

Add a status update test:

```ts
it('archives a pending queue item from the queue view', async () => {
  const onUpdatePendingQueueItemStatus = vi.fn().mockResolvedValue([])

  renderPanel({
    pendingQueueItems: [pendingQueueFixture({ aid: 1 })],
    onUpdatePendingQueueItemStatus
  })

  fireEvent.click(screen.getByRole('button', { name: '瀹屾垚 寰呭垎鎷ｈ棰? }))

  await waitFor(() =>
    expect(onUpdatePendingQueueItemStatus).toHaveBeenCalledWith(1, 'archived')
  )
})
```

- [ ] **Step 2: Run component tests and verify failure**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx
```

Expected: FAIL because queue props/rendering do not exist.

- [ ] **Step 3: Add panel props and queue rendering**

In `FavoriteLedgerPanel.tsx`, import:

```ts
import { createPendingFavoriteQueueSummary } from '@shared/pendingFavoriteQueue'
import type { PendingFavoriteQueueItem, PendingFavoriteQueueStatus } from '@shared/types'
```

Extend props:

```ts
pendingQueueItems?: PendingFavoriteQueueItem[]
onUpdatePendingQueueItemStatus?: (
  aid: number,
  status: PendingFavoriteQueueStatus
) => Promise<PendingFavoriteQueueItem[]> | void
```

Compute summary:

```ts
const pendingQueueSummary = useMemo(
  () => createPendingFavoriteQueueSummary(pendingQueueItems ?? []),
  [pendingQueueItems]
)
const visiblePendingQueueItems = (pendingQueueItems ?? []).filter((item) => item.status === 'pending')
```

Render above the ledger checklist:

```tsx
{visiblePendingQueueItems.length > 0 ? (
  <section className="favorite-ledger-panel__pending-queue" aria-label="寰呭垎绫婚槦鍒?>
    <header>
      <strong>寰呭垎绫婚槦鍒?{pendingQueueSummary.totalPending} 鏉?/strong>
      <small>涓嶇敤閲嶆柊鎵弿鏃ц棌锛屽彲浠ヤ粠杩欓噷缁х画鏁寸悊銆?/small>
    </header>
    <div className="favorite-ledger-panel__pending-metrics">
      <span>鍙綊鍏ュ凡鏈夊唽鐩?{pendingQueueSummary.suggestedExistingCount} 鏉?/span>
      <span>寤鸿鏂板缓涓撻 {pendingQueueSummary.suggestedCandidateLedgerCount} 涓?/span>
      <span>浠嶉渶鏆傚瓨 {pendingQueueSummary.stagingCount} 鏉?/span>
    </div>
    <div className="favorite-ledger-panel__pending-list">
      {visiblePendingQueueItems.slice(0, 5).map((item) => (
        <article key={item.aid}>
          <span>{item.title}</span>
          <small>{item.sourceFolderTitle ? `鏉ユ簮 ${item.sourceFolderTitle}` : item.reason}</small>
          <button
            type="button"
            aria-label={`瀹屾垚 ${item.title}`}
            onClick={() => void onUpdatePendingQueueItemStatus?.(item.aid, 'archived')}
          >
            瀹屾垚
          </button>
        </article>
      ))}
    </div>
  </section>
) : null}
```

- [ ] **Step 4: Wire FloatingAssistantApp**

In `FloatingAssistantApp.tsx`, add state:

```ts
const [pendingQueueItems, setPendingQueueItems] = useState<PendingFavoriteQueueItem[]>([])
```

Load it with preferences/snapshot:

```ts
useEffect(() => {
  void window.bilimiDesktop?.loadPendingFavoriteQueue?.().then(setPendingQueueItems)
}, [])
```

Add handler:

```ts
async function updatePendingQueueItemStatus(aid: number, status: PendingFavoriteQueueStatus) {
  const nextItems =
    (await window.bilimiDesktop?.updatePendingFavoriteQueueItemStatus?.(aid, status)) ?? []
  setPendingQueueItems(nextItems)
  return nextItems
}
```

Pass props into `FavoriteLedgerPanel`.

- [ ] **Step 5: Add CSS and style test snippets**

In `src/renderer/src/styles.css`, add compact rules:

```css
.favorite-ledger-panel__pending-queue {
  display: grid;
  gap: 8px;
  border-block: 1px solid rgba(31, 99, 181, 0.16);
  padding: 8px 0;
}

.favorite-ledger-panel__pending-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.favorite-ledger-panel__pending-list {
  display: grid;
  gap: 6px;
}

.favorite-ledger-panel__pending-list article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  align-items: center;
}
```

In `src/renderer/src/styles.test.ts`, assert the key selectors exist.

- [ ] **Step 6: Run panel/style tests**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/styles.test.ts
```

Expected: PASS.

---

### Task 7: Documentation and Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

In the favorite ledger section, replace mentions that `inbox` means `Bilimi路寰呭垎绫籤 with:

```md
The `inbox` ledger is named `Bilimi路鏆傚瓨`. It is a real Bilibili favorite folder used only as a safe landing place for new favorites that cannot be classified confidently.

Old-favorite organization keeps unresolved items in Bilimi's local `寰呭垎绫婚槦鍒梎 instead of appending them to `Bilimi路鏆傚瓨`. The queue is shown in `鎺屽簱` and remains available after reopening the assistant, so users do not need to rescan old favorites just to continue sorting unresolved items.
```

- [ ] **Step 2: Run targeted verification**

Run:

```bash
npm test -- src/shared/favoriteLedgers.test.ts src/shared/pendingFavoriteQueue.test.ts electron/main/store.test.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/App.test.tsx src/renderer/src/styles.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run broader verification**

Run:

```bash
npm test
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files listed in this plan changed; no generated artifacts or unrelated files.

- [ ] **Step 5: Commit the completed requirement once**

Per `AGENTS.md`, make one overall commit after the whole requirement is implemented and verified:

```bash
git add src/shared/types.ts src/shared/favoriteLedgers.ts src/shared/favoriteLedgers.test.ts src/shared/pendingFavoriteQueue.ts src/shared/pendingFavoriteQueue.test.ts electron/main/store.ts electron/main/store.test.ts electron/main/index.ts electron/preload/index.ts src/renderer/src/global.d.ts src/renderer/src/features/favorites/favoriteLedgerPreview.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/styles.css src/renderer/src/styles.test.ts README.md docs/superpowers/plans/2026-06-28-staging-ledger-pending-queue.md
git commit -m "Add staging ledger pending queue"
```

Expected: one commit containing the implementation and plan.

---

## Self-Review

Spec coverage:

- `Bilimi路鏆傚瓨` default name: Task 1.
- Local pending queue model and persistence: Tasks 2 and 3.
- Old-favorite unresolved items enter local queue instead of remote staging append: Task 4.
- New favorite unresolved items still use real `Bilimi路鏆傚瓨` and enter queue only after success: Task 5.
- 鎺屽簱 fixed queue entry and no-rescan visibility: Task 6.
- Legacy `Bilimi路寰呭垎绫籤 compatibility: Task 1 and Task 7 docs.
- Error handling for failed staging writes and queue persistence: Tasks 3, 4, and 5.
- Tests and docs: Tasks 1 through 7.

Placeholder scan:

- No placeholder markers or vague test instructions remain.

Type consistency:

- Queue item types use `PendingFavoriteQueueItem`, `PendingFavoriteQueueStatus`, and `PendingFavoriteQueueSummary` consistently.
- Stable ledger id remains `inbox`; display name changes only for new defaults.

