# Five Historical Regressions Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Restore the previously working backup-state projection, save/delete reconciliation, and non-blocking startup behavior while preserving the current global feedback and installer behavior.

**Architecture:** Keep `main` at `75f1204b` as the baseline; do not revert the commit chain. Trace each regression from its authoritative main-process state through IPC to the renderer projection, and restore only the missing transition or scheduling boundary. Use one failing regression test per behavior before changing production code, then verify the complete application path.

**Tech Stack:** Electron main process, React/TypeScript renderer, Vitest, Vite build, NSIS packaging.

---

### Task 1: Lock the specification and historical baseline

**Files:**
- Modify: `docs/项目功能项目书.md` (already updated with the 2026-09-02 regression constraint)
- Modify: `docs/requirement-ledgers/2026-09-02-five-regressions.md` (retain R001–R003 and index I001–I006)
- Read: `docs/contracts/favorites.md`, `docs/release-checklist.md`

- [x] **Step 1: Re-read the complete ledger and project-book sections**

  Confirm that I003 (backup projection), I004 (save persistence), I005 (unbound deletion refresh), and I006 (startup responsiveness) are historical regressions, not new behavior. Confirm I001/I002 remain protected.

- [x] **Step 2: Record the code baseline**

  Run:

  ```powershell
  git status --short --branch
  git log -5 --oneline --decorate
  git diff --check
  ```

  Expected: branch `main`, `HEAD` at `75f1204b`, no code diff, and only the current ledger/plan documentation untracked until the final topic commit.

### Task 2: Restore global feedback wording and expanded continuation (I001/I002)

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/deepSeekErrorMessage.ts` only if an uncovered IPC path is found
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/deepSeekErrorMessage.test.ts`
- Test: `src/renderer/src/features/assistant/feedbackContinuation.test.ts`
- Test: `src/renderer/src/styles.test.ts`

- [x] **Step 1: Write and run the failing tests**

  Add assertions for the two concrete regressions:

  ```ts
  it('maps old-workspace IPC failures to the existing Chinese feedback', () => {
    expect(formatAssistantFeedbackMessage("Error invoking remote method 'assistant:patch-preferences': Error: Old favorite workspace has not been started."))
      .toContain('旧收藏工作区尚未启动')
  })

  it('renders all continuation lines before the backend-task section', () => {
    render(<FloatingAssistantApp {...propsWithFeedback('第一行\n第二行\n完整第三行\n完整第四行')} />)
    expect(screen.getByText('完整第三行\n完整第四行')).toBeVisible()
    expect(screen.getByText('后台任务')).toBeVisible()
    expect(screen.getByText('完整第四行').compareDocumentPosition(screen.getByText('后台任务')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  ```

  Run the two focused suites and confirm they fail for the current implementation before touching production code:

  ```powershell
  npm test -- src/renderer/src/features/assistant/deepSeekErrorMessage.test.ts src/renderer/src/features/assistant/feedbackContinuation.test.ts src/renderer/src/styles.test.ts
  ```

- [x] **Step 2: Trace every renderer-visible error entry point**

  Search `setGlobalFeedback`, `onTransientFeedback`, IPC catch wrappers, and direct `Error.message` rendering. Ensure the existing formatter is applied at the last common renderer boundary without changing error codes, retry state, or task state.

- [x] **Step 3: Apply the smallest UI fix**

  Keep collapsed feedback unchanged. In expanded mode, render the complete continuation as inherited typography with no separator or ellipsis, then place a scroll container beginning at `后台任务`; do not add a “当前提示” heading or duplicate card.

- [x] **Step 4: Re-run focused tests**

  The focused suites must pass with no unrelated snapshot or DOM warnings.

### Task 3: Restore authoritative backup projection and unbound-delete reconciliation (I003/I005)

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `electron/main/index.ts` and/or the favorite deletion wiring module identified by the trace
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: relevant `electron/main/*favorite*test.ts`

- [x] **Step 1: Write and run failing projection tests**

  Cover both paths separately:

  ```ts
  it('shows the authoritative unbacked state after an unbound folder is deleted', async () => {
    const view = renderOverviewWithSnapshot(snapshotAfterUnboundDelete)
    expect(view.getByText('未备册')).toBeVisible()
    expect(view.queryByText('未绑定')).toBeNull()
  })

  it('keeps detail backup status visible while the organizing card projection is hidden', () => {
    const view = renderOverviewWithOrganizationGuide({ guideOpen: false, organizationActive: true })
    expect(view.getByText('未备册')).toBeVisible()
  })
  ```

  Add a main-process test asserting that successful deletion publishes a newer account revision containing the surviving default rule and its real backup state. Run the focused suites and confirm failure before code changes.

- [x] **Step 2: Trace deletion data flow**

  Follow the exact `folderId` from delete confirmation through remote result, local binding/draft cleanup, cache invalidation, account snapshot reload, and renderer broadcast. Identify any branch that clears the projection before the authoritative snapshot arrives or treats “unbound” as “unknown/removed”.

- [x] **Step 3: Restore the historical state transition**

  Use `1519bf4c`, `c0b637e2`, `3eccff28`, and `77536f5f` as read-only references. Restore idempotent cleanup for only the deleted `folderId`, then publish the refreshed account snapshot. Preserve the project-book visibility gate: card-level remote labels are hidden only while the guide is visibly open; details still show the authoritative state.

