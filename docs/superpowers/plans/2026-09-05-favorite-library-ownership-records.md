# Favorite Library Ownership Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 收藏库 detail render auditable initial/synced B站 positions, derive the correct ownership state, preserve adjustment history, and remove AV IDs from list subtitles.

**Architecture:** The main-process detail snapshot will produce auditable remote-position facts, preserving a later complete observation separately from an earlier write receipt for the same folder. The renderer will display one priority-labelled position per folder in the three-line 收藏归属 block and delegate state determination to a pure model helper. Repository local-plan replacement behavior will remain unchanged unless a regression test proves a concrete update is required.

**Tech Stack:** Electron main process, TypeScript, React, Vitest.

---

### Task 1: Document the approved contract

**Files:**
- Modify: `docs/项目功能项目书.md:6.2-6.3`
- Modify: `docs/requirement-ledgers/2026-09-05-favorite-library-ownership-mismatch-discussion.md`

- [x] **Step 1: Record the contract**

Document: list-row subtitles omit AV IDs; detail has only 收藏库归属 / B站收藏夹归属 / 归属状态; initial scan facts are marked `（初始位置）`; successful-write facts are marked `（同步位置）`; an equal synced target is consistent even with an additional initial source.

- [x] **Step 2: Check documentation diff**

Run: `git diff --check -- docs/项目功能项目书.md docs/requirement-ledgers/2026-09-05-favorite-library-ownership-mismatch-discussion.md`

Expected: exit 0.

### Task 2: Add remote-position-fact and status tests first

**Files:**
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

- [x] **Step 1: Write the failing detail-snapshot test**

Create a snapshot with local `bilimi-logical:game`, initial source `默认收藏夹`, and a confirmed write to the bound game shard. Assert the returned detail has `remotePositionFacts` in this form:

```ts
[
  { title: 'bilimi·游戏专区', kind: 'synced' },
  { title: '默认收藏夹', kind: 'initial' }
]
```

and assert no unrelated logical title is manufactured from another adjustment record.

- [x] **Step 2: Write the failing state-model tests**

Assert the desired helper behavior:

```ts
expect(formatFavoriteLibraryPositionStatus({
  localFolderIds: ['bilimi-logical:game'],
  remotePositions: [{ folderId: 'bilimi-logical:game', kind: 'synced' }, { folderId: 'bilibili:default', kind: 'initial' }]
})).toBe('归属一致')
```

and assert a later complete observation that conflicts with all synced targets returns `归属不一致`.

- [x] **Step 3: Run focused tests to verify RED**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

Expected: new tests fail because `remotePositionFacts` and the new status input do not exist.

### Task 3: Produce auditable position facts in the main process

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts:429-454,1162-1205,1909-1964`
- Test: `electron/main/favoriteRepositoryService.test.ts`

- [x] **Step 1: Add the minimal detail type**

Add a `remotePositionFacts` detail field with immutable `{ folderId, title, kind: 'initial' | 'synced' | 'observed', confirmedAt? }` items.

- [x] **Step 2: Build facts from evidence only**

Derive `initial` facts from `video.initialSource.folders`; derive `synced` facts only from successful append/position receipts through the existing bound-shard resolver; preserve ordinary source IDs rather than mapping them to a logical folder. Keep a later complete observation distinct from an earlier receipt for status reconciliation; deduplicate only at display time, preserving the higher-priority sync label.

- [x] **Step 3: Run focused service tests to verify GREEN**

Run: `npm test -- electron/main/favoriteRepositoryService.test.ts`

Expected: PASS.

### Task 4: Derive and render the three-line ownership block

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts:171-174`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx:2180-2218,2734-2739,2843-2847`
- Test: `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: Write failing renderer assertions**

Render a detail with both fact kinds. Assert it contains:

```text
B站收藏夹归属：bilimi·游戏专区（同步位置）、默认收藏夹（初始位置）
归属状态：归属一致
```

Assert `初始来源` is absent and `最近调整` remains. Render a list row with `author` and `bvid`/aid and assert its subtitle is author-only.

- [x] **Step 2: Run focused renderer test to verify RED**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: new assertions fail because the old UI still renders an initial-source section and AV/BV identity subtitle.

- [x] **Step 3: Implement the minimal model and view changes**

Format facts with exact suffixes; determine `归属一致` when any synced logical position equals any local logical target. Treat initial-only facts as evidence for `尚未扫描B站归属` rather than a conflict. Keep a later complete conflicting observation authoritative only when its timestamp is later than the matching success receipt; compare only managed `bilimi-logical:*` positions, so a default source does not create a conflict. Delete only the list-subtitle AV/BV fallback and initial-source section.

- [x] **Step 4: Run focused renderer/model tests to verify GREEN**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

Expected: PASS.

### Task 5: Verify history preservation and protected flows

**Files:**
- Test: `src/shared/favoriteRepository.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`

- [x] **Step 1: Add or extend the regression test**

Use two actual classification adjustments for one aid. Assert both remain in descending history, and only actual success receipts are exposed as synced remote-position facts; no history target by itself becomes a B站 position.

- [ ] **Step 2: Run the repository and sync regression set with captured final exit status**

Run: `npm test -- src/shared/favoriteRepository.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteRepositorySyncService.test.ts`

Expected: PASS.

Status: the related repository, sync and renderer/model suites have current passing evidence; the additional `oldFavoriteWorkspaceCoordinator` suite emitted its expected progress but its final runner exit summary was not captured in this session, so it is not marked complete.

### Task 6: Integration, UI validation, and commit

**Files:**
- Modify: only files changed by Tasks 1-5

- [x] **Step 1: Targeted suite**

Run: `npm test -- --reporter=dot electron/main/favoriteRepositoryService.test.ts src/shared/favoriteRepository.test.ts electron/main/favoriteRepositorySyncService.test.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Result: 5 files / 435 tests PASS. The full targeted suite showed pre-existing React `act(...)` warnings in unrelated app tests, without failures.

- [x] **Step 2: Run static checks**

Run: `npm run build; git diff --check; git status --short; git diff --stat`

Result: build and diff check PASS. This project has no `typecheck` script; direct `npx tsc --noEmit` is known to have pre-existing repository-wide errors, so it is not a valid task gate. The unrelated CRLF-only `2026-09-05-favorite-library-followup.md` remains un-staged.

- [ ] **Step 3: Development UI acceptance (blocked externally)**

Start the Electron development build. Open the affected 收藏库 detail and confirm the three ordered labels, exact source suffixes, no standalone 初始来源 section, recent-adjustment preservation, author-only list subtitle, and responsive mouse movement/click/scroll/resize/minimize/restore/close.

Result: the development build is running and its artifacts contain the current implementation. Automated Windows UI inspection could not be authorized in this task session, so no real user-data or B站-modifying control was clicked and this manual response check remains explicitly unverified.

- [x] **Step 4: Update ledger evidence and commit**

Record exact code paths, commands, results, and UI acceptance in the ledger index. Stage only this topic’s files and create one commit:

```bash
git add docs/项目功能项目书.md docs/requirement-ledgers/2026-09-05-favorite-library-ownership-mismatch-discussion.md docs/superpowers/plans/2026-09-05-favorite-library-ownership-records.md electron/main/favoriteRepositoryService.ts electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/features/favorites/favoriteLibraryModel.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts
git commit -m "fix: clarify favorite library ownership records"
```

Result: recorded on `codex/favorite-library-ownership-records`; no merge or push was performed.
