# Tag Adoption and Confirm Execution Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for task-by-task implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a post-adoption tag result from invalidating a whole-run tag cutoff after confirmation has entered execution, and report the real tag cause rather than blaming a B station target folder.

**Architecture:** The coordinator remains the authority for tag versions, claims, execution intents, and persistence. Adoption first durably closes new claims, waits outside the mutation queue for an already-claimed tag read to settle, then publishes one complete cutoff and derived draft. Confirm execution validates that cutoff inside the queue before writing `running`; an invalid cutoff becomes a durable typed `blocked` intent before any local save or remote plan work begins.

**Tech Stack:** TypeScript, Electron main process, React renderer, Vitest, durable old-favorite workspace overlay journal.

**Workspace:** Execute on the user-authorized local `main` worktree; do not create a worktree, push, merge, invoke B station actions, or modify application data.

---

### Task 1: Document the State Boundary

**Files:**
- Modify: `docs/项目功能项目书.md:234-244,299`
- Modify: `docs/requirement-ledgers/2026-08-17-confirm-execution-missing-sync-plan.md`

- [x] **Step 1: Define the adopted-tag cutoff contract**

Add the required sequence: `adoption request -> persist pause/no-new-claims -> settle finite claimed reads -> rebuild complete-round classifications -> publish accepted cutoff once`.

- [x] **Step 2: Define the execution preflight contract**

Require the main-process queue to persist `executionIntent.status = "blocked"` and `executionIntent.failureCode = "tag-cutoff-changed"` before it writes `running`, saves locally, freezes a plan, or calls B station.

- [x] **Step 3: Record actual implementation and verification evidence**

After verification, append only actual code locations and command evidence to `R001`'s index row. Do not change the original requirement text.

### Task 2: Add Red Regression Tests

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:3180-3245,1632-1668`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx:220-275`

- [x] **Step 1: Test adoption waits for a claimed tag read**

Claim aid `2`, start `acceptCurrentTags()` without awaiting it, and prove it remains pending until the read records a result.

```ts
const accepting = coordinator.acceptCurrentTags('100')
await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
  tagEnrichment: { status: 'paused', wholeRunTagCutoffAccepted: false }
})
await coordinator.recordTagEnrichment('100', 2, ['Late result'], workspaceId)
await expect(accepting).resolves.toBeUndefined()
```

- [x] **Step 2: Test execution preflight before dispatch**

Create an invalid adopted cutoff with a late tag result, request a local whole-run execution, and require the coordinator to block before dispatching the local writer.

```ts
const save = vi.spyOn(coordinator, 'saveWholeRunToLocalLibrary')
await coordinator.setExecutionIntent('100', 'local')
await expect(coordinator.continueExecutionIntent('100')).rejects.toThrow(
  'whole-run tag enrichment is not complete'
)
expect(save).not.toHaveBeenCalled()
await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
  executionIntent: { status: 'blocked', failureCode: 'tag-cutoff-changed' }
})
```

- [x] **Step 3: Test the renderer wording**

Render a blocked intent with `failureCode: 'tag-cutoff-changed'` and assert exactly `自动执行已停止：标签结果已有新变化，请重新采用当前标签后再保存或同步。`; the rendered status must not contain `目标收藏夹`.

- [x] **Step 4: Run the red tests**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`.

Expected before production edits: adoption publishes `accepted` immediately and execution maps the tag error to the generic code.

### Task 3: Implement the Coordinator and Renderer Contract

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:169-187,1422-1478,4143-4170`
- Modify: `src/shared/oldFavoriteWorkspace.ts:531-548`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx:50-76`

- [x] **Step 1: Add a typed tag-cutoff failure code**

Extend the shared union with `tag-cutoff-changed`; map `whole-run tag enrichment is not complete` to that code in `executionIntentFailureCode()`.

- [x] **Step 2: Settle claimed reads before publishing adoption**

Persist `paused`, wait outside `this.queue` until the account's claim set is empty, then re-enter the queue to rebuild and publish the cutoff. The waiter must not hold the mutation queue, because `recordTagEnrichment()` needs that queue to release its claim and persist its result.

```ts
await this.queue(() => this.setTagEnrichmentStatus(accountMid, 'paused'))
await this.waitForClaimedTagEnrichmentToSettle(accountMid)
return this.queue(async () => {
  // read latest enrichment, rebuild, then persist accepted once
})
```

- [x] **Step 3: Block stale confirmation before `running`**

Inside the first `continueExecutionIntentUnsafe()` queue callback, call `assertWholeRunTagCutoffAccepted(workspace)` immediately before building `running`. On failure, persist a `blocked` intent using `executionIntentFailureCode(error)` and diagnostic detail, then rethrow after the callback returns. Do not call `saveWholeRunToLocalLibrary()` or `beginBilibiliExecution()` on this path.

- [x] **Step 4: Render the Chinese failure reason**

Add a `tag-cutoff-changed` branch to `blockedExecutionIntentMessage()` and leave all existing target-folder, binding, capacity, inventory, and DeepSeek branches unchanged.

- [x] **Step 5: Run the focused tests green**

Run the Task 2 command again. Expected: all selected tests pass, and the stale cutoff dispatches neither local save nor B station work.

### Task 4: Verify Protected Behavior and Audit Evidence

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-17-confirm-execution-missing-sync-plan.md`

- [x] **Step 1: Run neighboring regression suites**

Run `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceScanService.test.ts src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`.

- [x] **Step 2: Run repository verification**

Run `npm test`, `npm run build`, `git diff --check`, `git status --short`, and `git diff --stat`.

- [x] **Step 3: Audit R001**

Record the failure code, exact coordinator and renderer locations, targeted test evidence, full test/build result, and the deliberate absence of B station or user-data actions.

- [x] **Step 4: Create one local commit**

Stage only the project book, plan, R001 ledger, coordinator/shared/renderer changes, and their tests. Commit once on local `main`; do not push or merge.
