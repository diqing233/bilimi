# Editable Context Menu Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every editable-input context menu supplied by bilimi use fixed Chinese labels while preserving native Electron editing behavior.

**Architecture:** Keep each Electron menu item's existing `role` and `enabled` value, then add only its explicit Chinese `label` in the reusable template helper. Since the main window and WebView guests already share this helper, one template change covers both without altering clipboard access or page context menus.

**Tech Stack:** Electron main process, TypeScript, Vitest.

---

### Task 1: Localize the editable context-menu template

**Files:**
- Modify: `electron/main/editableContextMenu.test.ts:33-44`
- Modify: `electron/main/editableContextMenu.ts:10-39`

- [x] **Step 1: Write the failing Chinese-label assertion**

```ts
expect(buildMenu).toHaveBeenCalledWith([
  { role: 'undo', label: '撤销', enabled: true },
  { role: 'redo', label: '重做', enabled: false },
  { type: 'separator' },
  { role: 'cut', label: '剪切', enabled: true },
  { role: 'copy', label: '复制', enabled: true },
  { role: 'paste', label: '粘贴', enabled: true },
  { type: 'separator' },
  { role: 'selectAll', label: '全选', enabled: true }
])
```

- [x] **Step 2: Run the focused test and verify it fails because labels are absent**

Run: `npm test -- electron/main/editableContextMenu.test.ts`

Expected: FAIL because the template entries do not yet have `label` properties.

- [x] **Step 3: Add only the six explicit Chinese labels**

```ts
{ role: 'undo', label: '撤销', enabled: Boolean(editFlags.canUndo) }
{ role: 'redo', label: '重做', enabled: Boolean(editFlags.canRedo) }
{ role: 'cut', label: '剪切', enabled: Boolean(editFlags.canCut) }
{ role: 'copy', label: '复制', enabled: Boolean(editFlags.canCopy) }
{ role: 'paste', label: '粘贴', enabled: Boolean(editFlags.canPaste) }
{ role: 'selectAll', label: '全选', enabled: Boolean(editFlags.canSelectAll) }
```

Keep the same role names, separators, edit-flag enablement, and event attachment logic.

- [x] **Step 4: Run focused tests**

Run: `npm test -- electron/main/editableContextMenu.test.ts electron/main/index.deepSeekIpcWiring.test.ts`

Expected: PASS; non-editable targets still create no custom menu and both app/WebView attachment points remain present.

### Task 2: Record evidence and commit the localized menu

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-15-editable-context-menu-language.md`
- Modify: `docs/superpowers/plans/2026-09-15-editable-context-menu-language.md`

- [x] **Step 1: Record R001/R002 code location and focused-test result**

Set I001 to `已实施，待真实界面验收`; record the helper line range, the exact focused test command and result, and that actual Electron right-click display requires a manually observable window.

- [x] **Step 2: Run final scope checks and commit**

Run: `git diff --check`, `git status --short`, and `git diff --stat`.

Expected: only the two documentation files and editable context-menu helper/test change. Run `npm test` and `npm run build`, then create one local `main` commit. Do not package, push, merge, or modify B站 data.
