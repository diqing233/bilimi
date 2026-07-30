# Working Tree Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the accumulated development work in local Git checkpoints and leave future tasks with an explainable, low-noise working tree.

**Architecture:** Treat the current source, tests, configuration, and development documents as one integrated snapshot because their changes span shared Electron, renderer, and type contracts. Keep local screenshots and command outputs outside version control, then add repository rules that prevent those artifacts from polluting future status output.

**Tech Stack:** Git, Electron, React, TypeScript, Vitest, Python unittest.

---

### Task 1: Verify the integrated development snapshot

**Files:**
- Inspect: `electron/**`
- Inspect: `src/**`
- Inspect: `tools/**`
- Inspect: `package.json`
- Inspect: `package-lock.json`

- [x] **Step 1: Record staged, unstaged, and untracked paths**

Run: `git status --short`

Expected: all accumulated paths are visible without resetting, stashing, reverting, or cleaning.

- [x] **Step 2: Run the complete Vitest suite directly**

Run: `node_modules\.bin\vitest.cmd run`

Result: 205 test files and 2829 tests passed. The four failures are confined to `scripts/packaging-config.test.mjs`, which still expects the intentionally removed `package.json` scripts and installer build configuration. Existing React `act(...)` warnings remain.

- [x] **Step 3: Run Python helper tests**

Run: `python -m unittest discover -s tools -p "*_test.py"`

Result: 7 tests passed.

### Task 2: Save a local integration checkpoint

**Files:**
- Add: all non-artifact source, tests, configuration, and development documents currently in the working tree
- Exclude: root `.codex-*` screenshots, logs, JSON diagnostics, and command outputs

- [x] **Step 1: Stage non-artifact development work**

Run: `git add --all -- . ":(exclude).codex-*"`

Expected: source, tests, configuration, and documents are staged; local evidence files remain untracked or ignored.

- [x] **Step 2: Review the staged snapshot**

Run: `git diff --cached --check` and `git diff --cached --stat`

Expected: no whitespace errors; the stat matches the integrated development scope.

- [x] **Step 3: Commit the local checkpoint**

Run: `git commit -m "chore: checkpoint integrated development work"`

Result: local commit `657ac7e0` was created without pushing.

### Task 3: Isolate local verification artifacts

**Files:**
- Modify: `.gitignore`
- Move locally: root `.codex-*` files into `.codex-artifacts/`

- [x] **Step 1: Add the artifact directory to ignore rules**

Add `.codex-artifacts/` and a root `.codex-*` fallback pattern to `.gitignore`.

- [x] **Step 2: Move existing local evidence into the ignored directory**

Result: 125 root `.codex-*` files (about 23.4 MB) were validated and moved into `.codex-artifacts/` without deletion.

- [x] **Step 3: Commit the hygiene rule**

Run: `git add .gitignore && git commit -m "chore: isolate local verification artifacts"`

Expected: the ignore rule is committed locally and evidence remains available under `.codex-artifacts/`.

### Task 4: Verify the recovered working state

**Files:**
- Inspect: repository status and recent local commits

- [ ] **Step 1: Check the final worktree**

Run: `git status --short`

Expected: no unexplained source, test, document, or artifact paths remain.

- [ ] **Step 2: Check local checkpoint history**

Run: `git log -3 --oneline`

Expected: the integration checkpoint and hygiene commit are present locally; nothing is pushed.
