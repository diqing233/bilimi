# Favorite Library, Data Portability, and Playback Reliability v1.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Parallel work is allowed only for the explicitly separated workstreams below. Use TDD, review every subagent result, and do not claim completion without full integration verification.

**Goal:** Deliver bilimi v1.1.0 with a dense blue-white porcelain three-column Favorite Library, safe folder and batch operations, account-scoped local-data migration/cleanup, and a lightweight Bilibili danmaku repaint after timeline seeking.

**Architecture:** Keep the existing favorite repository as the source of truth and extend it through small typed service boundaries. Split the Favorite Library UI into focused React components while preserving its current virtualized list and cursor-backed event history. Put disk inspection, migration, cleanup, remote folder deletion, and seek-listener injection in Electron main/preload services; the renderer only requests operations and renders progress/results.

**Tech Stack:** Electron 42, React 19, TypeScript 5.8, electron-store, Vitest, Testing Library, Electron IPC, filesystem archives with SHA-256 manifests.

---

## 0. Execution Rules and Safety Gates

- [ ] Read `AGENTS.md`, this entire plan, and `docs/release-checklist.md` before editing.
- [ ] Inspect `git status`, the current branch, recent commits, and every pre-existing modified/untracked file. Never revert or overwrite user-owned changes.
- [ ] Treat the existing changes in `electron/main/store.ts`, `electron/main/videoTranscriptionQueue.ts`, and `electron/main/videoTranscriptionQueue.test.ts` as potentially user-owned until their provenance is understood.
- [ ] Use subagents only on independent file sets. The integration owner alone edits shared boundaries such as `electron/main/index.ts`, `electron/preload/index.ts`, `src/renderer/src/global.d.ts`, and `src/shared/types.ts`.
- [ ] Keep the UI fast: no synchronous recursive directory walks in the renderer; no full event-log loads; no new render-time scans; no removal of list virtualization.
- [ ] Every remote Bilibili destructive operation must use preview -> explicit confirmation -> execute -> reconcile/result-unknown handling. Never silently retry an unknown result.
- [ ] Do not clear real user data during automated testing. All cleanup tests must use temporary directories and fake stores.
- [ ] Commit each completed workstream with a focused commit. Do not amend commits.
- [ ] Do not push until all automated checks and the required dev/preview/installed-app acceptance checks pass.

## 1. Locked Product Contract

### Favorite Library window

- [ ] Keep one window with three simultaneous regions: left folder navigation, middle video list, right video detail.
- [ ] Use the Xiaomi blue-white porcelain theme, compact top bar, subtle blue dividers, dense rows, and no oversized cards or typography.
- [ ] Top bar is one compact line: Xiaomi icon, `小咪收藏库`, Bilibili account name, `拉到最高/恢复高度`, `收起/展开`, `关闭`.
- [ ] Show the compact Bilibili operation warning only when failed or result-unknown operations exist; `去待处理` selects the pending scope.
- [ ] Remove the separate top toolbar. Put selection, search, filter, sort, and the batch-operation toggle inside the middle list header.
- [ ] Keep bottom pagination split by the same vertical boundaries as the three regions.
- [ ] Default page size is 50; allow 25/50/100; preserve page, filters, selection, scroll, active folder, active video, and detail expansion when appropriate.

### Left navigation groups

- [ ] Render three independently collapsible groups and remember collapse state per Bilibili UID:
  1. `收藏范围`: 全部视频, 待处理, 已保护, 未同步.
  2. `bilimi 工作夹`: bilimi managed logical folders plus `未匹配到合适分类`.
  3. `B站收藏夹`: Bilibili default favorite plus user-created Bilibili folders.
