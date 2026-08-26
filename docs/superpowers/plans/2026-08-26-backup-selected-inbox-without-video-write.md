# Backup Selected Inbox Without Video Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A selected `bilimi·暂存` with actual archive-preview members must be backed up in the single sync confirmation when it has no formal binding, even while its videos remain excluded from the default Bilibili write plan.

**Architecture:** The main-process preflight derives a backup-only inbox target from the authoritative selected classifications and saved-enabled rules. The existing `includeInbox` option remains the sole write-plan switch: it controls remote video assignments and capacity shards, never whether an eligible inbox has a first-shard backup gap. The existing renderer modal already renders every `missingLedgers` entry and issues the one scoped backup request, so no second modal or renderer-side target inference is introduced.

**Tech Stack:** TypeScript, Electron main/preload IPC, React, Vitest, Testing Library.

---

### Task 1: Record the two-target contract

**Files:**

- Modify: `docs/项目功能项目书.md:402-416`
- Modify: `docs/contracts/favorites.md:55-66`
- Modify: `docs/requirement-ledgers/2026-08-26-organization-recovery-dialog-chinese.md`

- [x] **Step 1: Define `备册目标` and `B 站视频写入目标`.**

  Record that a saved-enabled, non-excluded inbox with at least one current archive-preview member remains in the backup target when `includeInbox` is false. Record that it has no remote assignment or capacity-shard requirement unless the user selects “同步 bilimi·暂存”.

- [x] **Step 2: Preserve protected boundaries.**

  Keep remote drafts outside both targets; keep deselected rules outside both targets; preserve one confirmation dialog, exact-ID candidate consent, creation-time re-read, and no Bilibili side effect before confirmation.

### Task 2: RED - characterize the main-process gap

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:8677-8726`

- [x] **Step 1: Add the failing default-inbox preflight regression.**

  Add a test beside `limits backup gaps to selected assignments and exposes shards needed after first backup`:

  ```ts
  it('requires a first backup for an eligible inbox without adding inbox videos to the default write plan', async () => {
    const root = await createRoot()
    const repository = new FavoriteRepositoryService({ root, now: () => '2026-08-26T00:00:00.000Z' })
    const coordinator = new OldFavoriteWorkspaceCoordinator({
      repository,
      workspaceStore: new OldFavoriteWorkspaceStore({ root }),
      listSavedEnabledLedgers: vi.fn().mockResolvedValue([{ id: 'inbox', title: 'bilimi·暂存' }]),
      now: () => '2026-08-26T00:00:00.000Z'
    })
    await coordinator.beginScan('100', 'incremental')
    await coordinator.completeScan('100', { revision: 1, aids: [1] })

    await expect(coordinator.getBilibiliExecutionPreflight('100')).resolves.toMatchObject({
      missingLedgers: [{ logicalLedgerId: 'inbox', logicalTitle: 'bilimi·暂存', reason: 'unbacked' }],
      requiredPhysicalShards: []
    })
  })
  ```

- [x] **Step 2: Run RED.**

  Run:

  ```powershell
  npm exec vitest -- run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "requires a first backup for an eligible inbox"
  ```

  Expected: fail because the current default preflight calls `loadSelectedClassificationsForFreeze(workspace, false)` and removes the inbox before `missingLedgers` is derived.

- [x] **Step 3: Add the excluded-inbox guard test.**

  Clone the same setup, call `await coordinator.setRoundExcludedLedgerIds('100', ['inbox'])`, then assert `missingLedgers: []` and `requiredPhysicalShards: []`. This proves a top-card cancellation remains outside both target sets.

### Task 3: GREEN - derive the backup-only inbox target in main

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:4410-4508`

- [x] **Step 1: Load the authoritative selected classifications with inbox visibility.**

  In `getBilibiliExecutionPreflight`, call `loadSelectedClassificationsForFreeze(workspace, true)` so unclassified selected videos are visible as the existing local-inbox fallback. Continue filtering `id !== 'inbox'` from `assignmentAids` unless `options.includeInbox === true`.

- [x] **Step 2: Derive the backup-only first-shard target.**

  After `savedLedgers` is read, derive an `inboxNeedsBackup` boolean only when all conditions hold: `includeInbox` is false, `savedLedgers` contains `inbox`, and the selected classifications contain at least one `targetLedgerIds.includes('inbox')`. Add `inbox` to `selectedLogicalLedgerIds` only for this preflight gap loop; do not add it to `assignmentAids`.

- [x] **Step 3: Keep capacity and frozen video writes unchanged.**

  Leave `requiredPhysicalShards` driven by `assignmentAids`; leave `freezeForBilibiliExecution` and `loadSelectedClassificationsForFreeze(..., false)` behavior unchanged. Thus confirmation can back up the first inbox shard, while `confirm-and-execute-bilibili-plan` continues to receive no `includeInbox` option and cannot write inbox videos.

- [x] **Step 4: Run GREEN.**

  Run:

  ```powershell
  npm exec vitest -- run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "eligible inbox|limits backup gaps|persists a round ledger exclusion"
  ```

  Expected: the new two-target tests pass, normal selected-rule preflight remains unchanged, and an excluded inbox does not reappear.

### Task 4: Verify the single-confirmation handoff and document evidence

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx:3100-3160`
- Modify: `docs/requirement-ledgers/2026-08-26-organization-recovery-dialog-chinese.md`

- [x] **Step 1: Add the renderer handoff regression.**

  Mock a preflight whose only gap is `{ logicalLedgerId: 'inbox', logicalTitle: 'bilimi·暂存', reason: 'unbacked' }`, retain `unclassifiedAidCount: 1`, click `确认并同步到 B 站`, and assert the sole `同步前备册确认` dialog lists `收藏夹：bilimi·暂存（未备册）` while its `同步 bilimi·暂存（1 条）` checkbox remains unchecked. On one confirmation, assert the scoped backup receives `backupTargetLedgerIds: ['inbox']` and the execution command remains `{ type: 'confirm-and-execute-bilibili-plan' }` without an inbox option.

- [x] **Step 2: Run renderer GREEN.**

  Run:

  ```powershell
  npm exec vitest -- run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "inbox"
  ```

  Expected: one modal, first-shard backup requested, default video-write selection remains false.

- [x] **Step 3: Record evidence and protected boundaries.**

  Update I005 with exact code locations, RED/GREEN commands, the fact that tests use fakes and no real Bilibili create/bind/write occurred, and the remaining Electron acceptance condition: a real signed-in preflight can be opened read-only but its confirmation button must not be clicked.

### Task 5: Final verification and local commit

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/contracts/favorites.md`
- Modify: `docs/requirement-ledgers/2026-08-26-organization-recovery-dialog-chinese.md`
- Create: `docs/superpowers/plans/2026-08-26-backup-selected-inbox-without-video-write.md`

- [x] **Step 1: Run final checks.**

  ```powershell
  npm exec vitest -- run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx
  npm test
  npm run build
  git diff --check
  git diff --stat
  git status --short
  ```

- [x] **Step 2: Commit only the I005 files.**

  Exclude `pnpm-lock.yaml` and `pnpm-workspace.yaml`, then commit the listed code, tests, project book, contract, ledger, and this plan with a message describing backup-only inbox preflight.

  Commit: `feat: back up selected inbox without video write` (I005 files only; the two untracked `pnpm` files remain untouched).
