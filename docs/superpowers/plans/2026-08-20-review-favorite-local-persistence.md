# 批阅收藏本地登记一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a confirmed Bilibili favorite write the video, placement, protection record, and history event as one idempotent main-process-owned local transaction.

**Architecture:** Keep the generic repository IPC guard unchanged. Add a dedicated confirmed-review IPC that validates the current account and bound logical/physical targets in the main process, then uses the repository's atomic local-plan-plus-audit generation. Replace renderer-side protected-command loops with this endpoint and run a bounded legacy repair for records whose position explicitly proves a confirmed review but whose protection/event projection is missing.

**Tech Stack:** Electron IPC/preload, TypeScript, Vitest, React renderer tests, file-generation repository persistence.

---

### Task 1: Add failing repository/service regression tests

**Files:**
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `electron/main/favoriteRepositoryIpc.test.ts`

- [x] **Step 1: Write the failing service test**

Add a test that creates a repository with a bound `bilimi-logical:game` shard, invokes the future dedicated confirmed-review service method with one video, one remote folder, protection metadata, and one `entered` event, then asserts the returned snapshot contains the video, logical membership, aligned position, organization protection, and event after one durable revision. Add a second invocation with the same `operationId` and assert the revision, protection count, and event count do not increase.

- [x] **Step 2: Write the failing atomicity test**

Add a test that supplies a target remote folder ID not present in the bound shard snapshot and asserts the dedicated method rejects before any snapshot mutation. Assert the video, position, organization records, and events remain absent.

- [x] **Step 3: Write the failing IPC boundary test**

Add a test registering the favorite repository IPC and invoking the new dedicated channel with a valid confirmed-review payload. Assert it calls the dedicated service method and returns its result. Keep the existing generic-channel test and assert `record-organization-protections` is still rejected through `favorite-repository:commit-command`.

- [x] **Step 4: Run the focused tests and verify the expected red failure**

Run:

```powershell
npm test -- --run electron/main/favoriteRepositoryService.test.ts electron/main/favoriteRepositoryIpc.test.ts
```

Expected: FAIL because the dedicated service method/channel does not yet exist; no production code is changed before this red result is observed.

### Task 2: Implement the main-process atomic confirmed-review registration

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `src/shared/favoriteRepository.ts`

- [x] **Step 1: Define the validated input contract**

Add a shared/main-process input type containing `operationId`, `occurredAt`, optional complete video metadata, `aid`, final logical target IDs, actual Bilibili folder IDs, classification source, event kind/title/folder titles/detail, and the Bilibili-confirmed evidence marker. Normalize account, aid, IDs, timestamps, and reject duplicate or empty targets.

- [x] **Step 2: Add main-process target validation**

Before constructing a repository command, load the current snapshot and require every logical target to be a `bilimi-logical` folder with a bound physical shard whose `remoteFolderId` exactly matches the supplied Bilibili result. Require a complete video when no existing video is available. Do not trust renderer folder titles or names as identity.

- [x] **Step 3: Commit the local plan and audit event atomically**

Build an internal `commit-local-plan` command with a deterministic `${operationId}:local` ID, the video (when supplied), logical memberships, aligned position, organization protection, and review audit metadata; pass the deterministic event to the existing atomic audit generation. Make duplicate event IDs idempotent when the existing event payload is identical, while still rejecting conflicting reuse.

- [x] **Step 4: Add bounded legacy repair**

Add a main-process repair method that finds videos with position reason `批阅收藏经 B 站接口确认`, aligned state, and no organization record, then creates only the missing logical protection and deterministic entered event. Never invoke Bilibili, overwrite existing metadata, or repair positions without that explicit confirmation reason. Call it from the account-open path before returning the authoritative summary.

- [x] **Step 5: Run service tests and verify green**

Run the focused service tests from Task 1. Expected: atomic registration, duplicate idempotence, target rejection, and legacy repair all pass.

### Task 3: Expose the dedicated IPC and migrate both renderer review paths