- [ ] Show the real video count for every row, including zero.
- [ ] Distinguish folders by stable ID, never by title; do not merge or create same-name folders based only on display text.
- [ ] Only bilimi managed work folders expose a hover/focus three-dot menu. The unmatched safety folder cannot be deleted.
- [ ] Three-dot menu contains only `编辑信息` and `删除`.
- [ ] `编辑信息` wakes/opens Zhangku and navigates directly to the matching folder editor; do not duplicate the editor in Favorite Library.
- [ ] `删除` opens one choice dialog: `只从收藏库删除` or `删除并同步到B站`. Local-only is the safe default.
- [ ] Remote deletion requires a second danger confirmation, current remote baseline, affected video count, unmatched fallback count, extra non-bilimi membership warning, and result-unknown reconciliation.

### Middle list and batch operations

- [ ] First row: `全选当前页（N）`, search, filter, sort, selected count, and `批量操作` expand/collapse.
- [ ] Only the select-current-page control includes an item count. Other button labels never append `(N)`.
- [ ] Expanded batch actions are grouped by risk:
  - Common: `复制至`, `移动至`, `刷新所选信息`, `加入转写队列`, `同步到B站`.
  - Dangerous: `从收藏库删除`, `取消B站收藏`.
- [ ] `复制至` keeps all existing local/remote source memberships and adds selected bilimi targets.
- [ ] `移动至` removes only the current bilimi work-folder membership and adds targets; it never clears unrelated memberships.
- [ ] `从收藏库删除` removes local library rows/desired placements only; it preserves Bilibili favorites, transcripts, archives, protection history, and audit events.
- [ ] `取消B站收藏` removes all Bilibili favorite memberships for selected videos while preserving local records, protection, transcripts, and archives.
- [ ] bilimi work folders and unmatched scope support all operations.
- [ ] Bilibili default/user-created source folders support only `复制至`.
- [ ] Mixed scopes (all/pending/protected/unsynced) must preview eligible and skipped items with reasons; never silently skip.
- [ ] Move `扫描当前仓库状态` to the left-bottom current-scope summary. It refreshes metadata and observed remote position without reorganizing or syncing.

### Right detail region

- [ ] Clicking a middle-row video updates the right region; do not navigate to a separate page.
- [ ] Right detail scrolls independently. `收起详情` expands the middle region; a visible affordance restores the same selected video.
- [ ] Show compact identity: title, `打开视频`, author, BV/AV ID, part identity where applicable, tags, and independent organization/protection/sync/transcription/archive status chips.
- [ ] Do not render the video description in the normal detail layout. Preserve description data for search, rules, and DeepSeek.
- [ ] Show source method and exact date/time, including daily review, old-favorite organization, DeepSeek adjustment, or manual movement.
- [ ] Show local desired position and last observed Bilibili position as separate values with a text explanation of differences.
- [ ] Detail actions: `复制至`, `移动至`, `同步到B站`, `采用B站位置`, `单独转写音频`, and enabled-only `查看档案详情`.
- [ ] `采用B站位置` is disabled while remote state is unscanned, scanning, failed, or result-unknown.
- [ ] Multi-part videos must resolve transcription/archive by account + aid + cid and never open an ambiguous archive.
- [ ] `查看完整处理记录` replaces only the right-region content with a compact timeline and `返回视频详情`; left and middle remain unchanged.
- [ ] Load 20 events initially and 20 per `加载更早记录`; discard rendered events when changing video. Keep underlying immutable events intact.
- [ ] Put `从收藏库删除` and `取消B站收藏` under a collapsed danger section with distinct explanations and confirmations.

### Local data and migration settings

