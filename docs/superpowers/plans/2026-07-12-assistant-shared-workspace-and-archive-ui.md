# Assistant Shared Workspace And Archive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar and pet workspace share task state while keeping navigation independent, and apply the confirmed DeepSeek, archive-card, adjustment-record, and pet-bubble UI rules.

**Architecture:** Keep view-local navigation inside each renderer, but move durable task state and conflict acceptance behind the existing main-process runtime/IPC boundary. Keep archive UI changes inside `FavoriteLedgerPanel`, and centralize adjustment-record eligibility and labels so display and persistence use the same semantics.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library, CSS.

---

## Context Recovery Checkpoint — 2026-07-12 (latest)

This section is the authoritative handoff if the conversation is compacted. Do not restart the work or discard the current working tree.

### Completion update — 2026-07-13

- The side discussion was recovered from the local Codex task log. Final shortcut decision: keep `库`; remove `备` and `整` from configurable pet shortcuts. Legacy saved values are normalized away; the large-window ledger workflows remain available.
- Main-process rejection now prevents a stale renderer from continuing duplicate DeepSeek organization or archive execution side effects.
- Fresh `npm test`, `npm run build`, obsolete-copy search, and `git diff --check` all passed.
- The complete requirement batch was committed once as `af41793c` (`feat: 同步小咪工作区与归档调整体验`).

### Repository state and guardrails

- Workspace: `C:\Users\diqing\bilimi`.
- The user already said `开始`; the feature work in this plan is authorized.
- Preserve every current modification and untracked file. Never reset or check out the working tree to recover context.
- No commit has been created for this requirement batch yet.
- Per `AGENTS.md`, create exactly one overall commit only after the complete batch, including the shortcut change, passes verification.
- Do not package or release an installer in this task unless the three-form validation in `docs/release-checklist.md` is completed first.

### Final confirmed behavior

- Sidebar and pet large workspace have independent page navigation but share the same old-favorite/transcription task state and progress. They behave like two views operating one program.
- Pet workspace requests navigate only the floating workspace, never the sidebar.
- Main process owns the serializable old-favorite runtime snapshot. Revision-based first-accepted writes win; a stale conflicting view receives the current snapshot and refreshes.
- When DeepSeek is disabled, the action remains clickable and emits `请先到设置开启 DeepSeek 后再使用辅助整理。` in realtime feedback without starting a task or loading state.
- DeepSeek status stays one muted single line. Completion copy is `DeepSeek 整理完成：已应用 N 条，未应用 N 条`; full detail remains available in the tooltip.
- Archive cards show a compact `转移` selector; dropdown options keep normal folder names. The `来自…` text uses all remaining space up to the right arrow, ellipsizes, and exposes the full source through a tooltip.
- Settings use neutral `归档调整记录` wording. Record only successful per-card `转移` changes and successful DeepSeek changes that differ from the original suggestion. Do not record system batch/rejudge/new-folder migration, failures, no-ops, or external Bilibili-side changes.
- Legacy correction records are cleared once through `favoriteAdjustmentRecordsVersion: 1`.
- Pet chat bubble remains 270px wide and centered above the pet. The obsolete workspace-side avoidance behavior is removed.
- Large floating workspaces use smart left/right placement with about 2px between the protected pet zone and the window, plus about 2px at the screen edge. Small bubbles may remain above the pet. The outer large workspace width was changed from 460px to 420px earlier in the conversation; do not regress it.

### Implemented in the current working tree

- DeepSeek disabled-click feedback and stable one-line completion/status presentation.
- Archive card `转移` control, full folder options, flexible `来自…` area, ellipsis, and tooltip.
- `transfer` archive-plan source and centralized record eligibility limited to `transfer` and `deepseek`.
- Renderer and main-store preference versioning for one-time legacy adjustment-record cleanup.
- Neutral adjustment-record labels and localized method/location display.
- Removal of pet bubble workspace-side state and CSS selectors.
- New `electron/main/oldFavoriteRuntimeStore.ts` and tests implementing account binding, reset, revision conflict handling, and first-write-wins snapshots.
- Main-process IPC, preload API, renderer global types, and `oldFavoriteRuntimeSession.ts` wiring for serializable shared task state. `deepSeekArchiveRunId` intentionally remains renderer-local because it is a `Symbol` and cannot be structured-cloned.
- Main process no longer forwards `floating-assistant:open-workspace` to the main window; the sidebar disables pet workspace request consumption.

### Verification evidence already obtained

- `electron/main/oldFavoriteRuntimeStore.test.ts` passes.
- Focused `FavoriteLedgerPanel` tests for disabled DeepSeek, transfer controls, source tooltip, and completion status pass.
- Focused one-line status CSS test passes.
- Adjustment eligibility and legacy renderer migration tests pass.
- Corrected `FloatingAssistantApp` adjustment-record tests pass.
- The previous affected-suite run had 401 passing tests and 3 stale `FloatingAssistantApp` expectation failures; those three expectations were corrected and their focused rerun passed.
- `npm run build` passed after the main-runtime wiring.

