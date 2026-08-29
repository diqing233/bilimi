# Formal Binding Projection Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent an in-memory recommendation bridge draft from making a formally bound favorite rule display `未备册`.

**Architecture:** `ControlledFavoriteLedgerPanel` keeps a temporary promoted recommendation list only while durable rule data catches up. Its merge must still use the current incoming rule when that rule contains a formal remote binding (`bindingState: 'bound'` plus a real folder ID); otherwise it preserves the existing bridge behavior. The change is a synchronous, pure array projection and does not issue IPC, reclassify a workspace, or perform B 站 work.

**Tech Stack:** React, TypeScript, Vitest.

---

### Task 1: Lock the authority boundary with unit tests

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:153-163` (export only, after RED is observed)

- [x] **Step 1: Add a failing formal-binding merge test**

Import `mergePromotedRecommendationLedgers` and add this test beside the existing projection helper tests:

```ts
it('prefers the current formally bound rule over a same-id promoted recommendation bridge', () => {
  const [ledger] = mergePromotedRecommendationLedgers([{
    id: 'custom-author-honker233', displayName: 'bilimi·honker233', keywords: ['honker233'],
    ruleType: 'author', enabled: true, priority: 10, ruleOrigin: 'recommendation-draft',
    bindingState: 'bound', bilibiliFolderId: '4048101554', bilibiliFolderIds: ['4048101554'], isDefault: false
  }], [{
    id: 'custom-author-honker233', displayName: 'bilimi·honker233', keywords: ['honker233'],
    ruleType: 'author', enabled: true, priority: 10, ruleOrigin: 'recommendation-draft',
    bindingState: 'unbacked', isDefault: false
  }])

  expect(ledger).toMatchObject({
    bindingState: 'bound', bilibiliFolderId: '4048101554', bilibiliFolderIds: ['4048101554']
  })
})
```

- [x] **Step 2: Run RED**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: the new assertion fails because the old merge returns the `unbacked` promoted draft (or fails because the helper is not exported); correct the import/export-only obstacle without changing merge behavior, then re-run until the assertion fails on `unbacked`.

- [x] **Step 3: Add the non-regression bridge test**

Add a second test proving an incoming unbound recommendation draft still yields to its promoted bridge:

```ts
it('keeps a promoted bridge when the current same-id recommendation draft has no formal binding', () => {
  const [ledger] = mergePromotedRecommendationLedgers([{
    id: 'candidate', displayName: 'bilimi·候选', keywords: ['旧规则'], enabled: true,
    priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false
  }], [{
    id: 'candidate', displayName: 'bilimi·候选', keywords: ['推荐规则'], enabled: true,
    priority: 10, ruleOrigin: 'recommendation-draft', bindingState: 'unbacked', isDefault: false
  }])

  expect(ledger.keywords).toEqual(['推荐规则'])
  expect(ledger.bindingState).toBe('unbacked')
})
```

### Task 2: Make only the formal binding win

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:153-163`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 1: Replace the merge with a formal-binding-aware pure projection**

Export the helper and use only current incoming ledgers whose binding is formally usable:

```ts
function hasFormalRemoteBinding(ledger: FavoriteLedger) {
  return ledger.bindingState === 'bound' && Boolean(
    ledger.bilibiliFolderId?.trim() || ledger.bilibiliFolderIds?.some((folderId) => folderId.trim())
  )
}

export function mergePromotedRecommendationLedgers(
  ledgers: readonly FavoriteLedger[],
  promotedLedgers: readonly FavoriteLedger[]
) {
  const formalLedgersById = new Map(ledgers
    .filter(hasFormalRemoteBinding)
    .map((ledger) => [ledger.id, ledger]))
  const promotedIds = new Set(promotedLedgers.map((ledger) => ledger.id))
  const retainedLedgers = ledgers.filter((ledger) => !(
    ledger.ruleOrigin === 'recommendation-draft' && promotedIds.has(ledger.id)
  ))
  const persistedIds = new Set(retainedLedgers.map((ledger) => ledger.id))
  return [
    ...retainedLedgers,
    ...promotedLedgers
      .map((ledger) => formalLedgersById.get(ledger.id) ?? ledger)
      .filter((ledger) => !persistedIds.has(ledger.id))
  ]
}
```

- [x] **Step 2: Run GREEN**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: the formal-binding test and the existing bridge-preservation test pass.

- [x] **Step 3: Run related renderer regressions**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

Expected: all selected suites pass; failures in recommendation cancellation, saved-rule linkage, right-side status, or preflight behavior block the commit.

### Task 3: Validate the user-visible projection and record evidence

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-30-honker233-backup-state-mismatch.md`
- Verify: `docs/项目功能项目书.md`, `docs/contracts/favorites.md`, `.codex-artifacts/`

- [x] **Step 1: Start the Electron development build without B 站 writes**

Run `npm run dev`, open the already-bound `bilimi·honker233` rule, and do not click backup, bind, delete, or sync. Record a screenshot in `.codex-artifacts/` showing the card/editor status is `已备册`; move the mouse, toggle no controls, scroll, resize, minimize, and restore to check the display path does not block interaction.

- [ ] **Step 2: Run final local checks**

Run: `git diff --check`, `npm run build`, `git diff --stat`, and `git status --short`.

Expected: no whitespace errors; build exits 0; only this task's source/test/docs files are selected for commit, while pre-existing `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain untouched.

- [ ] **Step 3: Update the ledger and commit the task**

Record actual code locations, test output, Electron screenshot path, and the fact that no B 站 action was executed. Stage only the plan, project book, contract, ledger, `ControlledFavoriteLedgerPanel.tsx`, and its test; commit with `fix: prefer formal favorite bindings in recommendation projections`.