- [ ] Add `本地数据与迁移` as the second-to-last settings section. `关闭设置` remains last; `B站连接方式` becomes third-to-last.
- [ ] Display actual total user-data path and provide `打开文件位置`.
- [ ] Calculate disk use asynchronously and display last-calculated time plus `重新计算`.
- [ ] Classify usage into account-scoped persistent data, device-shared settings, cache, temporary audio, and logs. Do not pretend data is physically per-account when it is only logically partitioned.
- [ ] Show accounts by UID, including signed-out accounts with retained local data. Nicknames are display-only.
- [ ] Allow export scope: current account, selected accounts, or all accounts; optionally include non-secret shared settings.
- [ ] Migration archive includes repository/library state, bilimi work-folder rules, old-favorite drafts/workspaces, protection records, pending states, audit events, transcripts, summaries, archives, memos/stars, learning records, and account-scoped preferences.
- [ ] Exclude Bilibili cookies/login sessions, DeepSeek API key, machine encryption keys, proxy/runtime state, browser cache, logs, temporary audio segments, process locks, execution tokens, and ephemeral task IDs.
- [ ] Archive format contains schema version, app version, generated time, selected UIDs, logical file/data-section manifest, byte counts, and SHA-256 checksum(s).
- [ ] Export writes to a temporary file and atomically renames on success. Import validates everything before mutation.
- [ ] Import preview groups by UID and offers `按UID合并并保留较新记录（推荐）` or `覆盖所选账号的本地数据`.
- [ ] Import creates an automatic rollback backup, stages changes in a temporary area/store snapshot, then commits atomically. Failure leaves current data unchanged.
- [ ] Reject migration archives from a newer unsupported schema/app version; do not partially import.
- [ ] Restore running organization work as resumable draft, running transcription as `等待重新开始`, and result-unknown remote operations as reconciliation-required records with no automatic retry.
- [ ] Provide cleanup levels: `清理缓存`, `清理当前账号临时数据`, `删除当前账号本地数据`, `清除全部用户数据`.
- [ ] Account deletion never affects another UID. Full clear removes all account and shared local data, stops active work, clears login/session data, then exits.
- [ ] Full clear confirmation explains that Bilibili server data is untouched, warns about losing result-unknown reconciliation records, offers export first, requires typing `全部清除`, and uses `清除并退出`.

### Danmaku seek repaint

- [ ] Add a minimal guest-page listener for Bilibili video `seeked` events.
- [ ] Debounce continuous seeking so only the settled location repaints once.
- [ ] Repaint only when a known danmaku layer exists; dispatch a resize and temporarily nudge the video/danmaku compositor targets.
- [ ] Do not restore the retired delayed timer sequence or MutationObserver, do not request danmaku data, do not toggle the user's danmaku switch, and do not alter playback state.
- [ ] Cleanly unregister on navigation, webview destruction, and reinjection; support normal and HTML-fullscreen playback.

## 2. File/Component Decomposition

The integration owner may adjust exact names after inspecting current conventions, but responsibilities must remain separated.

- [ ] Create `src/renderer/src/features/favorites/FavoriteLibraryHeader.tsx`: compact header and remote warning.
- [ ] Create `src/renderer/src/features/favorites/FavoriteLibraryNavigation.tsx`: grouped/collapsible navigation, counts, work-folder menu.
- [ ] Create `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`: current-page selection, search/filter/sort, progressive batch actions.
- [ ] Create `src/renderer/src/features/favorites/FavoriteLibraryDetail.tsx`: detail view, event-history subview, status/action sections.
- [ ] Create `src/renderer/src/features/favorites/FavoriteLibraryDialogs.tsx`: copy/move, batch preview, local delete, remote unfavorite, managed-folder delete dialogs.
- [ ] Keep `FavoriteLibraryApp.tsx` as orchestration/state owner; reduce JSX bulk without changing repository ownership.
- [ ] Extend `FavoriteLibraryApp.css` for the compact blue-white porcelain three-column grid, continuous dividers, independent scrolling, responsive manual detail collapse, and risk tiers.
- [ ] Create `src/shared/favoriteLibraryOperations.ts`: eligibility and preview models for batch and folder operations.
- [ ] Create `electron/main/favoriteRepositoryManagedFolderService.ts`: managed-folder local deletion and remote deletion preview/execute/reconcile.
- [ ] Create `src/shared/localDataMigration.ts`: portable migration schema, validation, versioning, merge semantics, and safe normalization.
- [ ] Create `electron/main/localDataService.ts`: async usage scan, account inventory, export/import staging, cleanup orchestration, and path opening.
- [ ] Create `electron/main/localDataService.test.ts` and `src/shared/localDataMigration.test.ts` with temporary-directory coverage.
- [ ] Create `src/renderer/src/features/assistant/LocalDataSettings.tsx` with account groups, progress, export/import preview, and destructive confirmations.
- [ ] Add focused danmaku injection helper under `src/renderer/src/features/browser/` rather than growing `BiliWebview.tsx` with a large script literal.

