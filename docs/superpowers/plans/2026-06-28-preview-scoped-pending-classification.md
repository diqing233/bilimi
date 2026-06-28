# Preview-scoped Pending Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old persistent `待分类队列` with a per-scan pending classification section at the top of old favorite `归档预览`.

**Architecture:** Keep scan data inside `FavoriteLedgerPanel` preview state and derive unresolved items from the current `FavoriteLedgerPreview`. Remove old-favorite writes to `pendingFavoriteQueue`, remove the standalone queue panel, and add explicit per-item actions that either navigate to the video, add staging to the current execution plan, or re-run judgment for the current item.

**Tech Stack:** React 19, TypeScript, Electron preload IPC, Vitest, Testing Library.

---

### Task 1: Stop Old Favorite Scans From Persisting Pending Queue Items

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add or update tests in `src/renderer/src/App.test.tsx` so old favorite scans never call `upsertPendingFavoriteQueueItems`, while current-video favorite fallback still can.

```ts
it('does not persist old favorite unresolved items into the pending queue', async () => {
  const upsertPendingFavoriteQueueItems = vi.fn().mockResolvedValue([])
  const scanOldFavorites = vi.fn().mockResolvedValue({
    ok: true,
    sourceFolders: [
      {
        id: '1',
        title: '默认收藏夹',
        videos: [{ aid: 1, title: '待分类旧藏', tags: [] }]
      }
    ],
    targetMembership: {},
    skippedSourceFolderTitles: []
  })
  const { requestRuntime } = renderAppWithRuntimeBridge({
    scanOldFavorites,
    upsertPendingFavoriteQueueItems
  })

  await requestRuntime({ id: 'scan', type: 'scan-old-favorites' })

  expect(upsertPendingFavoriteQueueItems).not.toHaveBeenCalled()
})
```

Keep or add the current-video fallback assertion:

```ts
expect(upsertPendingFavoriteQueueItems).toHaveBeenCalledWith([
  expect.objectContaining({
    source: 'new-favorite',
    originalTargetLedgerId: 'inbox',
    status: 'pending'
  })
])
```

- [ ] **Step 2: Run the targeted App tests and verify failure**

Run:

```bash
npm test -- src/renderer/src/App.test.tsx
```

Expected before implementation: the new old-favorite assertion fails because `scanOldFavorites` still writes queue items.

- [ ] **Step 3: Remove old-favorite pending queue creation**

In `src/renderer/src/App.tsx`, delete `pendingQueueItemsFromOldFavoritePreview` and remove this block from `scanOldFavorites`:

```ts
const queueItems = pendingQueueItemsFromOldFavoritePreview(preview)

if (queueItems.length > 0) {
  await window.bilimiDesktop?.upsertPendingFavoriteQueueItems?.(queueItems)
}
```

Keep `pendingQueueItemFromCurrentVideo` unchanged for new-favorite fallback.

- [ ] **Step 4: Run the targeted App tests and verify pass**

Run:

```bash
npm test -- src/renderer/src/App.test.tsx
```

