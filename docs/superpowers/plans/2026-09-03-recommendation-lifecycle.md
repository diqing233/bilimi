# Recommendation Lifecycle And Second-Round Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep recommendation rules linked across organization rounds, make no-workspace toggles safe, and prevent a backed-up remote folder from producing a duplicate draft.

**Architecture:** Treat the account's authoritative rule directory and stable rule IDs as the identity source. A persisted recommendation-origin rule remains an upper rule even when legacy `recommendation-draft`/`local-draft` fields remain; only a workspace-only temporary draft uses cancellation deletion. Remote projections are keyed by exact Bilibili `folderId`, and backup acknowledgements must be reflected before another inventory projection can append a draft.

**Tech Stack:** React, TypeScript, Electron IPC scripts, Vitest.

---

### Task 1: Lock the three regressions with failing tests

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] **Step 1: Add a projection test for a persisted recommendation-origin rule**

Add a test for `createRecommendationProjection` where the account rule and candidate have the same ID, the rule has `ruleOrigin: 'recommendation-draft'`, `syncState: 'local-draft'`, and no remote folder. Assert both projection maps contain that ID.

- [x] **Step 2: Add a no-workspace cancellation test for a persisted recommendation rule**

Render `ControlledFavoriteLedgerPanel` with the same persisted recommendation-origin rule and no active workspace. Toggle it off and assert `onSaveLedgerEnabled(id, false)` is called, while `deleteFavoriteLedgerDraft` is not called. Keep the existing pure temporary-draft deletion test unchanged.

- [x] **Step 3: Add a remote-folder acknowledgement regression test**

Evaluate `buildFavoriteLedgerStatusScript` twice: first with a persisted recommendation rule carrying the exact remote folder ID after backup, then with the same inventory. Assert only the original stable rule remains and no `custom-remote-*` duplicate is appended. Keep the existing same-name/different-ID test asserting both remote folders remain.

- [x] **Step 4: Run the new tests and verify GREEN**

Run:

```powershell
npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts
```

The final run passes the three regression assertions and the existing suites. The initial pre-fix RED run was not captured for every newly added assertion; this is recorded explicitly rather than inferred from the final GREEN run.

### Task 2: Include persisted recommendation rules in stable-ID projection

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 1: Define the upper-rule predicate from authoritative persistence**

Use the incoming account `ledgers` membership and stable ID as the persistence signal. Keep remote-only inventory drafts excluded from the upper projection, but do not exclude a persisted recommendation-origin rule solely because of `ruleOrigin` or `syncState`.

- [x] **Step 2: Resolve exact IDs before semantic fallback**

Make `createRecommendationProjection` map an exact candidate ID to the matching persisted ledger first. Only use existing semantic fallback for a non-consumed persisted rule; never use a display-name match to manufacture a mapping.

- [x] **Step 3: Separate temporary recommendation deletion from persisted cancellation**

In the no-workspace branch of `handleOrganizationRecommendationToggle`, delete only a pure temporary recommendation that is not present in the authoritative `ledgers` prop. For a persisted rule, call `onSaveLedgerEnabled` and refresh the organization projection. Preserve the current active-workspace queue and upper-card semantics.

- [x] **Step 4: Run renderer tests and verify GREEN**

Run the two renderer suites from Task 1. Expected: new stable-ID and no-workspace assertions pass, existing deletion, history, upper/lower linkage, and optimistic-toggle tests remain green.

### Task 3: Make remote inventory projection consume exact backup identity

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] **Step 1: Preserve exact IDs from backup-created bindings**

When a backup operation returns a created or bound `folderId`, keep that ID on the original stable rule through the subsequent projection. Do not classify a rule as remote-only merely because its transport state is `local-draft`.

- [x] **Step 2: Deduplicate only by exact folder ID**

Before appending a `custom-remote-*` draft, build the set of remote IDs already owned by any local rule, including persisted recommendation-origin rules and backup-created pending bindings. Skip only an exact ID already represented; retain same-title folders with different IDs as separate drafts.

- [x] **Step 3: Run API tests and verify GREEN**

Run:

```powershell
npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts
```

Expected: backup acknowledgement no longer duplicates a rule, while same-name different-ID and existing remote-draft recovery tests remain green.

### Task 4: Update the ledger and complete verification

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-03-favorite-rename-startup-refresh.md`
- Verify: `docs/项目功能项目书.md`, `docs/superpowers/plans/2026-09-03-recommendation-lifecycle.md`, `.codex-artifacts/`

- [x] **Step 1: Run all automated checks**

Run `npm test`, `npm run build`, `git diff --check`, and `git diff --stat`. No test process may remain running.

- [x] **Step 2: Record per-item evidence**

Update I008-I013 with exact code locations and automated test names. Mark them `已实施待验证`; explicitly retain real Electron verification as pending because this round changes user-visible toggles and projections.

- [x] **Step 3: Review scope and commit**

Confirm only the project book, this plan, the requirement ledger, the two renderer modules and their tests changed. Commit once with a message describing recommendation lifecycle and second-round linking.

## 执行记录（2026-09-03）

- 定向回归：`npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`，176 + 200 tests passed。
- 全量回归：`npm test`，245 test files、4254 tests passed。
- 构建：`npm run build`，Electron main/preload/renderer 均成功。
- 真实界面验收：开发版/预览版/安装版及真实 B 站账号流程仍待用户验收；本轮不运行安装包构建。
