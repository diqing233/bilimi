# Favorite Library UI And Transcription Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete every UI, interaction, dialog, scrolling, detail-page, and transcription-queue change confirmed in the July 26 discussion without increasing complexity or regressing the already-stabilized Favorite Library.

**Architecture:** Reuse shared APIs and presentation primitives rather than creating parallel behaviors. Favorite Library menus use one Portal positioning pattern; destructive confirmations use one porcelain dialog action pattern; transcription management remains queue-owned while Favorite Library calls the same queue operations by video identity. Preserve virtualization and keep the current dirty branch intact.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library, CSS.

---

## Safety And Scope

- Preserve every existing unrelated working-tree change. Do not reset, checkout, bulk-rewrite, normalize encoding, package, publish, push, merge main, or sleep.
- Use small apply_patch edits and TDD. For every behavior change: add a failing test, verify the expected failure, make the minimum implementation, rerun.
- The previously authorized five corrections are already implemented and must remain green: 64px rows; Portal copy/move/more menus; red managed-folder delete items; top-button animation reusing drawerExpandMs.
- Do not alter Bilibili page scrollbars. Only Bilimi-owned surfaces.
- Do not add “同步/保护/整理” prefixes to every list state. The list remains two compact rows; the detail status chip section receives only a “状态” heading.
- Do not change the top batch action alignment in this plan. The user explicitly said to leave that row alone for now.

## Task 1: Lock The Completed Baseline

**Files**
- Test: src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryDrawer.test.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx

- [x] Run the current focused suites and record the exact count.
- [x] Confirm FavoriteLibraryApp does not pass itemHeight=72 and VirtualFavoriteLibraryList defaults to 64.
- [x] Confirm copy, move, and more menus render under document.body and not inside the toolbar.
- [x] Confirm copy/move/more chevrons rotate when aria-expanded=true and return on cancel, outside click, Escape, and menu switching.
- [x] Confirm managed-folder delete and delete-all menu items have danger classes and red text.
- [x] Confirm Drawer maximize uses drawerExpandMs, is idempotent at maximum height, blocks repeated clicks, and respects reduced motion.

## Task 2: Unified Floating Menu Behavior

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryNavigation.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Test: src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx

- [x] Add failing tests for copy/move menu Portal placement, max-height, internal scrolling, outside click, Escape, resize/scroll reposition, and exclusive opening.
- [x] Add failing tests that “更多批量操作” stays in its original DOM position and opens a compact floating menu below it.
- [x] Add failing tests for chevron rotation on all three triggers.
- [x] Add a failing test that the Bilimi work-folder group menu is a Portal floating menu centered horizontally within the Favorite Library drawer, not limited by the navigation width.
- [x] Keep single-folder menus positioned beside their own ellipsis buttons; convert them to the same Portal primitive only if needed for clipping.
- [x] Group menu entries: 新建工作夹, 同步全部工作夹, blue dashed separator, 删除全部工作夹 in red.
- [x] Ensure all menus remain within drawer viewport bounds and close/reposition on drawer movement, resize, scrolling, execution, outside click, and Escape.

## Task 3: Detail Header And Status Section

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryDetail.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryDetail.test.tsx

- [x] Add failing test for header action order: 打开视频, 刷新信息, 收起详情.
- [x] Make refresh update only current video metadata; it must not change placement or sync Bilibili.
- [x] Remove the duplicate conditional “刷新资料” action from the status section.
- [x] Add a compact h3-style “状态” title above the three chips.
- [x] Keep chip text compact: 已整理, 已保护, 未同步 (or their actual values), without per-chip prefixes.
- [x] Add a dashed blue divider around the status section consistent with other detail sections.

## Task 4: Simplify Detail Placement Operations

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx

- [x] Replace the ambiguous operation set with: 复制至, 移动至, 同步到B站, 采用B站归属.
- [x] Remove “调整收藏库归属” and its replace-all picker entry from the visible detail UI.
- [x] Reuse the same Portal destination picker and copy/move semantics as the batch toolbar, with a singleton aid selection.
- [x] Keep copy additive and move current-work-folder-only.
- [x] Keep “采用B站归属” disabled when remote placement is unavailable or unsafe.
- [x] Give every normal detail action a small porcelain border, consistent height, 6px radius, restrained hover, and visible focus state.
- [x] Move “移出所有收藏库归属” out of the normal placement section and into the destructive removal flow described in Task 6.

## Task 5: Detail Audio, Archive, And Processing Layout

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx

