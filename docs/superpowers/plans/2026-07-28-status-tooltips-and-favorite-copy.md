# Status Tooltips And Favorite Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore detailed status-light hover text, make favorite help content readable line by line, and rename the current user-facing old-favorite workflow to “整理收藏”.

**Architecture:** Keep existing status calculation and navigation unchanged, but expose each status item's existing `detail` as its tooltip. Convert dense favorite help strings into structured lines, and change only renderer-facing labels while preserving `oldFavorite` APIs, persisted identifiers, filenames, and historical documents.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library.

---

### Task 1: Restore Status Details

- [x] Add a failing regression test proving status lights use their live `detail` tooltip.
- [x] Restore the live `detail` tooltip without changing click navigation or accessible action labels.
- [x] Verify the focused status tests.

### Task 2: Split Favorite Help Into Lines

- [x] Add failing tests for four separate favorite-rule help lines and multi-line organization details.
- [x] Render each favorite-rule instruction as its own paragraph and keep organization details newline-delimited.
- [x] Verify the focused ledger tests.

### Task 3: Rename Current UI Copy

- [x] Add failing assertions for “整理收藏” entry, guide, dialog, progress, pet shortcut, and settings copy.
- [x] Replace current user-facing “整理旧藏/旧藏整理” copy while preserving internal identifiers and historical docs.
- [x] Run related renderer/shared tests, build, and diff checks.
