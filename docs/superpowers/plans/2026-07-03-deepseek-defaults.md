# DeepSeek Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the fresh-install pet hover shortcut order and make enabling DeepSeek turn on its three feature toggles once.

**Architecture:** Keep defaults in the shared shortcut module, preference normalization in assistant state, and settings click behavior in the floating assistant UI. The change is intentionally local and preserves existing persisted-user controls.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

---

### Task 1: Shortcut Defaults

**Files:**
- Modify: `src/shared/petHoverShortcuts.test.ts`
- Modify: `src/shared/petHoverShortcuts.ts`

- [ ] **Step 1: Write the failing test**

Change the default expectation in `src/shared/petHoverShortcuts.test.ts`:

```ts
expect(DEFAULT_PET_HOVER_SHORTCUTS).toEqual(['like', 'coin', 'comment', 'transcribe'])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/petHoverShortcuts.test.ts`

Expected: FAIL because the current default includes `assistant`.

- [ ] **Step 3: Write minimal implementation**

Change `DEFAULT_PET_HOVER_SHORTCUTS` in `src/shared/petHoverShortcuts.ts`:

```ts
export const DEFAULT_PET_HOVER_SHORTCUTS: PetHoverShortcutId[] = [
  'like',
  'coin',
  'comment',
  'transcribe'
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/petHoverShortcuts.test.ts`

Expected: PASS.

### Task 2: DeepSeek Preference Normalization

**Files:**
- Modify: `src/renderer/src/features/state/assistantState.test.ts`
- Modify: `src/renderer/src/features/state/assistantState.ts`

- [ ] **Step 1: Write the failing test**

Extend the legacy DeepSeek inheritance test in `assistantState.test.ts` so `createInitialAssistantPreferences({ deepseekEnabled: true })` expects:

```ts
deepseekAutoSummaryEnabled: true
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/features/state/assistantState.test.ts`

Expected: FAIL because automatic summary currently defaults to false.

- [ ] **Step 3: Write minimal implementation**

Use `normalizeDeepSeekFeatureToggle` for `deepseekAutoSummaryEnabled` in `assistantState.ts`:

```ts
deepseekAutoSummaryEnabled: normalizeDeepSeekFeatureToggle(
  persisted?.deepseekAutoSummaryEnabled,
  persisted?.deepseekEnabled
),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/features/state/assistantState.test.ts`

Expected: PASS.

### Task 3: DeepSeek Settings Master Switch

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] **Step 1: Write the failing test**

Add or update a settings UI test so clicking the unchecked `启用 DeepSeek` checkbox makes these checkboxes checked:

```ts
expect(screen.getByRole('checkbox', { name: '启用 DeepSeek 生成趣味评论' })).toBeChecked()
expect(screen.getByRole('checkbox', { name: '转写完成后自动生成 DeepSeek 总结' })).toBeChecked()
expect(screen.getByRole('checkbox', { name: '启用 DeepSeek 宠物对话功能' })).toBeChecked()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx -t "DeepSeek"`

Expected: FAIL because the child toggles remain unchecked after enabling the master switch.

- [ ] **Step 3: Write minimal implementation**

Add a helper in `FloatingAssistantApp.tsx`:

```ts
function toggleDeepSeekEnabled(enabled: boolean) {
  updateDeepSeekPreference(
    enabled
      ? {
          deepseekEnabled: true,
          deepseekCommentEnabled: true,
          deepseekAutoSummaryEnabled: true,
          deepseekPetChatEnabled: true
        }
      : { deepseekEnabled: false }
  )
}
```

Use it in the master checkbox `onChange`.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npx vitest run src/shared/petHoverShortcuts.test.ts src/renderer/src/features/state/assistantState.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx -t "DeepSeek|hover|assistant state"
```

Expected: PASS for relevant suites.

### Task 4: Final Verification and Commit

**Files:**
- Modified files from Tasks 1-3.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Inspect git diff**

Run: `git diff -- src/shared/petHoverShortcuts.ts src/shared/petHoverShortcuts.test.ts src/renderer/src/features/state/assistantState.ts src/renderer/src/features/state/assistantState.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

Expected: Only this feature's changes appear.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add src/shared/petHoverShortcuts.ts src/shared/petHoverShortcuts.test.ts src/renderer/src/features/state/assistantState.ts src/renderer/src/features/state/assistantState.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
git commit -m "fix: enable deepseek defaults"
```
