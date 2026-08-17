# DeepSeek Source Selection Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent selected bilimi work folders from turning successful DeepSeek results into false workspace-conflict retries.

**Architecture:** The shared workspace rule already defines every observed B station folder as selectable. The DeepSeek service must use that same rule when it builds an all-batch plan and a current-batch request, so its expected source fingerprint equals the coordinator's authoritative source fingerprint. Genuine changes after request dispatch remain protected conflicts.

**Tech Stack:** Electron main process, TypeScript, Vitest.

---

### Task 1: Record the product contract

**Files:**
- Modify: `docs/项目功能项目书.md:293`
- Modify: `docs/requirement-ledgers/2026-08-17-deepseek-all-retry-failures.md`

- [x] State that the selected source set includes ordinary B station folders and bound bilimi work folders, and must be identical in planning, request construction, and conflict detection.
- [x] State that real manual classification or post-request source changes are still conflicts; no B station write or automatic replay is allowed.

### Task 2: Add a failing regression test

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [x] Add a test with a selected ordinary source containing one video and a selected bound bilimi work folder. Make the coordinator mock return a conflict whenever the expected source list omits the bound folder.

```ts
await expect(service.organizeCurrentSegment('100')).resolves.toMatchObject({
  progress: { successfulVideoCount: 1, failedVideoCount: 0 },
  failures: []
})
expect(expected.selectedSourceFolderIds).toEqual(['ordinary', 'bound'])
```

- [x] Run `npm test -- --run electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts` and confirm the test fails before production code changes because `bound` is missing from the expectation.

### Task 3: Unify source selection

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts:411-415`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts:829-835`

- [x] Import and use `oldFavoriteFolderIsScanEligible` for both selection sites.

```ts
const selectedFolderIds = new Set(snapshot.sourceFolders
  .filter((folder) => oldFavoriteFolderIsScanEligible(folder) && folder.selected)
  .map((folder) => folder.id))
```

- [x] Do not change the coordinator's per-video classification comparison, the provider request protocol, the selected-folder UI, or retry ownership.

### Task 4: Verify and document

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-17-deepseek-all-retry-failures.md`

- [x] Re-run the focused test and confirm it passes.
- [x] Run `npm test`, `npm run build`, `git diff --check`, and record the exact evidence per R001-R003.
- [x] In the running development app, confirm the existing canceled checkpoint remains untouched; do not issue a new DeepSeek request, retry, save, or B station sync during validation.

### Task 5: Commit only the scoped change

**Files:**
- Modify only files from Tasks 1-4.

- [x] Check `git status --short`, `git diff --stat`, and `git diff --check` for unrelated changes.
- [x] Commit the documentation, test, and source correction together with a `fix:` message after all required verification passes.
