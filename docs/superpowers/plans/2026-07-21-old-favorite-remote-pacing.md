# Old Favorite Remote Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every old-favorite Bilibili request use the account-level remote arbiter, restore the former conservative tag/write pacing, and keep risk responses from triggering blind retries.

**Architecture:** Reuse the existing `FavoriteRepositoryRemoteOperationArbiter` as the sole account-level serialization boundary. The scan service enters that boundary for each page/tag request; the sync service continues to own its complete frozen plan, but derives its per-item delay from the old pacing profile. No renderer state, UI, application startup, or transcription code changes.

**Tech Stack:** Electron main process, TypeScript, Vitest.

---

### Task 1: Serialize scanner requests through the authoritative remote arbiter

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.test.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('serializes a tag read with the account remote operation arbiter', async () => {
  const remoteOperations = { run: vi.fn(async (_account: string, work: () => Promise<unknown>) => work()) }
  const service = new OldFavoriteWorkspaceScanService({ coordinator, requestRuntime, remoteOperations })
  await service.resumeTagEnrichment('100')
  await vi.waitFor(() => expect(remoteOperations.run).toHaveBeenCalledWith('100', expect.any(Function)))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts`

Expected: FAIL because `remoteOperations` is not accepted or called.

- [ ] **Step 3: Write the minimal implementation**

```ts
private request(accountMid: string, request: RuntimeRequest) {
  const work = () => this.options.requestRuntime(request)
  return this.options.remoteOperations?.run(accountMid, work) ?? work()
}
```

Use `request` for each Bilibili runtime request and pass the shared arbiter from `electron/main/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts`

Expected: PASS.

### Task 2: Restore conservative, interruptible tag pacing

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('waits a randomized 650–1000ms interval before every successful tag request', async () => {
  const wait = vi.fn().mockResolvedValue(undefined)
  const service = new OldFavoriteWorkspaceScanService({ coordinator, requestRuntime, wait, random: () => 0 })
  await service.resumeTagEnrichment('100')
  await vi.waitFor(() => expect(wait).toHaveBeenCalledWith(650))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts`

Expected: FAIL because no delay is scheduled before a successful tag request.

- [ ] **Step 3: Write the minimal implementation**

```ts
private waitForTagRequest() {
  const milliseconds = 650 + Math.floor((this.options.random?.() ?? Math.random()) * 350)
  return this.options.wait?.(milliseconds) ?? new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
```

Call it before each tag request; leave the existing three-attempt error retry behavior intact.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts`

Expected: PASS.

### Task 3: Restore old execution pacing instead of fixed 1.2-second writes

**Files:**
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/favoriteRepositorySyncService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('uses the legacy randomized cooldown after the twenty-fifth successful write', async () => {
  const sleep = vi.fn().mockResolvedValue(undefined)
  const service = new FavoriteRepositorySyncService({ repository, pageBridge, sleep, random: () => 0 })
  await service.executeFrozenPlan('100', planWithOperations(27))
  expect(sleep).toHaveBeenCalledWith(15_000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts`

Expected: FAIL because each write currently uses the same 1,200ms gap.

- [ ] **Step 3: Write the minimal implementation**

```ts
private async sleepAfterSuccessfulWrite(completedCount: number) {
  if (this.options.pacingMs !== undefined) return this.sleep(this.options.pacingMs)
  const accelerated = completedCount > 50
  const cooldown = completedCount % (accelerated ? 60 : 25) === 0
  const range = cooldown ? (accelerated ? [10_000, 20_000] : [15_000, 45_000]) : (accelerated ? [600, 1_400] : [1_200, 3_000])
  await this.sleep(range[0] + Math.floor((this.options.random?.() ?? Math.random()) * (range[1] - range[0] + 1)))
}
```

Call this only between successfully completed operations. Keep `pacingMs: 0` as the deterministic test override.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts`

Expected: PASS.

### Task 4: Verify and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-07-21-old-favorite-remote-pacing.md`

- [ ] **Step 1: Run focused regressions**

Run: `npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts electron/main/favoriteRepositorySyncService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS.

- [ ] **Step 2: Run build and whitespace checks**

Run: `npm run build; git diff --check`

Expected: both commands succeed.

- [ ] **Step 3: Commit the completed remediation**

```bash
git add electron/main/oldFavoriteWorkspaceScanService.ts electron/main/oldFavoriteWorkspaceScanService.test.ts electron/main/favoriteRepositorySyncService.ts electron/main/favoriteRepositorySyncService.test.ts electron/main/index.ts docs/superpowers/plans/2026-07-21-old-favorite-remote-pacing.md
git commit -m "fix: pace old favorite remote operations"
```