### Still required before completion

1. Obtain the exact contents of the user’s separately discussed `快捷项` change (names, order, visibility, and click behavior). It is not recoverable from the current repository or available thread excerpt, so do not guess.
2. Implement that shortcut change with focused tests.
3. Run the full affected-suite command recorded below and `electron/main/store.test.ts`; update only genuinely stale fixtures/assertions for `favoriteAdjustmentRecordsVersion`.
4. Run full `npm test`, then a fresh `npm run build`.
5. Run `git diff --check`, inspect `git status`, `git diff --stat`, and the full diff, including shared-runtime IPC conflict/reset/account-change semantics.
6. Search for obsolete correction wording before completion:
   `rg -n "调整分类 |纠错参考记录|记录纠错参考|清空纠错记录|来源场景|原建议：|用户选择：" src electron`
7. Create one overall git commit only after every requirement, including the shortcut change, is complete and all verification is green.

Affected-suite command:

```powershell
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx src/renderer/src/features/assistant/AssistantSidebar.test.tsx src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx src/renderer/src/features/assistant/PetQuickActionsStyles.test.ts src/renderer/src/styles.test.ts src/renderer/src/features/state/assistantState.test.ts src/renderer/src/features/recommendation/correctionLearning.test.ts electron/main/oldFavoriteRuntimeStore.test.ts --reporter=dot
```

### Current modified/untracked scope

- Electron main/preload: `electron/main/index.ts`, `electron/main/store.ts`, new `electron/main/oldFavoriteRuntimeStore.ts` and its test, `electron/preload/index.ts`.
- Shared/runtime types: `src/shared/types.ts`, `src/renderer/src/global.d.ts`, `oldFavoriteRuntimeSession.ts`, `favoriteArchivePlanState.ts`.
- Assistant UI/tests: `FavoriteLedgerPanel`, `FloatingAssistantApp`, `AssistantSidebar`, `PalaceMaidPetApp`, and quick-action/style tests.
- Adjustment/state logic/tests: `correctionLearning`, `assistantState`.
- Styling/tests: `src/renderer/src/styles.css`, `src/renderer/src/styles.test.ts`.

---

## Earlier 2026-07-12 Working Checkpoint (superseded)

This section is retained only as implementation history. Use the latest context-recovery checkpoint above for current state and remaining work.

### Confirmed scope

- Sidebar and floating assistant keep independent active pages while sharing old-favorite and transcription task state.
- DeepSeek unavailable click reports `请先到设置开启 DeepSeek 后再使用辅助整理。` in realtime feedback without starting work.
- DeepSeek archive status uses one stable muted single line; full completion details remain available by hover/click tooltip.
- Every archive card shows a compact `转移` select; folder names remain normal menu options; `来自…` receives the remaining row width and keeps a full tooltip.
- Adjustment records keep only successful card transfers and successful DeepSeek changes that differ from the original suggestion. System batch/rejudge/folder-triggered migrations, failures, and no-ops are excluded.
- All legacy correction records are cleared once through `favoriteAdjustmentRecordsVersion: 1`.
- Settings copy is renamed to `归档调整记录` with localized method and location labels.
- Pet bubble remains 270px and centered above the pet; old workspace-side bubble selectors/state are removed.
- Bilibili-side external favorite changes are explicitly out of scope.
- User added an extra request: include the separately discussed “快捷项改动”. No concrete shortcut names/order/behavior have been provided yet, and no unrelated workspace diff exists. Do not guess; integrate after details arrive.

### Implemented and red/green verified

- `FavoriteLedgerPanel`: unavailable DeepSeek click feedback, compact `转移` trigger, full source tooltip, completion copy/title.
- `styles.css`: stable muted one-line DeepSeek status and 74px transfer column.
- Adjustment eligibility helper accepts only `transfer` and `deepseek`; archive select writes `transfer` source.
- Renderer preference hydration clears unversioned legacy records and preserves version-1 records.
- Settings labels and record fields use the new neutral language.
- Pet workspace-side React state and CSS selectors removed.
- Added `OldFavoriteRuntimeStore` with revision-based first-write-wins conflict handling; its unit tests pass.

### Current in-progress wiring

- `electron/main/index.ts` already owns `OldFavoriteRuntimeStore` and has synchronous get/set/bind/reset IPC handlers plus accepted-snapshot broadcast.
- Still wire preload methods, renderer global types, and `oldFavoriteRuntimeSession.ts` to the main store.
- Keep `deepSeekArchiveRunId` local because it is a `Symbol` and cannot cross structured-clone IPC; all serializable task state should use the main store.
- Remove main-window forwarding from `floating-assistant:open-workspace` and disable sidebar consumption of pet workspace navigation so only the floating view navigates.

### Required cleanup before verification

