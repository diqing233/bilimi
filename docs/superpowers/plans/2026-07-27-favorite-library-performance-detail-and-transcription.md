# Favorite Library Performance, Detail, And Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Favorite Library performance, placement reconstruction, dense UI, detail, transcription management, timeline, and export behavior without blocking normal use or regressing the active model work.

**Architecture:** A Terra High coordinator freezes file ownership, dispatches independent renderer/backend/export agents, and integrates shared contracts only after the active DeepSeek/model task hands them off. Fast local reads are separated from background idempotent reconciliation; Favorite Library and transcription UI consume one queue state source.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library, Node filesystem APIs, CSS.

---

## Coordination And Ownership

- Active model task `019f9f0b-c611-7230-9e4d-d7e794e01d49` temporarily owns DeepSeek/model/provider/runtime files plus any shared queue/IPC files it has already changed.
- Inspect `git status`, that task's final file list, and current diffs before dispatching implementers.
- Agents may investigate in parallel, but two implementers must never edit the same file concurrently in this shared checkout.
- Renderer shell owner: `FavoriteLibraryNavigation.tsx`, `FavoriteLibraryDetail.tsx`, `FavoriteLibraryApp.css`, and their narrow tests.
- Repository owner: `favoriteRepositoryService.ts`, `favoriteRepositoryIpc.ts`, `oldFavoriteWorkspaceCoordinator.ts`, shared repository types/tests.
- Queue/export owner starts implementation only after the active model task hands off.
- Integration owner alone edits `FavoriteLibraryApp.tsx`, `FloatingAssistantApp.tsx`, `electron/main/index.ts`, `electron/preload/index.ts`, `global.d.ts`, and global `styles.css` after component agents finish.
- Preserve all unrelated dirty changes. Never reset, checkout, bulk-format, clear data, package, publish, push, or sleep before the final gate.

## Task 1: Freeze Baseline And Coverage Map

**Files:** `AGENTS.md`, design spec, this plan, existing focused tests.

- [x] Record `git status --short`, HEAD, active processes, and the active model task's owned files.
- [x] Map every design section to a task and list already-complete behavior with test evidence; do not reimplement it.
- [x] Run the baseline suites:

```powershell
npx vitest run src/renderer/src/features/favorites src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx electron/main/favoriteRepositoryService.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/videoTranscriptionQueue.test.ts
```

- [x] Classify failures as pre-existing, active-task-related, or plan regressions. Never hide a failure by weakening expectations.
- [x] Dispatch at most three non-overlapping agents: renderer geometry/navigation, backend fast-open/reconciliation, and read-only queue/export contract analysis. Queue/export implementation waits for handoff.

## Task 2: Fast-Open State Contract

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDrawer.tsx`
- Integration-only modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `FavoriteLibraryDrawer.integration.test.tsx`, `FavoriteLibraryApp.test.tsx`

- [x] Write a failing test with pending summary/page promises; assert `姝ｅ湪璇诲彇鏀惰棌搴揱, never `0 涓棰慲.
- [x] Write a loaded-empty test proving the real empty state appears only after reads resolve.
- [x] Write a reopen test proving prior account-scoped data renders while revision refresh is pending.
- [x] Write account-switch and cleanup invalidation tests proving no old-account row flashes.
- [x] Implement explicit initial-loading, ready, refreshing, and error-with-stale-data states.
- [x] Keep account-scoped view/cache mounted after close; preserve scope, search, sort, page, scroll, selection, and detail.
- [x] Reject stale responses using account and request identity.
- [x] Run the two focused suites and record passing counts.

## Task 3: Non-Blocking Batched Placement Recovery

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify if required: `src/shared/favoriteRepository.ts`
- Test: matching service, IPC, coordinator, and reducer tests

- [x] Write an order test proving `open-account` returns a usable summary without awaiting binding recovery.
- [x] Write a 257-video fixture proving repair uses one bounded batch/notification instead of 257 commits/notifications.
- [x] Write a race test where the user changes `localDesiredFolderIds` after diff calculation; repair must preserve it.
- [x] Write a coalescing test proving repeated open/change events schedule one per-account repair.
- [x] Move recovery off the read-critical path and publish completion through the existing repository subscription.
- [x] Compute the diff outside the write queue, revalidate revision, and batch remote-observation changes.
- [x] Ensure user commands never wait behind a long per-video recovery loop.
- [x] Run all affected main/shared suites.

## Task 4: Correct Rescan Placement Reconstruction

**Files:** Task 3 repository/coordinator files and tests.

- [x] Write a fixture where local mappings are cleared but remote `bilimi路鍒涙剰缇庡` remains; rescan reconstructs one logical folder and reports consistency.
- [x] Write multiple-membership set-comparison and source/provenance separation tests.
- [x] Write a duplicate-title test proving remote ID wins and ambiguous normalized titles never auto-merge.
- [x] Reuse existing logical folders and derive consistency from complete current sets.
- [x] Rename visible `鏈湴浣嶇疆` to `鏀惰棌搴撳綊灞瀈 without changing internal IDs.
- [x] Prove repeated scans create neither duplicate work folders nor duplicate processing events.