## 3. Parallel Workstream A: Favorite Library UI Shell

**Exclusive files:** Favorite Library renderer components/CSS/tests. Do not edit shared IPC/type files.

- [ ] Write failing UI tests for the compact single-line top bar, conditional warning, and max/restore/minimize labels.
- [ ] Write failing tests for three navigation groups, per-UID collapse persistence callback contract, zero counts, and stable-ID selection.
- [ ] Write failing tests proving only managed bilimi work folders expose the three-dot menu and unmatched cannot be deleted.
- [ ] Write failing tests for the middle toolbar, `全选当前页（N）`, partial selection, batch expansion, and labels without counts.
- [ ] Write failing tests for continuous three-column dividers and split footer regions through stable class/data contracts.
- [ ] Write failing tests that detail remains visible at supported desktop widths, can be manually collapsed/restored, and changing rows updates detail without losing list state.
- [ ] Extract the four focused components and make the tests pass while preserving `VirtualFavoriteLibraryList`.
- [ ] Remove the always-visible organization-record banner/area, retaining the underlying records and conditional operation warning.
- [ ] Implement 25/50/100 pagination controls with 50 default and stable UI state.
- [ ] Run focused tests and `npm run build`; commit `feat: redesign favorite library workspace`.

## 4. Parallel Workstream B: Batch and Managed-Folder Semantics

**Exclusive files:** shared operation models, favorite repository services/tests. Coordinate IPC integration with the integration owner.

- [ ] Define deterministic eligibility results containing eligible aids, skipped aids/reasons, source scope kind, and allowed actions.
- [ ] Add failing unit tests for bilimi work folder, unmatched, Bilibili default, Bilibili user folder, and mixed virtual scopes.
- [ ] Implement copy semantics as additive local desired placement.
- [ ] Implement move semantics as removing only current bilimi logical membership and adding selected targets.
- [ ] Add failing tests proving local library deletion preserves archives, transcripts, protection history, Bilibili observation, and audit history.
- [ ] Add batch remote-unfavorite preview tests with clear all-Bilibili-membership semantics and result-unknown behavior.
- [ ] Add managed-folder deletion previews containing local count, unmatched fallback count, remote binding, remote-only/extra membership diagnostics, and current revision.
- [ ] Implement local-only managed-folder deletion. Never allow deletion of the unmatched safety folder.
- [ ] Implement remote managed-folder deletion through preview/confirm/execute/reconcile tokens and stale-baseline rejection.
- [ ] Ensure every operation emits immutable account-scoped audit events suitable for the detail timeline.
- [ ] Run focused shared/main tests; commit `feat: add safe favorite library batch operations`.

## 5. Parallel Workstream C: Local Data Inventory, Migration, and Cleanup

**Exclusive files:** new migration schema/service/tests and settings component. Coordinate store snapshots and IPC with integration owner.

