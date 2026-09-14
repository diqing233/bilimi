# DeepSeek Reset Stale Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure resetting DeepSeek leaves the settings UI showing the persisted official DeepSeek address rather than a stale pre-reset relay address.

**Architecture:** The reset flow clears an encrypted key before it saves the new preference snapshot. The key-clear IPC must notify renderers only that key status changed, matching the existing key-save handler, instead of broadcasting a stale full preference snapshot that can arrive after the reset save. The renderer continues to receive the full post-save snapshot from `assistant:patch-preferences`.

**Tech Stack:** Electron IPC, TypeScript, Vitest.

---

### Task 1: Lock the key-clear IPC contract

**Files:**
- Create: `electron/main/index.deepSeekIpcWiring.test.ts`
- Modify: `electron/main/index.ts:2135-2138`

- [x] **Step 1: Write the failing test**

```ts
it('publishes only the key-status patch after clearing a DeepSeek key', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')
  const handler = source.match(/ipcMain\.handle\('deepseek:clear-key',[\s\S]{0,360}?\n  \}\)/)?.[0] ?? ''

  expect(handler).toContain('sendAssistantPreferencePatchChanged({ deepseekApiKeyStored: status.configured })')
  expect(handler).not.toContain('sendAssistantPreferencesChanged')
})
```

- [x] **Step 2: Run the test to verify it fails because the handler broadcasts the full preferences snapshot**

Run: `npm test -- electron/main/index.deepSeekIpcWiring.test.ts`

Expected: FAIL; the handler contains `sendAssistantPreferencesChanged` and lacks the key-status patch.

- [x] **Step 3: Make the minimal IPC change**

```ts
ipcMain.handle('deepseek:clear-key', () => {
  const status = clearDeepSeekApiKey(getDesktopStore())
  sendAssistantPreferencePatchChanged({ deepseekApiKeyStored: status.configured })
  return status
})
```

The reset's following `persistPreferences(nextPreferences)` remains responsible for broadcasting the complete official reset state.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- electron/main/index.deepSeekIpcWiring.test.ts`

Expected: PASS.

- [x] **Step 5: Run affected and full regression tests**

Run: `npm test -- electron/main/index.deepSeekIpcWiring.test.ts electron/main/store.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

Run: `npm test`

Expected: all selected and full tests pass.

- [ ] **Step 6: Verify in the Electron development application**

With a pre-reset relay address present, confirm the reset dialog. Verify that the key becomes unsaved, DeepSeek becomes disabled, the service-address input immediately shows `https://api.deepseek.com`, the recommendation card remains unchanged, and no Bilibili action is initiated.