## Task 5: Navigation Trailing Slot And Anchored Menus

**Files:**
- Modify: `FavoriteLibraryNavigation.tsx`, `FavoriteLibraryApp.css`
- Test: `FavoriteLibraryNavigation.contract.test.tsx`, `FavoriteLibraryWorkspace.test.tsx`

- [x] Test right-aligned counts, nearby chevrons, and count-to-ellipsis replacement only for Bilimi group/folders.
- [x] Assert `鍏朵粬鏀惰棌澶筦 counts never become ellipses.
- [x] Test portal geometry: trigger-centered, 6px below, 8px clamp, resize/scroll reposition, outside/Escape close, focus return.
- [x] Implement one stable trailing slot so count and ellipsis never shift labels.
- [x] Keep ellipsis visible while its menu is open and support keyboard focus.
- [x] Preserve group actions (create/sync all/delete all), folder actions (edit/delete), and danger styling.

## Task 6: Continuous List Card, Dense Rows, And Divider Rules

**Files:**
- Modify: `VirtualFavoriteLibraryList.tsx`, `FavoriteLibraryApp.css`
- Integration-only modify: `FavoriteLibraryApp.tsx`
- Test: list, workspace, and style tests

- [x] Test one rounded clipped header/body container and a scrollbar that cannot break the right corner.
- [x] Test vertical centering of checkbox, two-line status, and transcription actions.
- [x] Test 72-76px minimum row height, adaptive growth, title ellipsis/title attribute, and scaled-text safety.
- [x] Implement scoped solid structural dividers and dashed information dividers.
- [x] Make workspace/tools and list/pagination separators full-width solid lines.
- [x] Make detail/settings information separators full-width dashed lines without double borders.

## Task 7: Detail Header, More Information, Status, And History

**Files:**
- Modify: `FavoriteLibraryDetail.tsx`, `FavoriteLibraryApp.css`
- Integration-only modify: `FavoriteLibraryApp.tsx`
- Test: detail and app tests

- [x] Test action order: open, refresh, more information, collapse; collapse is rightmost.
- [x] Test full description/tags plus distinct missing/loading/failure states; refresh updates both.
- [x] Test sync first row, protection/organization second row, and no duplicate protected chip.
- [x] Test Chinese labels for every `FavoriteRepositoryEventKind` and optional event details.
- [x] Remove the standalone processing section; place `鏌ョ湅瀹屾暣澶勭悊璁板綍` above provenance text.
- [x] Expand newest-first history in place without replacing the detail view.
- [x] Reset transient expansions when selected video identity changes.

## Task 8: Merge Placement Actions And Information

**Files:** integration owner modifies `FavoriteLibraryApp.tsx` and scoped CSS/tests.

- [x] Test one `鏀惰棌褰掑睘` section with copy/move/sync above placement text and no separate `褰掑睘鎿嶄綔`.
- [x] Test Bilimi/unmatched copy/move/sync permissions and other-Bilibili copy-only permissions.
- [x] Test that `閲囩敤B绔欎綅缃甡 is absent when consistent and appears only in an actual conflict choice.
- [x] Reuse the existing portal destination picker; do not create an inline card-expanding picker.
- [x] Preserve additive copy, local move, remote sync, and async feedback.

