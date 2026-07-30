# v1.0.2 Release Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate assistant snapshot startup races and preserve every scanned Bilibili favorite folder with explicit raw and actionable counts.

**Architecture:** Add an explicit renderer-to-main runtime readiness handshake and gate runtime requests on it. Separate raw source-folder scan metadata from the unique-video execution model, then derive UI summaries from raw membership plus protection state instead of primary-source attribution.

**Tech Stack:** Electron IPC, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Runtime readiness handshake

**Files:**
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/assistantRuntimeSignal.ts`
- Test: `electron/main/assistantRuntimeSignal.test.ts`

- [ ] Add a failing test proving a loaded renderer receives no request before runtime readiness.
- [ ] Run `npx vitest run electron/main/assistantRuntimeSignal.test.ts` and confirm the new assertion fails because the request is sent immediately.
- [ ] Extend the runtime target contract with readiness subscription/state and make request dispatch wait for readiness within the existing timeout.
- [ ] Emit `assistant-runtime:ready` only after preload installs the renderer request listener; clear main-process readiness on navigation/reload.
- [ ] Re-run the focused test and confirm it passes, including timeout/listener cleanup cases.

### Task 2: Complete source-folder summaries

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Modify: `src/shared/favoriteArchiveProtection.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Test: `src/shared/favoriteArchiveProtection.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [ ] Add failing tests for a folder whose videos all duplicate earlier folders: it remains present, reports its raw count, and has zero or membership-based actionable count without duplicating execution items.
- [ ] Run the three focused test files and confirm failures identify the missing raw summary behavior.
- [ ] Carry raw folder media counts and scan status through the API and preview scan context.
- [ ] Add a pure summary builder that counts actionable unique videos by full source membership while retaining every raw folder.
- [ ] Render `共 N｜本轮待整理 M`, preserve failed folders, and initialize selection from complete source memberships.
- [ ] Re-run focused tests and confirm all pass.

### Task 3: Regression verification

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/releases/v1.0.2-verification.md`
- Create: `docs/releases/v1.0.2-release-notes.md`

- [ ] Run `npm test` and confirm zero failures.
- [ ] Run `npm run build` and confirm main, preload, and renderer builds exit 0.
- [ ] Run and manually verify `npm run dev` and `npm run preview` against the agreed read-only paths.
- [ ] Run `npm run dist:win`, verify bundled media/model resources, install `dist/bilimi.Setup.1.0.2.exe /S`, and verify the installed app.
- [ ] Perform a clean user-data launch with the existing profile safely backed up and restored; record exclusions for external account mutations.
- [ ] Record commands, results, artifact size, SHA-256, warnings, and remaining manual risks in the verification and release-note documents.

### Task 4: Publish

**Files:**
- Modify: release metadata documents from Task 3 only.

- [ ] Review `git diff`, ensure `tmp/` remains untracked and excluded, and commit the complete requirement once with `git commit -m "release: publish bilimi v1.0.2"`.
- [ ] Push the local `main` history and `v1.0.2` tag to `origin` without force.
- [ ] Create GitHub Release `bilimi 1.0.2` and upload `dist/bilimi.Setup.1.0.2.exe`.
- [ ] Verify the remote tag target, release body, asset size, and SHA-256 digest; confirm the final worktree contains no unintended tracked changes.