- [x] Audio/archive section first row: 加入转写队列, 笔记档案详情.
- [x] Rename 单独转写音频 to 加入转写队列.
- [x] Keep 笔记档案详情 visible; disable until an archive can be opened.
- [x] Place the buttons above transcription/archive status text.
- [x] Processing section places 查看完整处理记录 above the latest-record/empty text.
- [x] Give these normal buttons the same small bordered porcelain style as Task 4.
- [x] Preserve archive star/memo controls when an archive exists, but align them with the same visual system.

## Task 6: Destructive Video Removal Semantics

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Modify if needed: electron/main/favoriteRepositoryService.ts or the existing local placement IPC/service
- Modify: electron/preload/index.ts and src/renderer/src/global.d.ts only if an existing API cannot express the operation
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
- Test backend service/IPC files only if backend changes are needed

- [x] Rename the detail section title from 危险操作 to 其他操作.
- [x] Change its top separator to the common blue dashed divider; danger is conveyed only by red operation text.
- [x] When viewing a Bilimi work folder, “从收藏库删除” defaults to removing only the current Bilimi membership.
- [x] If the video belongs to other Bilimi work folders, show an unchecked checkbox: 同时从其他 bilimi 工作夹移除.
- [x] When checked, list the affected folder names and count.
- [x] When removal leaves no Bilimi work-folder membership, explicitly state that transcription, archive, protection, and history remain.
- [x] When scope is 全部收藏 or an ordinary Bilibili folder, use “从所有 bilimi 工作夹移除” with confirmation because there is no current Bilimi work folder.
- [x] Keep remote unfavorite completely separate.
- [x] Remove the standalone “移出所有收藏库归属” normal action after this flow covers it.
- [x] Cancellation must always be available before execution; disable repeated actions while running.

## Task 7: Unified Dialog And Confirmation System

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryDialogs.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx

- [x] Add a first-level 取消 action to the single managed-folder delete dialog.
- [x] Standard action order: 取消, 仅从收藏库删除, 删除并同步到B站.
- [x] Normal/cancel buttons use porcelain border; local/remote destructive buttons use red text, with remote delete allowed an extremely pale red background.
- [x] Apply the same sizing, radius, spacing, disabled, and busy states to batch local delete, batch unfavorite, delete-all-work-folders, and second remote confirmations.
- [x] Support Escape and backdrop click before execution; block closure after execution begins.
- [x] Add a real modal backdrop and prevent accidental interaction with underlying content.
- [x] Keep existing preview/version/impact diagnostics; do not add extra cards or verbose explanation.

## Task 8: Dividers And Section Hierarchy

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Modify: src/renderer/src/styles.css
- Modify only if semantic wrappers are missing: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx and src/renderer/src/features/assistant/LocalDataSettings.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryDetail.test.tsx
- Test: src/renderer/src/features/assistant/LocalDataSettings.test.tsx

- [x] Add a blue dashed divider below the current folder title/heading and above the center footer/pagination boundary.
- [x] Do not replace per-video row separators; those remain clear solid lines.
- [x] Use blue dashed separators between detail sections: 状态, 来源与时间, 收藏归属, 归属操作, 音频与档案, 处理记录, 其他操作.
- [x] Do not add an extra bottom divider after the last section.
- [x] Local data settings use the same blue dashed divider between 本地数据, 数据迁移, 管理数据.
- [x] Replace the current red line above the old danger section with the common blue dashed divider.
- [x] Use one shared semantic CSS token/value for dash color and spacing to prevent drift.

## Task 9: Bilimi Scrollbar System

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Modify: src/renderer/src/styles.css
- Test: src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx
- Test: src/renderer/src/styles.test.ts

- [x] Add a shared Bilimi-owned scrollbar style.
- [x] Favorite Library navigation, virtual list, and detail use a 10px blue-white porcelain scrollbar.
- [x] Floating menu internal scroll areas use an 8px version.
- [x] Track is very pale translucent blue; thumb is medium light blue with a 2px inset and pill radius; hover/active becomes slightly darker.
- [x] Firefox receives matching scrollbar-width and scrollbar-color.
- [x] Assistant settings/local data scrollbars use the same palette and shape; keep their layout-appropriate width if changing width risks content.
- [x] Do not target body, webview, browser content, or Bilibili page selectors.

## Task 10: Transcription Queue Bulk Management Backend

**Files**
- Modify: electron/main/videoTranscriptionQueue.ts
- Modify: electron/main/index.ts
- Modify: electron/preload/index.ts
- Modify: src/renderer/src/global.d.ts
- Modify: src/shared/types.ts only if new result types are needed
- Test: electron/main/videoTranscriptionQueue.test.ts
- Test: relevant IPC tests

