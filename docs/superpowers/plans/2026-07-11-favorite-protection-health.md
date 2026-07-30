# Favorite Protection Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect stale protected favorite archives and let users explicitly reprocess only abnormal protected videos.

**Architecture:** Extend the shared protection partition with a health classifier based on stable ledger IDs and current membership. Carry the result on protected scan videos so the React panel can summarize health and select abnormal items without duplicating archive logic.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library

---

### Task 1: Shared health classification

**Files:**
- Modify: `src/shared/favoriteArchiveProtection.ts`
- Test: `src/shared/favoriteArchiveProtection.test.ts`

- [ ] Add failing tests for complete, partial, missing, deleted-ledger, and replaced-folder cases.
- [ ] Run `npm test -- src/shared/favoriteArchiveProtection.test.ts` and confirm the new assertions fail.
- [ ] Add the minimal health type and ledger-first membership classifier.
- [ ] Run the shared tests and confirm they pass.

### Task 2: Scan overview and abnormal reorganization

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] Add a failing UI test for separate health counts, warning copy, and abnormal-only selection.
- [ ] Run the focused panel test and confirm it fails for the missing UI.
- [ ] Render health metrics and add the explicit abnormal reorganization confirmation flow.
- [ ] Preserve the existing all-protected reorganization flow and source filtering.
- [ ] Run the focused panel tests and confirm they pass.

### Task 3: Verification and delivery

**Files:**
- Modify if needed: `README.md`
- Modify if needed: `CHANGELOG.md`

- [ ] Update user-facing documentation for archive health checks.
- [ ] Run focused tests, the full test suite, and `npm run build`.
- [ ] Review the final diff for unrelated changes and requirement coverage.
- [ ] Create one overall git commit for the completed requirement.
