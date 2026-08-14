# Favorite Library Classification History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align favorite-library classification display and filtering with the latest valid classification adjustment, add structured recent/history detail records, and simplify the list filters without loading history into the list.

**Architecture:** Keep list rows backed by the repository snapshot and derive one effective classification source in shared code. Add a structured per-video classification-adjustment journal beside the existing lightweight event journal; expose only the latest record in detail by default and page older records on demand. Keep filter menus portaled and make the list header expose only current ownership and the four classifications.

**Tech Stack:** TypeScript, Electron main process, React renderer, Vitest, existing JSONL repository journals and preload IPC.

---

### Task 1: Shared effective classification model

**Files:**
- Modify: `src/shared/favoriteRepository.ts`
- Test: `src/shared/favoriteRepository.test.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`
- Test: `electron/main/favoriteRepositoryService.test.ts`

- [x] Add failing tests for latest valid classification precedence, fallback after `local-copy`/`local-move`, and no-classification behavior.
- [x] Run the focused tests and confirm the new assertions fail for the current snapshot-only lookup.
- [x] Add one shared pure resolver for the four valid classification kinds and use it in service filtering and row/detail projection.
- [x] Re-run focused tests; confirm list filtering and display use the same resolver.

### Task 2: Remove obsolete list source filter and fix floating menus

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`

- [x] Add failing UI assertions that the header has no “原始” filter/status, keeps current ownership and four classification choices, and the menu remains portaled in a narrow scrollable layout.
- [x] Run the focused renderer tests and confirm the old header/filter assertions fail.
- [x] Remove `initialSourceFilter` from list UI state and requests, use a compact independent header control, and keep classification/current-ownership menus portal-positioned with outside/Escape close and scroll/resize repositioning.
- [x] Re-run renderer tests and inspect the narrow-column DOM layout.

### Task 3: Structured classification adjustment records

**Files:**
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Test: corresponding shared/main/renderer tests

- [x] Add failing tests for one record per classification/placement operation, merged side effects, newest-first detail loading, and legacy “未记录” fallback.
- [x] Run the focused tests and confirm no structured record exists yet.
- [x] Add a typed journal record containing operation, effective classification, before/after folders, library insertion, Bilibili sync result, and timestamp; expose latest and paged older records per aid.
- [x] Re-run focused tests and verify writes are atomic with the existing command.

### Task 4: Detail page recent/history presentation

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.css`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] Add failing assertions for fixed initial source, latest “最近调整” card, merged `分类方式`, detailed `分类详情`, and expanded “第二次调整/首次分类” history.
- [x] Run focused renderer tests and confirm the current event-only detail cannot satisfy them.
- [x] Render the latest record by default and load older records only after “查看完整处理记录”; preserve legacy events separately.
- [x] Re-run focused renderer tests and verify old records are ordered newest-first.

### Task 5: Performance and completion evidence

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-14-old-favorite-scan-metrics-and-end-dialog.md`
- Test: focused performance/request-count tests in existing main/renderer test files

- [x] Add request-count assertions proving list loading does not read classification history, detail reads one latest record, and expansion paginates older records.
- [x] Run all second-round focused tests, `git diff --check`, and the project build.
- [x] Update each ledger index row with code locations, test evidence, and any Electron verification limitations.
- [x] Review the full ledger again, stage only second-round files plus this ledger/plan, commit once on local `main`, verify `git status`, then execute Windows sleep only after the commit succeeds.