- [x] Define queue-owned batch operations by task IDs: cancel waiting, stop running with explicit confirmation, retry/start eligible, remove records.
- [x] Preserve artifacts and archives when removing queue records.
- [x] Return structured counts: affected, canceled, stopped, retried/started, removed, skipped.
- [x] “Cancel waiting” must never stop a running task.
- [x] Running-task stop requires a separate confirmation token/step.
- [x] Completed tasks cannot be canceled; only records may be removed.
- [x] Emit exactly one authoritative queue snapshot update per completed batch mutation.
- [x] Keep existing single-item cancel/retry APIs working.

## Task 11: Transcription Queue Management UI

**Files**
- Modify: src/renderer/src/features/notes/VideoNotesPanel.tsx
- Modify: src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx
- Modify: src/renderer/src/features/assistant/FloatingAssistantApp.tsx
- Modify: src/renderer/src/styles.css
- Test: src/renderer/src/features/assistant/MemorialPanel.test.tsx as needed

- [x] Each queue item receives a leading checkbox.
- [x] Add a sticky secondary toolbar: 全选, 删除记录, 开始转写, 取消转写.
- [x] Selection is based on visible/filterable items; clear stale IDs when snapshot changes.
- [x] Disable operations with no selected eligible tasks.
- [x] Delete removes queue records only, not video, transcript artifacts, or archive.
- [x] Start retries/starts waiting, paused/restartable, or failed selected tasks and skips running/completed.
- [x] Cancel waiting tasks directly; if running tasks are included, open second confirmation before stopping them.
- [x] Show result feedback counts for affected and skipped items.
- [x] Keep individual primary action state-dependent; avoid multiple large buttons per row.
- [x] Queue body scrolls internally while the secondary toolbar stays visible.
- [x] Use small porcelain buttons; cancel/stop uses red text.

## Task 12: Favorite Library Queue Synchronization

**Files**
- Modify: electron/main/favoriteLibraryCommands.ts or add a narrowly scoped favorite-library queue command
- Modify: electron/main/index.ts
- Modify: electron/preload/index.ts
- Modify: src/renderer/src/global.d.ts
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx
- Test: main command/IPC tests
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx

- [x] Add a shared “cancel waiting transcription by selected video IDs” operation that resolves the same queue items used by the queue panel.
- [x] Favorite Library batch actions dynamically support 加入转写队列 and 取消等待转写.
- [x] Adding skips queued, running, and completed items; report added/skipped counts.
- [x] Cancel waiting only cancels pending items; running items are skipped and feedback directs the user to the transcription queue.
- [x] Favorite Library never force-stops running tasks.
- [x] Both surfaces subscribe to the same queue snapshot and refresh immediately after operations.
- [x] Row action/state reflects 加入队列, 等待转写, 正在转写, and 档案详情 consistently.
- [x] Preserve account scoping and do not affect another account’s tasks.

## Task 13: Density And Visual Regression

**Files**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx
- Test: src/renderer/src/features/favorites/FavoriteLibraryWorkspace.test.tsx

- [x] Keep current 64px row baseline while Tasks 3-12 are implemented.
- [x] After all content is stable, create a failing visual-contract test for 60px rows and verify two state rows plus two transcription buttons fit without clipping.
- [x] Only then reduce itemHeight and virtual-list math to 60px; do not go below 58px.
- [x] Keep toolbar first action row unchanged and left aligned as it currently is.
- [x] Verify title ellipsis/tooltips, checkbox alignment, row separators, and virtual scroll offsets remain correct.
- [x] If 60px clips at supported font scaling, retain 64px and report the evidence rather than forcing the reduction.

## Task 14: Full Verification And Runtime Acceptance

- [x] Run all modified renderer suites for Favorite Library, Drawer, Navigation, Local Data Settings, Motion Settings, Video Notes Queue, Assistant/Floating App.
- [x] Run all modified main/shared suites for transcription queue, Favorite Library commands/IPC, repository operations, and types/migrations.
- [x] Run npm run build.
- [x] Run git diff --check.
- [x] Inspect the diff for accidental encoding changes, empty files, unrelated rewrites, or lost user changes.
- [x] Terminate only the verified Bilimi development process tree and start one clean npm run dev instance.
- [ ] Runtime-check these states: compact list; copy/move/more floating menus and arrows; group menu center placement; detail header/status/operations/audio/history/other operations; all confirmations; local data dividers; all four Bilimi scrollbars; transcription queue selection and bulk operations; Favorite Library cancel-waiting synchronization.
- [ ] Do not claim visual completion until fresh screenshots confirm the running development build.
- [x] Do not package or release. If packaging is later requested, first run docs/release-checklist.md across dev, preview, and installer forms.