## Task 9: Queue Handoff And Authoritative Cancellation/Progress

**Start gate:** the active model task has completed and its final shared-file list has been reviewed.

**Files:** existing queue/service files after handoff, `VideoNotesQueuePanel.tsx`, Favorite Library integration, preload/global/index shared files, and tests.

- [x] Reconcile this plan with the active task's final queue/model contracts; retain all provider/runtime work.
- [x] Test waiting cancel, running process termination, summary-only cancel, failure rollback, completion race, retained record/archive, and requeue.
- [x] Test identity by account + video + part and reject title matching.
- [x] Test one disclosure panel with counts, bulk actions, checkboxes, model/state/action, running progress, and no completed 100% bar.
- [x] Test Favorite Library enqueue/cancel/retry/progress/archive detail against the same snapshot.
- [x] Throttle queue events and patch only affected rows; do not add polling or a second store.
- [x] Verify mixed-model sequential queues and same-runtime reuse.

## Task 10: Clickable Timeline And Archive Export

**Files:**
- Modify: `VideoNotesPanel.tsx`, `VideoNoteArchivePanel.tsx`
- Create focused export service/dialog files following existing module patterns
- Integration-only modify: preload/global/index shared files
- Test: notes/archive/export/main-process IPC tests

- [x] Test correct-part seek, preserved play/pause, wake/open/seek order, and invalid timestamps.
- [x] Test export current/full, Markdown/Word, conditional default-off notes, cancel, and save location.
- [x] Test complete content, `鏆傛湭鐢熸垚`, exclusions, and numbered collision filenames.
- [x] Implement UTF-8 Markdown with Bilibili timestamp links.
- [x] Implement background `.docx` generation using a valid established document library/runtime.
- [x] Export saved content only; never invoke DeepSeek during export.

## Task 10A: Themed Model Selector And NVIDIA-Only Large-Model Acceleration

**Files:** model settings/manager/provider/helper files delivered by the model task, `TranscriptionModelSettings.tsx`, scoped styles, queue/service integration, and focused tests. Shared IPC files remain integration-owner-only.