- [x] **Step 4: Verify focused suites and no remote side effects**

  Run the renderer and main favorite tests. Assert that deletion does not start classification, backup, synchronization, or remove unrelated rules.

### Task 4: Restore save snapshot and stable-rule projection (I004)

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: parent save callback file identified by the trace (likely `src/renderer/src/App.tsx`)
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/App.test.tsx` if the parent callback is involved

- [x] **Step 1: Write and run the failing save regression test**

  ```ts
  it('retains a saved recommendation in the account projection after save completes', async () => {
    const view = renderControlledPanel({ selectedRecommendation: recommendation })
    await user.click(view.getByRole('button', { name: '保存到收藏库' }))
    expect(await view.findByText(recommendation.displayName)).toBeVisible()
    expect(view.getByTestId(`ledger-${recommendation.ruleId}`)).toHaveAttribute('data-origin', 'saved-rule')
  })
  ```

  Run the focused test and confirm it fails before implementation changes.

- [x] **Step 2: Trace bridge-draft cleanup and parent snapshot acknowledgement**

  Inspect `saveLedgersAndRefreshWorkspace`, `promoteSelectedRecommendationLedgers`, `effectiveLedgersBeforeDismissal`, `durableLedgerIds`, and `retainedCandidateIds`. Verify the renderer does not clear a recommendation bridge until the parent returns a snapshot containing the promoted stable rule ID.

- [x] **Step 3: Restore the historical save ordering**

  Compare `2a582a8d`, `15cf6289`, and `5130e0d6`. Persist the local rule and selection first, reconcile the returned authoritative snapshot, then clear only acknowledged transient recommendation IDs. Do not change recommendation cancellation semantics, deletion mode, or B 站 behavior.

- [x] **Step 4: Re-run save, preview, and selection tests**

  Confirm the saved card remains visible, its checkbox remains accurate, and archive preview/sync preflight consume the same rule ID without a full-page blocking render.

### Task 5: Restore non-blocking startup scheduling (I006)

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/main/index.mainWindowPetStartup.test.ts`
- Modify only if required by the trace: `src/renderer/src/App.tsx`, `electron/preload/index.ts`

- [x] **Step 1: Write and run the failing scheduling test**

  Add a deterministic event-order test asserting `main-window-interactive` and the first B 站 load task occur before `pet-window-create`, and that a delayed pet/native patch cannot delay input handling:

  ```ts
  it('does not create the pet before the main window and B 站 gate yield to input', async () => {
    const events = await runStartupWithDeferredHomeLoad()
    expect(events.indexOf('main-window-interactive')).toBeLessThan(events.indexOf('bilibili-home-start'))
    expect(events.indexOf('bilibili-home-settled')).toBeLessThan(events.indexOf('pet-window-create'))
    expect(events).toContain('input-pump-serviced-before-pet')
  })
  ```

  Run the focused main-process suite and confirm failure before changing scheduling code.

- [x] **Step 2: Compare the known-good scheduler**

  Read the startup changes in `445ddaae`, `0ac841c7`, and `77536f5f`. Identify any synchronous preference read, WebView creation, external process, DWM/title-bar patch, mouse-recovery poll, or fixed timer that moved back ahead of the first input opportunity.

- [x] **Step 3: Restore separated cancellable gates**

  Keep the sequence from the project book: main window interactive → independent B 站 home load → home load settled (success/failure) → cancellable idle pet creation → renderer ready and `showInactive()` → later native/DWM patch. Every phase yields to the event loop; pet failure or slow network never blocks the main window.

- [x] **Step 4: Re-run scheduling tests and preserve installer controls**

  Run all main startup and installer tests. Confirm no changes to NSIS finish-page close/minimize behavior.

### Task 6: Full verification and ledger evidence

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-02-five-regressions.md` (record code locations, test evidence, and unresolved real-UI checks)

- [x] **Step 1: Run focused suites and then the complete test command**

  ```powershell
  npm test
  ```

  Expected: exit code 0 with all test files passing.

- [x] **Step 2: Build and static checks**

  ```powershell
  npm run build
  git diff --check
  git status --short
  ```

  Expected: build exit code 0, no whitespace errors, and only this topic's project-book, ledger, plan, code, and test files changed.

- [x] **Step 3: Record per-item evidence**

  Update I001–I006 individually with exact code paths and test results. Mark real Electron startup mouse movement, delete/save UI refresh, and install-package behavior as user acceptance unless they were actually observed in this session; do not claim those as automated proof.

### Task 7: Commit and package after verification

**Files:**
- Commit all files belonging to this topic, including the requirement ledger and plan.

- [x] **Step 1: Create one local topic commit**

  ```powershell
  git add docs/项目功能项目书.md docs/requirement-ledgers/2026-09-02-five-regressions.md docs/superpowers/plans/2026-09-02-five-regressions.md src/renderer electron
  git commit -m "fix: restore favorite regressions and nonblocking startup"
  ```

- [x] **Step 2: Verify the committed tree is clean**

  ```powershell
  git status --short --branch
  git show --stat --oneline HEAD
  ```

- [x] **Step 3: Build the Windows installer only after the clean commit**

  ```powershell
  npm run dist:win
  ```

  Then follow `docs/release-checklist.md` for development, preview, and installed forms. Package completion does not replace the user's real mouse and UI acceptance.