- [ ] Inventory every persistent source: electron-store fields, favorite repository directories, workspace/draft files, caches, temporary media, logs, cookies/session partitions, and any external tool outputs.
- [ ] Document the inventory inside service tests as explicit included/excluded sections so new persistent fields cannot silently disappear from migration.
- [ ] Define migration schema v1 with UID-keyed sections, shared-settings allowlist, manifest, sizes, timestamps, app/schema versions, and SHA-256 integrity.
- [ ] Write validation tests for malformed JSON, path traversal, duplicate UID sections, invalid UID, bad checksum, oversized manifest claims, newer schema, and secret-field injection.
- [ ] Implement deterministic export serialization and atomic output.
- [ ] Write merge tests for same UID/newer record, same UID/older record, new UID, deleted/tombstoned video, multiple archive versions, multi-part archive identity, and account settings.
- [ ] Write restore-state tests for running old-favorite work, running transcription, and result-unknown remote operations.
- [ ] Implement staged import preview, rollback snapshot, merge/overwrite, atomic commit, and rollback on injected failure.
- [ ] Implement asynchronous disk-usage scanning with cancellation/generation protection, symlink/reparse avoidance, unreadable-file tolerance, and categorized totals.
- [ ] Implement account inventory for logged-in and signed-out retained UIDs without using nickname as identity.
- [ ] Implement cleanup plans and previews for cache, current-account temp, current-account persistent data, and full data.
- [ ] Write tests proving cleanup scopes do not cross UID boundaries or delete excluded Bilibili server data representations.
- [ ] Implement active-work shutdown coordination before destructive cleanup and app exit after full clear.
- [ ] Build `LocalDataSettings` with second-to-last placement, progress feedback, last-calculated time, account expanders, export scope, import preview, and typed full-clear confirmation.
- [ ] Run focused service/component tests and build; commit `feat: add account-scoped data migration and cleanup`.

## 6. Parallel Workstream D: Seek-Settled Danmaku Repaint

**Exclusive files:** BiliWebview helper/component/tests only.

- [ ] Write a failing helper test proving injected code registers exactly one `seeked` listener per guest-page installation.
- [ ] Write a failing test for reinjection cleanup and navigation cleanup.
- [ ] Write a failing test that multiple seek events within the debounce window cause one repaint.
- [ ] Write a failing test that no danmaku layer means no compositor mutation.
- [ ] Write a failing test proving the script does not contain MutationObserver, the retired `0/250/800/1600/3200` timers, network requests, currentTime writes, play/pause calls, or danmaku-switch clicks.
- [ ] Implement the minimal helper and inject it on video-page readiness/navigation with stable cleanup markers.
- [ ] Repaint video and existing known danmaku containers/canvas/SVG/nodes once after settled seek; restore inline styles on the next animation frame.
- [ ] Verify normal and leave-fullscreen behavior without duplicate listeners.
- [ ] Run focused tests and build; commit `fix: repaint danmaku after settled seeking`.

## 7. Integration Owner: IPC, Types, UI Wiring, and Conflict Review

- [ ] Review every subagent commit for scope, semantics, missing tests, and overlapping edits before integration.
- [ ] Add narrow shared types for renderer/main contracts; do not expose arbitrary filesystem operations to the renderer.
- [ ] Register managed-folder and local-data IPC in focused registration functions; avoid further bloating `electron/main/index.ts`.
- [ ] Expose typed preload methods for usage calculation, path opening, account inventory, migration dialogs, import preview/apply, cleanup preview/apply, and managed-folder operations.
- [ ] Add matching declarations to `src/renderer/src/global.d.ts` and contract tests proving installed renderer methods exist.
- [ ] Wire navigation group persistence by UID into account preferences without resetting account defaults on every render.
- [ ] Wire `编辑信息` to the existing Zhangku wake/open/navigation behavior, including closed, minimized, and collapsed states.
- [ ] Wire all batch actions to previews and dialogs with busy/success/failure/result-unknown feedback.
- [ ] Ensure remote destructive actions are disabled during conflicting remote operations.
- [ ] Ensure selection is cleared or retained deliberately after each operation and cannot point to deleted rows.
- [ ] Ensure event history remains cursor-paged at 20 items and no large arrays are rendered eagerly.
- [ ] Add integration tests covering mixed-scope eligibility, folder deletion choice flow, right detail history switch, migration settings order, and full-clear confirmation.
- [ ] Resolve any pre-existing dirty-file overlap by preserving user work and adding only compatible changes.
- [ ] Run all focused tests and commit `feat: integrate favorite library and data controls`.

## 8. Version and Documentation