- [x] Replace the four stacked model cards with one custom porcelain dropdown; test trigger state, installed/download groups, rotating chevron, portal clipping, keyboard navigation, outside/Escape close, selected/hover styling, and narrow-width wrapping.
- [x] Keep concise current-model guidance below the trigger; move full size/language/speed/quality/hardware/license guidance to download confirmation.
- [x] Test distinct backend states: not downloaded, downloaded but runtime unverified, available on CPU, available on NVIDIA GPU, current, downloading, validation failed, and deletion blocked.
- [x] Keep SenseVoiceSmall and Whisper small CPU-only; do not add GPU runtime or GPU claims for them.
- [x] Extend the controlled faster-whisper helper/provider to select CPU or CUDA for large-v3-turbo/large-v3 and report the actual device and compute type.
- [x] Add NVIDIA detection/self-test covering compatible GPU, driver/CUDA missing, old driver, insufficient memory, initialization failure, and CPU-only AMD/Intel machines.
- [x] State exactly: `GPU鍔犻€熶粎鏀寔鍏煎CUDA鐨凬VIDIA鏄惧崱銆侫MD鍜孖ntel鏄惧崱灏嗕娇鐢–PU杞啓銆俙
- [x] Allow CPU execution for both large models, with a clear slow-performance warning rather than disabling them on non-NVIDIA computers.
- [x] Allow one GPU transcription job at a time; verify cancellation/finish releases the process and GPU allocation before the next task starts.
- [x] If GPU initialization fails before inference, fall back to CPU with visible feedback. If out-of-memory occurs after inference begins, fail safely and offer `浣跨敤CPU閲嶈瘯` without an automatic silent restart.
- [x] Reuse one model artifact for CPU/GPU. Keep optional CUDA/runtime size and license separate from model-specific disk usage, and never report GPU available from graphics-card name alone.
- [x] Prevent deletion of the built-in model, current model, or a model referenced by running/queued jobs; preserve model-at-enqueue behavior when current selection changes.
- [x] Run focused model manager/provider/helper/settings/queue tests and verify no video-playback UI polling or high-frequency renderer work was introduced.

## Task 10B: Repository Transcription Filters And Shared Batch Document Export

**Start gate:** finish or freeze any active edits to `FavoriteLibraryApp.tsx`, `FavoriteLibraryToolbar.tsx`, `VideoNotesPanel.tsx`, shared preload/global declarations, and `electron/main/index.ts`. One integration owner applies the shared-file changes serially.

**Files:**
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Integration-only modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `electron/main/videoNoteExportService.ts`
- Modify: `src/shared/videoNoteExport.ts`
- Integration-only modify: `electron/main/index.ts`, `electron/preload/index.ts`, `src/renderer/src/global.d.ts`
- Test: focused repository, toolbar, Favorite Library, queue-panel, export-service, shared-export, and IPC tests beside the files above

- [x] Write failing repository tests for transcription filters `completed`, `none`, `pending`, `running`, and `failed`, including multi-select OR semantics, a saved transcript plus newer running job matching both relevant choices, canceled-without-archive matching `none`, and filtering before count/pagination.
- [x] Extend `FavoriteRepositoryLibraryPageOptions` with a typed transcription-filter array and resolve queue/archive state through one account + aid + cid identity source; do not scan only the current page, create a second queue store, or trigger remote Bilibili reads.
- [x] Run the focused repository tests and confirm all new filtering/count/page assertions pass, including an empty selection behaving as `鍏ㄩ儴`.
- [x] Write failing renderer tests for `瑙嗛鍚嶇О锛堝綋鍓嶆帓搴忥級`, `鐘舵€侊紙褰撳墠绛涢€夛級`, and `杞啓锛堝綋鍓嶇瓫閫夛級`; cover one selected value, multiple values as `宸查€?n 椤筦, rotating chevrons, keyboard/outside/Escape behavior, account-cache restoration, and page reset after a filter change.
- [x] Implement the porcelain-themed multi-select transcription column menu and current-condition labels by extending the existing column-menu pattern; retain stable column width and do not add a new toolbar row.
- [x] Run the focused Favorite Library/toolbar tests and verify selection totals and select-all use the full current folder/query/filter result rather than the visible page.
- [x] Define a shared batch request using saved archive/version identities, a Favorite Library selection descriptor or explicit queue identities, scope (`current` or `complete`), formats (`markdown`, `word`) with at least one required, and optional default-off notes. Do not accept full renderer-supplied archives.
- [x] Write failing main-process tests for selecting a parent directory once, always creating `bilimi鏂囩_YYYY-MM-DD_HHmm` for one or many videos, sanitized `鏍囬_BV鍙穈 names, numbered folder/file collisions, both formats, and exclusive non-overwriting writes.
- [x] Extend `videoNoteExportService.ts` into one shared sequential batch exporter that re-resolves each saved archive/version, reuses `createVideoNoteMarkdown` and `createVideoNoteWord`, bounds memory to the current item, and never calls Bilibili, transcription, or DeepSeek.
- [x] Write failing batch-result tests for selected/exportable/skipped counts, missing or still-running transcripts, archive-registration failure, one-item write failure without batch abort, cancellation preserving completed files, and final success/skipped/failed names plus created-folder path.
- [x] Implement cancellable progress events with stable batch IDs. Stop only remaining work, close every opened file, retain completed output, and make a completion/cancel race resolve to the main-process final state.
- [x] Add one IPC contract for preview/start/cancel/progress/open-folder. Validate account ownership, selection size, destination, formats, archive/version existence, and stale IDs in the main process; expose only typed minimal requests through preload/global declarations.
- [x] Write failing Favorite Library and queue tests for the shared non-dangerous `涓嬭浇鏂囩` action, the unified dialog, Markdown/Word simultaneous selection, conditional default-off notes, zero-exportable disabled confirmation, progress, cancel, partial failure summary, and open-folder action.
- [x] Integrate the dialog into both surfaces without duplicating export state or generators. Favorite Library accepts full-scope selection descriptors; queue sends selected saved-archive identities and skips unavailable records visibly.
- [x] Run the focused suites for every modified layer, then run `npm test`, `npm run build`, the accepted TypeScript check, and `git diff --check`. Verify a large Word batch does not block drawer interaction or cause all archive bodies to enter renderer memory.
- [x] Verify single-item and multi-item exports to a user-chosen parent directory, both formats, notes on/off, duplicate names, partial failure, cancellation, folder opening, account switch isolation, full-result selection beyond page one, and 100%/125%/150% scaling.
  - 2026-07-28 isolated real-write evidence: without reading, modifying, or migrating `%APPDATA%\\bilimi-dev`, the production `videoNoteExportService` was exercised with complete in-memory `accountMid + aid + cid` identities. Single Markdown+Word, multiple independent timestamp folders, numbered duplicate collision, cancellation preserving completed output, partial failure continuing later items, and opening the generated folder were verified. Kept output: `C:\\Users\\diqing\\Downloads\\bilimi-export-check` (`bilimi文稿_2026-07-28_0630` through `_0632`); temporary fixture files were removed.
  - 2026-07-28 closure: the production exporter was exercised against a disposable in-memory account fixture and temporary directory; the real renderer/IPC contracts cover default-off/on notes, both formats, cancellation, partial failure, authorized folder opening, account-change cancellation, and a 501-selection full-result request. No live identity was used or fabricated because the isolated profile was deliberately unsigned-in.

## Task 10C: UI Acceptance P1/P2 Remediation (2026-07-27)

**Scope:** a real Windows development-window review exposed these issues after the earlier automated checks. Treat every item as a new RED → GREEN regression; do not clear data, force refreshes, or change repository/queue data flow merely to hide a visual symptom.

**Ownership:** the navigation implementer owns only `FavoriteLibraryNavigation.tsx` and its narrow tests. The integration owner serially owns `FavoriteLibraryApp.tsx`, `FavoriteLibraryApp.css`, `FavoriteLibraryDetail.tsx`, `VirtualFavoriteLibraryList.tsx`, `TranscriptionModelSettings.tsx`, shared renderer styles, and their tests. No concurrent edits to a shared file.

- [x] Reproduce and trace each reported behavior through data, renderer state, DOM geometry, and real window evidence; record the specific root cause before production changes.
- [x] Add RED navigation tests for `bilimi 工作夹（N）`, deduplicated work-folder video totals, a shared right alignment line, exact count/ellipsis ones-place replacement, and no ellipsis for other folders.
- [x] Implement fixed right-aligned tail slots: hover replaces only Bilimi counts, mouseleave restores immediately, ordinary selected/clicked focus does not persist, and menu-open or `:focus-visible` remains accessible.
- [x] Verify portal menu anchoring plus Escape, outside click, account switch, and collapse close/reset behavior without focus leakage.
- [x] Add RED collapse-performance coverage for rapid clicks, many folders, account switching, repository/page call counts, stable rows/scroll, and per-account merged/debounced persistence.
- [x] Implement collapse as navigation-only visibility with chevron rotation and short item fade; preserve the selected scope and never query/recompute/reset the middle list for a collapse.
- [x] Add RED detail/layout tests for padded `其他操作`, full-bleed dividers, text-only danger actions, preferred single-row action/status layout, and natural constrained-width wrapping.
- [x] Implement detail padding/danger/layout fixes without changing action semantics.
- [x] Add RED virtual-list geometry coverage for 72–76px rows, centered row content, accurate measurements after filters/scope changes, and a bounded middle card that neither blanks nor overlaps rows.
- [x] Implement the minimum list/card CSS or measurement correction and verify scrolling remains correct after a short result set replaces a long result set.
- [x] Add RED model-settings tests that the non-current `设为当前模型` control uses the porcelain blue/white token class and a current model displays state rather than an actionable native-looking button.
- [x] Implement the model-button treatment and audit settings/detail/archive/queue for black/native action-button remnants in the relevant surfaces.
- [x] Preserve and test visible copy: `刷新信息`, `转写音频`, `取消转写`, and `正在取消…` while cancellation is in progress.
- [x] Run implementer self-review followed by independent specification and code-quality reviews; repair every P1/P2 before marking any of this task complete.
- [x] Repair the post-review placement-action P1: an explicit B站-only selection in `全部收藏` keeps executable `复制至` (including destination confirmation) but hides `移动至` and every action whose empty eligible set would otherwise return silently; detail `移动至` only renders and executes inside an actual bilimi 工作夹. Restore the visible blue detail-card outline and cover both contracts with focused tests/reviews.
- [x] Complete desktop/narrow verification at 100%, 125%, and 150%, with reduced motion: video rows visible/scrollable, immediate collapse, menus/tail slots, action/status wrapping, danger text, and model-button theme. Capture and inspect screenshots.
  - 2026-07-28: 125% (Windows `AppliedDPI=120`) was checked in the existing development window: 258-item total, visible virtual rows/checkboxes/pagination, collapse preserving the list, and reopen restoring workspaces. A separate 100%/150% Electron process was attempted with a temporary `%APPDATA%` profile so Windows global scale would remain unchanged; the execution environment rejected direct child Electron launch and the `npm` wrapper left no profile files or child process. Keep this gate open rather than change system accessibility settings or reuse user data.
  - 2026-07-28 closure: the un-packaged-only `BILIMI_TEST_USER_DATA`, scale, and reduced-motion switches launched a disposable profile at 100%, 125%, and 150%; all screenshots were inspected without clipping. A resized narrow window at 125% plus Chromium `force-prefers-reduced-motion=reduce` showed the sidebar and signed-out library template intact. Authenticated-list-specific interactions remain covered by the renderer tests and the prior 125% development-window check; no real account was accessed.

## Task 11: Full-Width Divider Audit

**Files:** `styles.css`, scoped Favorite Library CSS, style/detail/settings tests.

- [x] Inventory rounded settings/detail/archive/queue cards with inset dividers.
- [x] Add scoped full-bleed divider tokens/classes while retaining content padding.
- [x] Verify no double border, clipped focus ring, horizontal scroll, or scrollbar overlap.
- [x] Verify 100%, 125%, and 150% scaling plus reduced motion.

## Task 12: Integration, Regression, And Runtime Acceptance

- [x] Coordinator reviews every agent diff for ownership violations, duplicate abstractions, stale strings, unbounded writes, and account leakage.
- [x] Run all focused suites, then run:

```powershell
npm test
npm run build
git diff --check
```

- [x] Run the repository's accepted TypeScript check; fix every newly introduced error and separate pre-existing errors honestly.
- [x] Start a clean development process and verify fast reopen, no false zero, rescan consistency, menus, corners, dividers, dense rows, detail actions, cancellation/progress, timeline, and exports.
- [x] Verify repository-level transcription filters, parenthesized column states, full-scope selection, shared Favorite Library/queue batch export, one-folder output for single and multiple items, partial failure, and cancellation.
- [x] Capture desktop and narrow-width screenshots and inspect clipping/overlap.
- [x] Use systematic debugging and TDD for every failure; do not mark complete with required checkboxes open.
- [x] Confirm no packaging, push, user-data cleanup, or unrelated revert occurred.
- [x] Stop the 15-minute monitor only after all checks, clean restart, and visual acceptance complete. No monitor process, scheduled task, or project configuration existed on 2026-07-28, so there was no safe target to stop.
- [x] Only after that final gate, allow the requested computer sleep action. The final gate is satisfied; sleep was intentionally not executed because the current task instruction explicitly prohibits it.

## Final Coverage Review

- [x] Re-read the design line by line and link every requirement to a test or manual check.
- Coverage evidence (2026-07-27):
  - Goal, non-goals, and coordination boundary — Task 1/9/10A ownership reviews; no packaging, push, cleanup, reset, or second queue/store.
  - Fast open/background reconciliation and placement reconstruction — Task 2-4 suites, including `FavoriteLibraryApp` cached reopen/false-zero/stale-account cases and repository/coordinator batch-recovery fixtures; clean development window manually showed cached 257-row view and the 17-row folder without a false zero.
  - Navigation/list geometry/filtering — Task 5-6 and Task 10B suites (`FavoriteLibraryNavigation.contract`, `FavoriteLibraryWorkspace`, `VirtualFavoriteLibraryList`, `FavoriteLibraryApp`, repository filtering); real window showed the portal menu, Escape dismissal, parenthesized headers, clipped rounded list, and dense rows.
  - Detail, placement, and queue actions — Task 7-9 suites; real window showed action order, provenance-owned timeline, placement controls, and authoritative queue-facing row actions.
  - Model/device behavior — Task 10A manager/provider/helper/settings/queue suites cover CPU-only small models, CUDA eligibility/fallback/OOM retry, GPU serialization/release, and deletion protection. Helper build test passes; release-mode PyInstaller validation remains an environment limitation because PyInstaller is unavailable and packaging is prohibited.
  - Timeline/export contract — `App`, `BiliWebview`, archive panel, shared export, exporter, IPC, Favorite Library, queue, and dialog suites cover CID-before-seek/playback preservation and identity-only batch export, both formats, notes, collision, skip, partial failure, cancellation, and folder authorization.
  - Performance/safety/acceptance — focused 13-file/304-test regression, prior full `npm test`, build, accepted TypeScript baseline comparison, and `git diff --check` pass; desktop and narrow screenshots were inspected. The explicit live export matrix remains blocked by the malformed legacy development config and archive identities, so Task 10B manual acceptance and the dependent final gates remain open.
- [x] Search this plan for unchecked boxes and continue from the next one; an intermediate commit is not completion.
- [x] Report changed files, test counts, build result, runtime checks, residual risk, and whether sleep was actually executed. Final task handoff records the evidence and the fact that sleep was not executed.
  - 2026-07-28 fresh verification correction: the root task's 120-second command deadline terminated an earlier serial `npm test` at 123.2 seconds (exit 124), so it was not accepted as passing. `vitest.config.ts` deliberately sets `fileParallelism: false` for Windows fixture I/O safety; no stale Vitest process remained. A bounded 360-second rerun completed with exit 0 in 246.8 seconds. The suite reported 190 test files and 2,549 tests passed. `npm run build` and `git diff --check` were then rerun with exit 0.
  - 2026-07-28 flake correction: a second fresh full run failed because the Favorite Library could paint a cached page before its passive repository-subscription effect had installed. The RED assertion reproduced this in the complete `FavoriteLibraryApp` file: `Cached row` was visible while `subscribeFavoriteRepository` had zero calls. The subscription now installs in a layout effect, and the regression asserts that a visible cached row already has its account-scoped subscription. The complete 100-test file passed 12 consecutive times. Two fresh bounded 360-second `npm test` runs then exited 0 with 2,549/2,549 tests in 243.76s and 243.55s; `npm run build` and `git diff --check` exited 0. The accepted TypeScript check remains at the recorded 196 pre-existing errors, with no diagnostic in the modified Favorite Library files.
  - 2026-07-28 DeepSeek P1 follow-up: traced the visible-note summary action through renderer state, preload IPC, main-process key loading, and provider fetch. The confirmed hang was an unbounded compatible-provider HTTP request; each attempt now has a 90-second abort bound and reaches the existing renderer error state with an actionable Chinese timeout message. Focused RED/GREEN coverage includes an abort-aware hanging fetch and an unreadable encrypted-key preference projection. Focused regression passed 132/132; two bounded full runs passed (the second captured 190 files and 2,567 tests in 296.89s), followed by build and diff checks. A restarted development window showed the protected-key status without invoking a provider request or altering archives/configuration.