- Add `favoriteAdjustmentRecordsVersion: 1` to remaining test/default preference fixtures and main-store persistence tests.
- Update remaining `调整分类 …` test queries to `转移 …` (a bulk mechanical replacement was already applied in `FavoriteLedgerPanel.test.tsx`).
- Update old correction wording/aria assertions still present in tests.
- Fix the one focused FloatingAssistantApp test to use `getAllByText` for the two DeepSeek records (already patched; rerun).
- Run TypeScript build to find all missing required preference fields.
- Complete shortcut request only after user supplies exact details.

### Fresh passing commands so far

- `npx vitest run electron/main/oldFavoriteRuntimeStore.test.ts --reporter=verbose`
- Focused `FavoriteLedgerPanel` tests for unavailable DeepSeek, compact transfer, and result status.
- Focused `styles.test.ts` one-line DeepSeek status test.
- Focused correction eligibility and legacy renderer hydration tests.

### Final verification still required

- Focused affected suites.
- `npm test`
- `npm run build`
- `git diff --check`
- One overall git commit only.

---

### Task 1: DeepSeek archive feedback and stable status row

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/styles.test.ts`
- Modify: `src/renderer/src/styles.css`

- [ ] Add a failing test proving the unavailable DeepSeek button remains clickable, emits the existing enablement hint through stage feedback, and does not start organization.
- [ ] Add failing assertions proving idle, running, and completed status content use one stable single-line element with full text in `title`.
- [ ] Run the focused tests and confirm failures are caused by the disabled button and old result card.
- [ ] Implement the click guard, feedback emission, stable single-line status copy, and matching blue-gray styling.
- [ ] Re-run the focused tests until green.

### Task 2: Archive card transfer row

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/styles.test.ts`
- Modify: `src/renderer/src/styles.css`

- [ ] Add failing tests proving every card trigger is labelled `转移`, folder names remain in the menu, and source text exposes its complete value as a tooltip.
- [ ] Add failing CSS assertions for a fixed-width transfer control, flexible source text, single-line ellipsis, and reserved right-arrow space.
- [ ] Run focused tests and confirm the existing selected-folder trigger and constrained source pill fail them.
- [ ] Implement the shared card-row markup and CSS.
- [ ] Re-run focused tests until green.

### Task 3: Archive adjustment record semantics and legacy cleanup

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/recommendation/correctionLearning.test.ts`
- Modify: `src/renderer/src/features/recommendation/correctionLearning.ts`
- Modify: `src/renderer/src/features/state/assistantState.test.ts`
- Modify: `src/renderer/src/features/state/assistantState.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/store.ts`

- [ ] Add failing unit tests for the new record sources: successful card transfer and successful DeepSeek divergence are retained; classifier/system batch changes, folder-triggered migrations, failures, and no-ops are rejected.
- [ ] Add a failing hydration test proving legacy correction records are cleared once rather than reinterpreted.
- [ ] Add failing UI tests for `归档调整记录`, `调整方式`, `调整前`, `调整后`, and localized occurrence labels.
- [ ] Run focused tests and confirm the old correction schema and labels fail.
- [ ] Implement record construction helpers and replace direct correction-draft writes at the two approved entry points.
- [ ] Remove record creation from unapproved paths and clear legacy records during normalization/store hydration.
- [ ] Update settings labels, empty copy, deletion copy, and card fields.
- [ ] Re-run focused tests until green.

### Task 4: Shared task state with independent navigation

**Files:**
- Modify: `electron/main/index.test.ts` or the closest existing main-process IPC test
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/oldFavoriteRuntimeSession.ts`
- Add or modify focused runtime tests beside the shared runtime module.

- [ ] Add failing tests proving pet workspace requests target only the floating view and do not navigate the sidebar.
- [ ] Add failing tests proving old-favorite task snapshots are shared across renderer instances and stale conflicting commands are rejected/refreshed.
- [ ] Run focused tests and confirm current dual-window broadcasts and renderer-global runtime fail.
- [ ] Add main-process-owned task snapshot/command IPC with monotonically increasing revision or operation identity.
- [ ] Make both views subscribe to snapshots while retaining separate local active pages.
- [ ] Route pet navigation only to the floating assistant and remove duplicate sidebar task starts.
- [ ] Re-run focused tests until green.

### Task 5: Remove obsolete pet bubble side avoidance

**Files:**
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/PetQuickActionsStyles.test.ts`
- Modify: `src/renderer/src/styles.test.ts`
- Modify: `src/renderer/src/styles.css`

- [ ] Replace old failing expectations with tests requiring a 270px bubble centered above the pet regardless of workspace side.
- [ ] Run focused tests and confirm the side-specific selectors fail the new requirement.
- [ ] Remove side-specific bubble offsets and keep the centered chat/normal bubble rules.
- [ ] Re-run focused tests until green.

### Task 6: Verification and one repository commit

**Files:**
- Review all modified files.

- [ ] Run all focused test files touched above.
- [ ] Run `npm test` and require zero failures.
- [ ] Run `npm run build` and require exit code 0.
- [ ] Review `git diff --check`, `git diff --stat`, and the final diff for unintended changes.
- [ ] Create one git commit covering the complete requirement batch.