- [ ] Set package version to `1.1.0` in `package.json` and lockfile only after feature integration passes.
- [ ] Add/update release notes describing Favorite Library redesign, migration/cleanup, seek repaint, safety behavior, and credential exclusions.
- [ ] Update user documentation for copy vs move, local delete vs Bilibili unfavorite, managed-folder delete choices, migration merge/overwrite, and full clear.
- [ ] Update `docs/release-checklist.md` only if a genuinely reusable migration/cleanup acceptance path is missing; preserve existing requirements.
- [ ] Add a v1.1.0 verification record with automated command results and manual dev/preview/installer outcomes.
- [ ] Commit `chore: prepare v1.1.0 release`.

## 9. Automated Verification Gate

- [ ] Run the new focused tests for all four workstreams.
- [ ] Run `npm test` and record the exact pass/fail summary.
- [ ] Run `npm run build` and record success.
- [ ] Inspect bundle/runtime warnings; fix new warnings caused by this work.
- [ ] Verify no test touches the real `app.getPath('userData')` contents.
- [ ] Verify migration archives contain no cookie, API-key, encryption-key, proxy, or credential fields using explicit tests and a generated fixture inspection.
- [ ] Verify large-library UI tests retain virtualization and no full collection is copied into detail/event rendering.
- [ ] Verify `git diff --check` and review the complete diff for accidental unrelated changes or mojibake.

## 10. Required Three-Form Acceptance Gate

Follow `docs/release-checklist.md`; do not infer installer correctness from dev mode.

- [ ] Dev: run `npm run dev` and test cold start, Bilibili page/video, Favorite Library open/close/maximize, three groups, counts, search/filter/sort, pagination, detail collapse, batch previews, managed-folder menu, settings usage calculation, migration export/import preview, safe cleanup preview, and seeked danmaku behavior.
- [ ] Preview: run `npm run preview` after build and repeat the same critical paths.
- [ ] Installer: run `npm run dist:win`, install the generated NSIS package, and repeat the same critical paths in the installed app.
- [ ] Clean-environment installer test: first launch, first settings open, Bilibili login, empty Favorite Library state, migration import into a new local profile, restart persistence, and safe cleanup.
- [ ] Migration round trip: export selected UID(s), import into an isolated clean profile, compare counts/rules/drafts/protection/transcripts/archives, and confirm credentials are absent and login is required.
- [ ] Cleanup: use only an isolated test profile; verify account-only cleanup preserves other UIDs and full clear exits/restarts as a fresh user without modifying Bilibili server favorites.
- [ ] Remote destructive operation: use a non-critical test folder; verify preview, second confirmation, successful deletion, and result-unknown/reconciliation behavior where safely simulatable.
- [ ] Danmaku: compare seek behavior with system proxy enabled and disabled; distinguish network loading from compositor repaint and confirm no playback/switch side effects.
- [ ] Record any dev/preview/installer differences and block release for user-visible regressions.

## 11. Final Review, Main Integration, and GitHub Sync

- [ ] Request a dedicated code-review subagent after all workstreams are integrated. Findings come first and must be resolved or explicitly documented.
- [ ] Re-run `npm test`, `npm run build`, preview checks, and installer checks after review fixes.
- [ ] Confirm `git status` contains only intended tracked changes and explicitly approved pre-existing work.
- [ ] Confirm commit history is readable and every completed requirement has a commit; do not squash away useful safety boundaries unless the user asks.
- [ ] Fetch `origin`, inspect divergence, and integrate safely with the latest `origin/main` without destructive reset.
- [ ] If main advanced, rebase/merge only after reviewing conflicts and rerun the full automated gate plus affected manual checks.
- [ ] Update local `main` to the verified release commit, create a final release commit only if required, and push `main` to `origin` as explicitly authorized by the user.
- [ ] Verify the remote main SHA equals the local verified SHA.
- [ ] Report final version, commits, tests, dev/preview/installer evidence, migration exclusions, remaining known risks, and remote main SHA.

## 12. Definition of Done

This plan is complete only when every checkbox above is either completed or accompanied by a user-approved exception. A passing dev build alone is not completion. The task must not be marked done while installer verification, migration round-trip, destructive-operation safety, full test suite, code review, or GitHub main synchronization remains outstanding.
