# Ledger Interaction and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ledger naming, editing, history, bulk moves, and unfinished old-favorite batch recovery visibly reliable without changing the existing visual language.

**Architecture:** Keep UI state changes in `FavoriteLedgerPanel`, extract deterministic naming/length logic into shared helpers, and expose one lightweight persisted batch-status read through the existing old-favorite runtime bridge. Bulk operations remain atomic but yield between calculation chunks so progress can paint.

**Tech Stack:** React 19, TypeScript, Electron IPC/runtime bridge, Vitest, Testing Library.

---

### Task 1: Ledger name policy and editor behavior

**Files:**
- Modify: `src/shared/favoriteLedgers.ts`
- Test: `src/shared/favoriteLedgers.test.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] Add failing tests for Unicode-aware 20-character counting, recommended author-name simplification, deterministic collision suffixes, manual over-limit blocking, card expand/collapse, and per-card `（未保存）` markers.
- [ ] Run the focused tests and confirm failures describe missing policy/interaction behavior.
- [ ] Add shared pure helpers for full-name length and recommended-name generation; wire editor validation and card toggling without changing stored manual names.

```ts
export const BILIBILI_FAVORITE_TITLE_LIMIT = 20
export function favoriteLedgerTitleLength(value: string): number
export function recommendedAuthorLedgerDisplayName(sourceName: string, usedNames: string[]): string

const overLimit = favoriteLedgerTitleLength(activeLedger.displayName) > BILIBILI_FAVORITE_TITLE_LIMIT
```

Run: `npm test -- src/shared/favoriteLedgers.test.ts src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "(recommended ledger name|20 characters|未保存|collapses the active ledger)"`
Expected: focused tests pass after implementation.
- [ ] Run shared and Panel focused tests to green.

### Task 2: Unfinished batch status and 60-second preparation

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/assistant/assistantRuntimeTypes.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] Add failing API tests that distinguish a completed-but-uncommitted scan from committed/exhausted state.
- [ ] Add failing bridge and Panel tests for “继续本批整理”, automatic same-batch rescan, 60-second preparation timeout, and immediate auth/HTML/risk failure recovery.
- [ ] Implement a lightweight read-only batch-status runtime request and a cancellable ready wait bounded at 60 seconds.

```ts
type OldFavoriteBatchStatus = {
  pending: boolean
  accountMid?: string
  scanRunId?: string
}

type PrepareOldFavoriteScanResult = AssistantAutomationResult & {
  ready: boolean
  blockingKind?: 'auth' | 'html' | 'risk' | 'timeout'
}
```

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
Expected: pending state survives renderer remount, timeout restores idle state, and auth errors fail before 60 seconds.
- [ ] Ensure failures restore the previous stable snapshot and never advance the checkpoint.
- [ ] Run API, App, Floating, Electron runtime, and Panel focused tests to green.

### Task 3: History header and bulk-operation feedback

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] Add failing tests proving the current-state header is static/non-actionable, the duplicate current history node is absent, and prior/initial nodes remain restorable.
- [ ] Add failing fake-timer tests proving bulk busy feedback paints before work, progress advances in chunks, duplicate actions are blocked, and exactly one history entry is committed.
- [ ] Replace the native selected hint row with a static header plus actionable history list while retaining current dimensions and colors.
- [ ] Implement chunked in-memory bulk calculation with a single atomic publish, local lock, progress, success message, and before-state retention on error.

```ts
type ArchiveBulkProgress = { completed: number; total: number; label: string }
const ARCHIVE_BULK_CHUNK_SIZE = 100

await nextAnimationFrame()
for (const chunk of chunks(entries, ARCHIVE_BULK_CHUNK_SIZE)) {
  nextState = calculateChunk(nextState, chunk)
  setArchiveBulkProgress({ completed, total, label })
  await nextAnimationFrame()
}
publishAtomicArchiveState(before, nextState)
```

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "(history header|bulk move progress|single history)"`
Expected: focused tests pass and the before snapshot remains active on injected failure.
- [ ] Run the complete Panel suite to green.

### Task 4: Integration verification and single commit

**Files:**
- Review all modified tracked files; never inspect or stage `tmp/`.

- [ ] Run `git diff --check`.
- [ ] Run `npm test` and capture final totals.
- [ ] Run `npm run build`.
- [ ] Dispatch spec and code-quality review agents; resolve all Critical/Important findings with TDD.
- [ ] Stage only tracked remediation files and the approved spec/plan if intentionally included.
- [ ] Create exactly one commit for this requirement, fast-forward local `main` safely, and push only if GitHub is reachable.
