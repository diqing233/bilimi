# Old Favorite Scan and Preview Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make old-favorite source counts trustworthy and keep tag enrichment from destroying the user's archive plan.

**Architecture:** Keep raw scan folders, unique actionable videos, managed bilimi targets, and the frozen archive plan as separate state. Use folder IDs for source identity, normalize progress at the boundary, and only rebuild the archive plan on an explicit refresh or a new entry into the preview step.

**Tech Stack:** React 19, TypeScript, Electron-injected Bilibili API scripts, Vitest, Testing Library.

---

### Task 1: Stable source identity and aligned source table

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] Extend the existing same-name RED test to assert two folder IDs remain independently selectable and each actionable count uses ID-only matching when IDs exist.
- [ ] Add RED tests asserting the explanatory copy is visible, user sources render separate total/actionable columns, and bilimi work folders are read-only with “已有” instead of “本轮待整理”.
- [ ] Run `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx` and confirm the new assertions fail for the current title-keyed inline list.
- [ ] Add a stable source key/ID to `OldFavoriteSourceFolderSummary`; convert selection, toggles, protected-video scoping, source filtering, and React keys to ID-first matching with title fallback only for legacy records without IDs.
- [ ] Render the approved user-source explanation and CSS-grid columns; render managed bilimi folders in a separate read-only grid.
- [ ] Re-run the focused test and confirm all source identity and layout assertions pass.

### Task 2: Bounded tag progress and frozen archive preview

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [ ] Add a RED test proving `2457 / 2337` is corrected to `2337 / 2337` by a newer legal snapshot from the same scan generation.
- [ ] Add RED interaction tests proving tag polling does not rebuild candidates while tags run or when they complete, and that leaving then re-entering preview (or pressing “刷新归档预览”) rebuilds once without losing selected candidates or producing zero tasks.
- [ ] Add a RED test proving DeepSeek shows a pending-tag warning with “继续等待” and “使用当前标签整理”.
- [ ] Run the two focused test files and verify failures reproduce progress rejection and destructive rebuild.
- [ ] Normalize progress so completed is clamped to total and an invalid previous value cannot win monotonic merging.
- [ ] Split progress polling from preview rebuilding; store the latest tag snapshot and an “updates available” flag, then rebuild only on explicit refresh or re-entry.
- [ ] Rebuild from stable scan context and persistent ledgers, migrate selected candidate keys and user-modified plan items, and keep execution bound to the visible snapshot.
- [ ] Gate DeepSeek start with the approved warning while allowing explicit current-tag execution.
- [ ] Re-run focused tests and confirm all pass.

### Task 3: Actionable scan failure diagnostics and retry

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] Add RED API tests for failure page numbers, second-scale backoff metadata, and retaining already-read pages when a later page exhausts retries.
- [ ] Add RED UI tests for readable failure reason, partial/failed state, and retrying failed sources without selecting them for execution.
- [ ] Run focused API and panel tests and confirm failures match missing diagnostics/retry behavior.
- [ ] Extend scan diagnostics with folder ID/page/status and return retained pages as partial data while keeping the folder excluded from execution.
- [ ] Implement bounded exponential retry and a failed-source retry action that refreshes only failed folders.
- [ ] Re-run focused tests and confirm all pass.

### Task 4: Integrated verification and release

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/releases/v1.0.2-release-notes.md`
- Create: `docs/releases/v1.0.2-verification.md`

- [ ] Run focused tests for runtime readiness, archive protection, favorite API, and favorite panel.
- [ ] Run `npm test` and require zero failures other than explicitly skipped tests.
- [ ] Run `npm run build` and require exit code 0.
- [ ] Complete every applicable item in `docs/release-checklist.md` for dev, preview, and a newly built Windows installer.
- [ ] Verify real scan output for duplicate-only folders, same-name folders, managed bilimi folders, bounded tag progress, failed sources, frozen preview, and the assistant snapshot beyond the former 60-second timeout window.
- [ ] Update release notes and verification evidence, review `git diff --check`, stage everything except `tmp/` and generated `dist/`, and create the single project-required commit.
- [ ] Push without force, create tag `v1.0.2`, publish the GitHub release with `dist/bilimi.Setup.1.0.2.exe`, and verify the remote tag, asset size, and SHA-256.