Expected after implementation: App tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/App.test.tsx
git commit -m "fix: stop persisting old favorite pending items"
```

### Task 2: Derive Preview-scoped Pending Items and Remove Standalone Queue UI

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] **Step 1: Write failing FavoriteLedgerPanel tests**

Add tests in `FavoriteLedgerPanel.test.tsx` that assert:

1. no standalone `待分类队列` region is rendered,
2. `归档预览` shows a top `待分类` group for unresolved items,
3. already-in-target and selected automatic archive items are excluded from `待分类`.

Use this shape:

```ts
it('shows unresolved old favorites at the top of archive preview instead of the standalone queue', async () => {
  renderFavoriteLedgerPanel({
    preview: {
      items: [
        {
          aid: 1,
          title: '真正待分类',
          sourceFolderTitle: '默认收藏夹',
          targetLedgerId: 'inbox',
          targetFolderId: '9008',
          targetDisplayName: 'Bilimi·暂存',
          reviewRequired: true,
          alreadyInTarget: false,
          selected: false,
          targets: [
            {
              ledgerId: 'inbox',
              folderId: '9008',
              displayName: 'Bilimi·暂存',
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
          targetDisplayName: 'Bilimi·学吧你就',
          reviewRequired: false,
          alreadyInTarget: true,
          selected: false,
          targets: []
        }
      ],
      skippedSourceFolderTitles: []
    }
  })

  await openOldFavoritePreviewStep()

  expect(screen.queryByRole('region', { name: '待分类队列' })).not.toBeInTheDocument()
  expect(screen.getByRole('group', { name: '待分类 1 条' })).toBeInTheDocument()
  expect(screen.getByText('真正待分类')).toBeInTheDocument()
  expect(screen.queryByText('已经对号入座')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the targeted panel tests and verify failure**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx
```

Expected before implementation: standalone queue tests or new preview pending assertions fail.

- [ ] **Step 3: Add pending derivation helpers**

In `FavoriteLedgerPanel.tsx`, add focused helpers near the existing old favorite helpers:

```ts
function isPreviewScopedPendingItem(item: FavoriteLedgerPreviewItem) {
  if (item.alreadyInTarget) {
    return false
  }

  const targets = targetsForOldFavoriteItem(item)
  const hasSelectedExecutableTarget = targets.some(
    (target) => target.selected && target.ledgerId !== 'inbox' && !target.alreadyInTarget
  )

  if (hasSelectedExecutableTarget) {
    return false
  }

  return (
    item.targetLedgerId === 'inbox' ||
    item.reviewRequired ||
    targets.length === 0 ||
    targets.every((target) => !target.selected || target.ledgerId === 'inbox')
  )
}

function pendingReasonText(item: FavoriteLedgerPreviewItem) {
  if (item.reviewRequired) {
    return '需要复核'
  }
  if (item.targetLedgerId === 'inbox') {
    return '暂无明确归档目标'
  }
  return '需要进一步判断'
}
```

- [ ] **Step 4: Split selectable preview items**

In `FavoriteLedgerPanel.tsx`, derive:

```ts
const previewScopedPendingItems = useMemo(
  () => selectableOldFavoriteItems.filter(isPreviewScopedPendingItem),
  [selectableOldFavoriteItems]
)
const archivePreviewItems = useMemo(
  () => selectableOldFavoriteItems.filter((item) => !isPreviewScopedPendingItem(item)),
  [selectableOldFavoriteItems]
)
```

Use `archivePreviewItems` when building `oldFavoriteTargetGroups` so pending items do not also appear in normal archive groups.

- [ ] **Step 5: Remove standalone pending queue rendering**

Delete the `visiblePendingQueueItems` rendering block with `favorite-ledger-panel__pending-queue`, and stop passing queue callbacks from `FloatingAssistantApp.tsx` to `FavoriteLedgerPanel`.

Keep desktop queue APIs intact for current-video fallback storage compatibility, but do not render their old panel.

- [ ] **Step 6: Render the top pending section inside preview**

Inside the `oldFavoriteStep === 'preview'` branch, before normal archive groups, render:

```tsx
{oldFavoriteGuideMode === 'organize' && previewScopedPendingItems.length > 0 ? (
  <section
    className="favorite-ledger-panel__preview-row favorite-ledger-panel__preview-row--pending"
    role="group"
    aria-label={`待分类 ${previewScopedPendingItems.length} 条`}
  >
    <header>
      <span className="favorite-ledger-panel__preview-heading">
        <strong>待分类</strong>
        <small>{previewScopedPendingItems.length} 条需要处理</small>
      </span>
    </header>
    <div className="favorite-ledger-panel__preview-videos" aria-label="待分类视频">
      {previewScopedPendingItems.map((item) => (
        <article key={`pending-${item.sourceFolderTitle}-${item.aid}`}>
          <div className="favorite-ledger-panel__preview-video favorite-ledger-panel__preview-video--pending">
            <span className="favorite-ledger-panel__preview-video-title" title={item.title}>
              {item.title}
            </span>
            <small>
              来源 {item.sourceFolderTitle} · {pendingReasonText(item)}
            </small>
          </div>
        </article>
      ))}
    </div>
  </section>
) : null}
```

- [ ] **Step 7: Run targeted component tests and verify pass**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected after implementation: targeted tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
git commit -m "feat: show pending classification in archive preview"
```

### Task 3: Add Manual, Staging, and Rejudge Actions

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts`

- [ ] **Step 1: Write failing action tests**

Add tests that assert:

1. `手动分类` calls a provided `onOpenOldFavoriteVideo` callback with the video URL and keeps the item visible.
2. `存入暂存` selects the `inbox` target for that item and increases confirm task count.
3. `进一步判断` can move an item from `待分类` into a normal target group when a new target is produced.

Use this URL assertion:

```ts
expect(onOpenOldFavoriteVideo).toHaveBeenCalledWith('https://www.bilibili.com/video/av1')
expect(screen.getByRole('group', { name: '待分类 1 条' })).toBeInTheDocument()
```

Use this staging assertion:

```ts
fireEvent.click(screen.getByRole('button', { name: '存入暂存 真正待分类' }))
await goToConfirmStep()
expect(screen.getByText('已选择 1 条归档任务')).toBeInTheDocument()
```

- [ ] **Step 2: Run targeted action tests and verify failure**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts
```

Expected before implementation: callbacks and new action buttons are missing.

- [ ] **Step 3: Add callback props**

Extend `FavoriteLedgerPanelProps`:

```ts
onOpenOldFavoriteVideo?: (url: string) => void
```

Pass it from `FloatingAssistantApp.tsx` to `FavoriteLedgerPanel`, and from `App.tsx` to `FloatingAssistantApp` by reusing `openInternalTab`.

- [ ] **Step 4: Add manual classify action**

Add:

```ts
function oldFavoriteVideoUrl(item: FavoriteLedgerPreviewItem) {
  return `https://www.bilibili.com/video/av${item.aid}`
}

function openOldFavoriteVideo(item: FavoriteLedgerPreviewItem) {
  onOpenOldFavoriteVideo?.(oldFavoriteVideoUrl(item))
}
```

Render:

```tsx
<button
  type="button"
  aria-label={`手动分类 ${item.title}`}
  onClick={() => openOldFavoriteVideo(item)}
>
  手动分类
</button>
```

Do not remove the item from `previewScopedPendingItems`.

- [ ] **Step 5: Add staging action**

Use the existing target selection mechanism:

```ts
function stageOldFavorite(item: FavoriteLedgerPreviewItem) {
  setSelectedOldFavoriteTargetKeys((current) => {
    const next = new Set(current)
    next.add(oldFavoriteTargetKey(item.aid, 'inbox'))
    return next
  })
  setSelectedOldFavoriteAids((current) => {
    const next = new Set(current)
    next.add(item.aid)
    return next
  })
}
```

Render:

```tsx
<button
  type="button"
  aria-label={`存入暂存 ${item.title}`}
  onClick={() => stageOldFavorite(item)}
>
  存入暂存
</button>
```

Ensure `buildSelectedOldFavoritePlanItems` allows selected `inbox` targets when explicitly selected by this action.

- [ ] **Step 6: Add rejudge action**

Add a preview helper in `favoriteLedgerPreview.ts`:

```ts
export function rejudgeFavoriteLedgerPreviewItem(args: {
  item: FavoriteLedgerPreviewItem
  ledgers: FavoriteLedger[]
  targetMembership: Record<string, number[]>
  multiArchiveMode?: FavoriteArchiveMultiMode
}): FavoriteLedgerPreviewItem {
  const preview = createFavoriteLedgerPreview({
    ledgers: args.ledgers,
    sourceFolders: [
      {
        id: args.item.sourceFolderTitle,
        title: args.item.sourceFolderTitle,
        videos: [
          {
            aid: args.item.aid,
            title: args.item.title,
            author: args.item.author,
            description: args.item.description,
            tags: args.item.tags ?? [],
            pageText: args.item.pageText,
            category: args.item.category
          }
        ]
      }
    ],
    targetMembership: args.targetMembership,
    multiArchiveMode: args.multiArchiveMode
  })
  return preview.items[0] ?? args.item
}
```

If existing `FavoriteLedgerPreviewItem` does not preserve enough source context, extend it with optional `author`, `description`, `tags`, `pageText`, and `category`, populated in `createFavoriteLedgerPreview`.

In `FavoriteLedgerPanel`, make `进一步判断` update the current preview item in place.

- [ ] **Step 7: Render action buttons compactly**

Inside each pending item, render three buttons:

```tsx
<div className="favorite-ledger-panel__pending-actions" aria-label={`${item.title} 操作`}>
  <button type="button" aria-label={`手动分类 ${item.title}`} onClick={() => openOldFavoriteVideo(item)}>
    手动分类
  </button>
  <button type="button" aria-label={`存入暂存 ${item.title}`} onClick={() => stageOldFavorite(item)}>
    存入暂存
  </button>
  <button type="button" aria-label={`进一步判断 ${item.title}`} onClick={() => rejudgeOldFavorite(item)}>
    进一步判断
  </button>
</div>
```

- [ ] **Step 8: Run targeted tests and verify pass**

Run:

```bash
npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts src/renderer/src/App.test.tsx
```

Expected after implementation: targeted tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/App.tsx src/renderer/src/features/favorites/favoriteLedgerPreview.ts src/renderer/src/features/favorites/favoriteLedgerPreview.test.ts
git commit -m "feat: add pending classification actions"
```

### Task 4: Final Cleanup and Verification

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: any tests that referenced the removed standalone queue panel
- Optional Modify: `README.md`

- [ ] **Step 1: Remove obsolete tests and props**

Delete assertions that expect the old standalone `待分类队列` region, `清空待分类队列`, or old `完成` button.

Remove unused props:

```ts
pendingQueueItems
onClearPendingQueue
onUpdatePendingQueueItemStatus
```

from `FavoriteLedgerPanel` if no longer used.

- [ ] **Step 2: Add compact styles**

In `styles.css`, add styling for the pending preview row and actions:

```css
.favorite-ledger-panel__preview-row--pending {
  border-color: rgba(40, 95, 150, 0.35);
}

.favorite-ledger-panel__preview-video--pending {
  align-items: stretch;
  cursor: default;
}

.favorite-ledger-panel__pending-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
```

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: 82 test files pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx README.md
git commit -m "chore: remove standalone pending queue flow"
```

- [ ] **Step 5: Report final verification**

Report:

```text
Implemented on branch codex/preview-pending-classification.
Verification: npm test passed.
Known existing warning: PalaceMaidPetApp act(...) warnings remain from baseline.
```
