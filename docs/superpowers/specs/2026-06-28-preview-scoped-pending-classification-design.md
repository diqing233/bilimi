# Preview-scoped pending classification design

- Date: 2026-06-28
- Scope: old favorite organization, archive preview, pending classification semantics
- Status: approved for implementation planning

## Problem

The current `待分类队列` is a persistent local queue shown outside the archive preview. It mixes several states:

1. videos that are already in the right Bilimi ledger,
2. videos that have an automatic archive target,
3. videos that truly need user judgment.

This makes the queue count misleading. A scan can show 150 pending items even when only about 40 videos are actually unresolved.

## Product Decision

Replace the persistent pending queue with a preview-scoped `待分类` section inside the old favorite archive preview.

The section is generated for the current scan only. It is placed at the top of `归档预览` and discarded when the current round ends.

## Pending Classification Definition

A video belongs in preview-scoped `待分类` only when it is unresolved in the current scan.

Do not include:

1. videos already in the target Bilimi ledger,
2. videos with selected automatic archive targets,
3. videos that have already moved into a normal preview target group in this round.

Include:

1. videos classified to `inbox`,
2. videos requiring review,
3. videos with no executable target,
4. videos where only another judgment pass may produce a better target.

## User Actions

Each pending item has three actions.

### 手动分类

Clicking the video opens or navigates to the video page so the user can manually choose a Bilibili favorite folder.

This action does not mark the item complete. The item stays in the current `待分类` section until the round ends.

### 存入暂存

The item is added to the current execution plan with the target ledger `inbox`, whose display meaning is `Bilimi·暂存`.

This is an explicit user choice. Unlike the old queue behavior, old favorite unresolved items are not silently written to staging.

### 进一步判断

The item is re-evaluated in the current preview.

This can be clicked repeatedly. If the new judgment finds an executable target, the item moves from `待分类` into the corresponding archive preview group. If it still has no target, it remains in `待分类`.

## Round Lifecycle

The current scan owns the pending state.

When the user finishes or leaves the round, unresolved pending items are discarded. They are not persisted into `pendingFavoriteQueue`.

The next organization round starts from a fresh scan and produces a fresh preview.

## Removed Behavior

Remove the standalone persistent `待分类队列` UI from the ledger panel.

Remove old `完成` and `清空待分类队列` interactions from the user-facing flow.

Stop writing old favorite unresolved preview items into `pendingFavoriteQueue`.

Clear or ignore old persisted pending queue data so it no longer affects the ledger panel.

## Existing New Favorite Fallback

This redesign is scoped to old favorite organization.

For current-video favorite actions, `Bilimi·暂存` can still be used as a real Bilibili fallback when classification is unclear. That flow must not reintroduce the old standalone pending queue UI.

## Acceptance Criteria

1. `归档预览` shows a top `待分类` section when the current scan has unresolved videos.
2. The count excludes already matched, already-in-target, and selected automatic archive items.
3. `手动分类` opens the video and leaves the item in the pending section.
4. `存入暂存` adds that item to the executable plan targeting `inbox`.
5. `进一步判断` can be clicked repeatedly and can move an item into a normal target group when a target is found.
6. Finishing the round discards unresolved pending items.
7. The old persistent pending queue panel no longer appears.
8. Old favorite scans no longer persist unresolved items to `pendingFavoriteQueue`.