**Files:**
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/App.tsx`

- [x] **Step 1: Add the trusted dedicated IPC handler**

Register `favorite-repository:commit-confirmed-review`, assert a trusted sender and current account, validate the payload shape, and delegate to the service method. Do not route it through `commandForAccount`; preserve the generic protected-command rejection.

- [x] **Step 2: Add the preload and window type**

Expose `commitConfirmedFavoriteReview(accountMid, input)` with the shared input/result type. Keep `commitFavoriteRepositoryCommand` available for other allowed commands.

- [x] **Step 3: Replace the regular `归库` protected-command loop**

Convert the existing `createConfirmedReviewFavoriteCommands` result into one dedicated input and call the new method once. Remove the renderer submission of `record-organization-protections` and `record-favorite-event`. Preserve the real Bilibili result and existing action feedback.

- [x] **Step 4: Replace the DeepSeek daily-review protected-command loop**

Submit the final position, protection, and daily-review event through the same dedicated endpoint. Keep result-unknown behavior for incomplete Bilibili evidence and do not mark it as synchronized.

- [x] **Step 5: Update renderer regression tests**

Change the existing App tests to mock/assert the dedicated method, assert it is called once per confirmed operation, and assert the generic protected command is never submitted. Add a rejection test that preserves the Bilibili-success feedback while the local operation can be retried.

- [x] **Step 6: Run renderer and IPC tests and verify green**

Run:

```powershell
npm test -- --run src/renderer/src/App.test.tsx electron/main/favoriteRepositoryIpc.test.ts
```

### Task 4: Persist and recover the confirmed-but-not-yet-registered boundary

**Why this is a separate task:** The atomic confirmed-review commit prevents a partial local generation once the main process begins its write. It does not by itself cover the earlier crash boundary: Bilibili has confirmed the favorite, but the renderer has not yet successfully delivered the dedicated local-registration request. The product-book requirement in §2.4 requires a main-process-owned, durable recovery record for that exact boundary.

**Files:**
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `electron/main/favoriteRepositoryIpc.test.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: Write failing journal recovery tests**

Add service-level tests for a durable, confirmed-review recovery record that contains only Bilibili-confirmed facts and the final local target. Simulate an application restart after the record is persisted but before the local four-record commit. Opening the account must finish the local commit, create exactly one event, and remove/complete the recovery record without any Bilibili call. Add the invalid-binding case: it must leave the record available for a later local-only retry and must not publish a false complete local projection. Add an IPC ordering test proving account open runs this recovery before the initial summary.

- [x] **Step 2: Observe the red test result**

Run only the new service/IPC tests. They must fail because the recovery journal and recovery call do not exist, rather than failing from fixture or type mistakes.

- [x] **Step 3: Implement the minimal main-process journal**

Create a private persisted journal keyed by account and `operationId`. The renderer may submit a Bilibili-confirmed operation to a narrow trusted checkpoint endpoint immediately after the Bilibili result and before asking for its completed local registration. Persist account, aid, Bilibili-confirmed folder IDs, final logical targets, video/event data, evidence marker and confirmation timestamp. Reject conflicting reuse of an operation ID. The completed atomic registration deletes or marks its journal item in the same durable write. The journal must never contain credentials or introduce a user-facing third sync state.

- [x] **Step 4: Recover only local data during account open**

Before the account-open summary, process a bounded number of pending confirmed-review entries by delegating to the existing validated local commit. Recovery must never call Bilibili. It must retain an entry when current account, logical binding or remote folder evidence no longer validates, so a later safe local retry remains possible. Afterwards run the legacy half-write repair.

- [x] **Step 5: Protect the renderer feedback contract**

After Bilibili success, checkpoint the confirmed result, then request local registration. Add a renderer regression test where registration rejects: the runtime action still reports the real Bilibili success; it does not submit a generic protection command and it does not expose the old `Frozen ...`/“待核对” language. Internal logs and the persisted journal provide retryability.

- [x] **Step 6: Run focused recovery and renderer tests**

```powershell
npm test -- --run electron/main/favoriteRepositoryService.test.ts electron/main/favoriteRepositoryIpc.test.ts src/renderer/src/App.test.tsx
```

### Task 5: Verify migration, build, and user-visible behavior

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-20-review-favorite-local-persistence.md`
- No unrelated files.

- [x] **Step 1: Run the full automated suite**

Run `npm test` and record the exact result. If any unrelated legacy test fails, stop and report it rather than weakening the new boundary.

- [x] **Step 2: Run typecheck/build and diff hygiene checks**

Run the repository's typecheck/build command, then `git diff --check`, `git diff --stat`, and `git status --short`.

- [ ] **Step 3: Perform real Electron acceptance**

In the development Electron app, use the affected review flow and verify: Bilibili favorite succeeds; no `Frozen ... reserved for the main process` error appears; the video is visible in 收藏库; its position is aligned; protection and entered history are visible; repeating the action does not duplicate history or execute Bilibili a second time; reopening the account repairs the known legacy half-record without remote side effects.

- [ ] **Step 4: Update the ledger evidence row-by-row**

Record exact code locations, tests, Electron evidence, and any condition that could not be verified. Do not mark an item complete without both automated and required interface evidence.

- [ ] **Step 5: Commit only this theme**

After all checks pass and the three pre-existing unrelated untracked ledgers remain untouched, commit the project-book update, current ledger, plan, and code together on local `main`.
