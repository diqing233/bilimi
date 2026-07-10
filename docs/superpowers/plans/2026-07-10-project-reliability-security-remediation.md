# Project Reliability And Security Remediation Implementation Plan

> **Status (2026-07-10): Completed.** Tasks 1-11 were implemented and verified in one delivery. The unchecked step list below is retained as the original TDD execution script, not as remaining work. Final evidence: `npm run verify`, Python `unittest`, `npm audit --omit=dev`, and three repeated critical-regression runs.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved project-wide reliability, security, persistence, accessibility, and quality-gate remediation in one verified delivery and one final Git commit.

**Architecture:** Introduce focused boundary modules for cancelable process execution, DeepSeek credential storage, browser-session policy, crash recovery, and keyboard interaction. Keep existing business components and IPC contracts where possible, extending them with abort signals, patch persistence, protection status, and explicit failure state.

**Tech Stack:** Electron 42, TypeScript 5.8, React 19, electron-store, Vitest, Testing Library, Node child processes, Electron safeStorage/session APIs.

---

## File Map

- Create `electron/main/processRunner.ts`: cancelable, timed child-process execution and Windows process-tree termination.
- Modify `electron/main/audioDownload.ts`, `audioSegmenter.ts`, `localWhisperTranscription.ts`, `fasterWhisperTranscription.ts`, and `videoTranscriptionService.ts`: propagate process options and abort signals.
- Modify `electron/main/videoTranscriptionQueue.ts` and `store.ts`: persist queue state, recover running items, and cancel active work.
- Create `electron/main/deepseekCredentialStore.ts`: safeStorage migration and plaintext fallback policy.
- Modify `electron/main/deepseekService.ts`, `index.ts`, preload/types, and settings UI: credential status and bounded requests.
- Create `electron/main/browserSessionPolicy.ts` and `electron/main/browserCrashRecovery.ts`: permission decisions and one-shot crash recovery.
- Modify `electron/main/index.ts`, `src/renderer/src/features/browser/BiliWebview.tsx`, and `App.tsx`: install policy, observe failures, and display recovery state.
- Modify `VideoNoteArchivePanel.tsx`: serialize memo flush/navigation and roll back failed mutations.
- Modify preference store/IPC/sidebar files: patch-based persistence.
- Modify startup diagnostics and startup UI: real storage probe and retryable preference failure.
- Modify `scripts/setup-media-tools.mjs` and packaging tests: SHA-256 verification for every artifact.
- Create small renderer accessibility helpers where reuse is justified; modify tab lists, dialogs, nested action controls, separator, and reduced-motion CSS.
- Modify shared types and fixtures to restore TypeScript consistency.
- Modify `package.json`, README, and docs for quality gates and behavior disclosure.

## Task 1: Cancelable And Timed Process Execution

**Files:**
- Create: `electron/main/processRunner.ts`
- Create: `electron/main/processRunner.test.ts`
- Modify: `electron/main/audioDownload.ts`
- Modify: `electron/main/audioDownload.test.ts`

- [ ] **Step 1: Write failing runner tests**

Add tests that inject a fake spawn implementation and assert the wished-for API:

```ts
await expect(runProcess('tool.exe', [], { timeoutMs: 10 })).rejects.toMatchObject({
  code: 'timeout'
})

const controller = new AbortController()
const promise = runProcess('tool.exe', [], { signal: controller.signal })
controller.abort()
await expect(promise).rejects.toMatchObject({ code: 'canceled' })
expect(killProcessTree).toHaveBeenCalledWith(fakePid)
```

Also assert successful stdout/stderr collection and non-zero exit compatibility.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run electron/main/processRunner.test.ts electron/main/audioDownload.test.ts
```

Expected: failure because `processRunner.ts`, `ProcessRunOptions`, timeout classification, and abort behavior do not exist.

- [ ] **Step 3: Implement the minimal process boundary**

Define:

```ts
export type ProcessFailureCode = 'canceled' | 'timeout' | 'spawn-failed'

export class ProcessExecutionError extends Error {
  constructor(public readonly code: ProcessFailureCode, message: string) {
    super(message)
  }
}

export type ProcessRunOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}
```

Spawn with inherited UTF-8 environment, register exactly one abort listener, clear timers/listeners on settlement, and call a platform-aware injected process-tree terminator. On Windows use `taskkill /PID <pid> /T /F`; on other platforms kill the child process group or child.

Keep `audioDownload.ts` exporting `runProcess` and `RunProcess` so existing imports remain stable, but move execution responsibility into the new module.

- [ ] **Step 4: Verify GREEN**

Run the same focused command. Expected: all runner and audio download tests pass without open-handle warnings.

## Task 2: Propagate Cancellation And Timeouts Through Transcription

**Files:**
- Modify: `electron/main/audioSegmenter.ts`
- Modify: `electron/main/audioSegmenter.test.ts`
- Modify: `electron/main/localWhisperTranscription.ts`
- Modify: `electron/main/localWhisperTranscription.test.ts`
- Modify: `electron/main/fasterWhisperTranscription.ts`
- Modify: `electron/main/fasterWhisperTranscription.test.ts`
- Modify: `electron/main/audioDownload.ts`
- Modify: `electron/main/videoTranscriptionService.ts`
- Modify: `electron/main/videoTranscriptionService.test.ts`

- [ ] **Step 1: Write failing propagation tests**

For each stage, pass `{ signal, timeoutMs }` into the public operation and assert its injected `runProcess` receives the same options:

```ts
expect(runProcess).toHaveBeenCalledWith(command, args, {
  signal,
  timeoutMs: EXPECTED_STAGE_TIMEOUT_MS
})
```

Add a service test asserting the same signal reaches download, segmentation, and transcription dependencies and that `ProcessExecutionError('canceled')` becomes a stable Chinese cancellation message rather than a generic failure.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run electron/main/audioSegmenter.test.ts electron/main/localWhisperTranscription.test.ts electron/main/fasterWhisperTranscription.test.ts electron/main/audioDownload.test.ts electron/main/videoTranscriptionService.test.ts
```

Expected: signature/call failures because options are not propagated.

- [ ] **Step 3: Implement minimal propagation**

Introduce stage constants, for example:

```ts
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 10 * 60_000
export const AUDIO_CONVERSION_TIMEOUT_MS = 5 * 60_000
export const AUDIO_TRANSCRIPTION_TIMEOUT_MS = 30 * 60_000
```

Extend each dependency input with `signal?: AbortSignal`; call `runProcess(command, args, { signal, timeoutMs })`; keep injected test runners compatible by updating their type. The service maps timeout and cancellation to explicit stage-aware messages and rethrows other failures with existing context.

- [ ] **Step 4: Verify GREEN**

Run the same focused tests. Expected: all pass.

## Task 3: Restore And Cancel The Production Transcription Queue

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/videoTranscriptionQueue.ts`
- Modify: `electron/main/videoTranscriptionQueue.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

- [ ] **Step 1: Write failing store and queue tests**

This step was superseded after user review. Keep the original product rule: application startup archives recoverable drafts and clears the stored queue. Do not restore previous tasks automatically.

The final regression expectations are:

```ts
expect(loadVideoAudioTranscriptionQueue(store)).toEqual([])
expect(store.snapshot.videoAudioTranscriptionQueue).toEqual([])
```

Assert completed drafts are archived only when needed and persisted queue data is retained. Add a queue test where `transcribe` waits for `signal.abort`, call `cancel(runningId)`, and assert the item ends as `canceled` and processing continues to the next pending item.

- [ ] **Step 2: Write failing UI wiring tests**

Render `MemorialPanel` with a running queue item. Assert a cancel button is visible and invokes `onCancelQueuedVideoAudioTranscription(id)`. Render a failed/canceled item and assert retry invokes the retry callback.

- [ ] **Step 3: Verify RED**

Run:

```powershell
npx vitest run electron/main/store.test.ts electron/main/videoTranscriptionQueue.test.ts src/renderer/src/features/assistant/MemorialPanel.test.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx
```

Expected: old clear behavior, no running abort, and missing controls.

- [ ] **Step 4: Implement production recovery and active cancellation**

Normalize stored queue items and convert only `running` to `pending`. Do not clear the store. Keep legacy completed-draft archive migration idempotent by checking archive identity/version before append.

Change queue dependency to:

```ts
transcribe: (
  request: VideoAudioTranscriptionRequest,
  progress: (progress: VideoAudioTranscriptionProgress) => void,
  signal: AbortSignal
) => Promise<VideoNote>
```

Create an `AbortController` per active item, abort it from `cancel`, classify cancellation separately in the processing catch path, and clear the active controller in `finally`.

Pass cancel/retry props from `MemorialPanel` into `VideoNotesPanel`; render controls based on selected item status.

- [ ] **Step 5: Verify GREEN**

Run the focused command. Expected: all pass.

## Task 4: DeepSeek Credential Protection And Timeouts

**Files:**
- Create: `electron/main/deepseekCredentialStore.ts`
- Create: `electron/main/deepseekCredentialStore.test.ts`
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/main/deepseekService.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] **Step 1: Write failing credential adapter tests**

Use a small store double and safe-storage double to cover:

```ts
expect(loadCredential(store, availableSafeStorage)).toEqual({
  apiKey: 'sk-old',
  status: { configured: true, protection: 'encrypted' }
})
expect(store.get('deepseekApiKey')).toBe('')
expect(store.get('deepseekApiKeyEncrypted')).toBe(base64Ciphertext)
```

Also cover plaintext fallback, clearing both fields, and decrypt failure returning `protection: 'error'` without exposing ciphertext as a key.

- [ ] **Step 2: Write failing timeout tests**

Inject a fetch implementation that waits for abort. Advance fake timers and assert generation and connection test reject/return with a timeout result after the configured duration.

- [ ] **Step 3: Write failing settings status tests**

Assert settings displays one of `系统加密保护`, `本地明文保存`, or `密钥需要重新填写` based on `DeepSeekKeyStatus.protection`.

- [ ] **Step 4: Verify RED**

Run:

```powershell
npx vitest run electron/main/deepseekCredentialStore.test.ts electron/main/store.test.ts electron/main/deepseekService.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx -t "DeepSeek|credential|timeout|密钥"
```

Expected: missing adapter/status/timeout behavior.

- [ ] **Step 5: Implement credential adapter and request deadline**

Extend status:

```ts
export type DeepSeekKeyStatus = {
  configured: boolean
  protection: 'encrypted' | 'plaintext' | 'unavailable' | 'error'
}
```

Persist encrypted bytes as base64. Prefer safeStorage, migrate legacy plaintext during load, fall back only when encryption is unavailable, and remove both representations on clear. Inject safeStorage operations so unit tests do not require Electron runtime.

Wrap fetches with an `AbortController`, merge internal timeout with optional caller signal, clear timers, and preserve custom base URL behavior exactly.

- [ ] **Step 6: Verify GREEN**

Run the focused tests. Expected: all pass.

## Task 5: Browser Permissions And Crash Recovery

**Files:**
- Create: `electron/main/browserSessionPolicy.ts`
- Create: `electron/main/browserSessionPolicy.test.ts`
- Create: `electron/main/browserCrashRecovery.ts`
- Create: `electron/main/browserCrashRecovery.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/renderer/src/features/browser/BiliWebview.tsx`
- Modify: `src/renderer/src/features/browser/BiliWebview.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Write failing permission-policy tests**

Assert Bilibili `fullscreen` and explicitly required clipboard permissions are allowed, while media/geolocation/notifications/device/filesystem/unknown permissions and every non-Bilibili origin are denied.

- [ ] **Step 2: Write failing recovery-state tests**

Use a pure recovery tracker:

```ts
expect(tracker.recordCrash(tabId, now)).toEqual({ action: 'reload' })
expect(tracker.recordCrash(tabId, now + 1_000)).toEqual({ action: 'show-error' })
tracker.reset(tabId)
expect(tracker.recordCrash(tabId, now + 2_000)).toEqual({ action: 'reload' })
```

Renderer tests dispatch `did-fail-load` and `render-process-gone`, assert one reload, then an error panel with a manual reload button after repetition.

- [ ] **Step 3: Verify RED**

Run:

```powershell
npx vitest run electron/main/browserSessionPolicy.test.ts electron/main/browserCrashRecovery.test.ts src/renderer/src/features/browser/BiliWebview.test.tsx src/renderer/src/App.test.tsx -t "permission|crash|load failure|reload"
```

Expected: modules and UI states are missing.

- [ ] **Step 4: Implement browser policy and recovery**

Install both session permission handlers before creating the main webview. Keep decisions in pure exported functions and make Electron callbacks thin.

Add webview failure callbacks carrying only URL/reason/exit code. Track crashes per tab in `App`, auto-reload once, then render an accessible tab-local error overlay. Log sanitized details in main/renderer console. Listen for main-window `render-process-gone` and recreate the window once using persisted tab snapshots; register `app.on('child-process-gone')` for sanitized diagnostics.

- [ ] **Step 5: Verify GREEN**

Run the focused tests. Expected: all pass.

## Task 6: Reliable Archive Mutations And Memo Flush

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] **Step 1: Write failing memo-loss tests**

Cover dirty memo followed by archive switch, version switch, panel close, and unmount. Assert persistence is called before selection/close completes. Reject the persistence promise and assert the draft remains visible with a retry control.

- [ ] **Step 2: Write failing rollback tests**

Reject update/star/delete callbacks and assert local archives return to the prior snapshot and no success message is shown.

- [ ] **Step 3: Verify RED**

Run:

```powershell
npx vitest run src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx -t "memo|备注|rollback|delete failure|star failure"
```

Expected: selection proceeds without flush and failed optimistic state remains.

- [ ] **Step 4: Implement serialized persistence**

Track confirmed memo and dirty draft in refs. Implement:

```ts
async function flushMemoDraft(): Promise<boolean>
```

It returns `true` when clean/saved and `false` when persistence fails. Selection and close handlers await it. On unmount, start the best-effort flush while retaining draft in session storage so a rejected/unfinished call can be restored on reopening. Use previous archive snapshots for optimistic mutation rollback. Catch callback errors locally and set an actionable status.

- [ ] **Step 5: Verify GREEN**

Run the focused tests. Expected: all pass.

## Task 7: Atomic Preference Patches And Truthful Startup Diagnostics

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.test.tsx`
- Modify: `electron/main/startupDiagnostics.ts`
- Modify: `electron/main/startupDiagnostics.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing preference-patch race tests**

Assert `saveAssistantPreferencePatch(store, { assistantSidebarWidthPx: 480 })` loads the latest stored object, validates/merges only the patch, and preserves a concurrently changed DeepSeek or close setting. Assert sidebar calls the patch API rather than load-then-full-save.

- [ ] **Step 2: Write failing diagnostics/startup tests**

Inject a probe store that records `set/get/delete`; assert cleanup occurs on success and failure. Reject `loadPreferences` and assert App shows a retryable startup error rather than the browser shell/onboarding-complete fallback.

- [ ] **Step 3: Verify RED**

Run:

```powershell
npx vitest run electron/main/store.test.ts electron/main/startupDiagnostics.test.ts src/renderer/src/features/assistant/AssistantSidebar.test.tsx src/renderer/src/App.test.tsx -t "patch|concurrent|storage|preference load|startup"
```

Expected: no public patch API, unconditional storage success, and silent startup fallback.

- [ ] **Step 4: Implement validated patching and real probe**

Export a store patch function that merges with `loadAssistantPreferences` and reuses `saveAssistantPreferences` normalization. Add `assistant:save-preference-patch` IPC/preload typing. Migrate sidebar width to this API.

Pass a storage-probe dependency into startup diagnostics and perform unique set/get/delete in `try/finally`. Add App startup load state `{ loading | ready | error }` and retry action.

- [ ] **Step 5: Verify GREEN**

Run the focused tests. Expected: all pass.

## Task 8: Media Download Integrity

**Files:**
- Modify: `scripts/setup-media-tools.mjs`
- Create: `scripts/setup-media-tools.test.mjs`
- Modify: `scripts/packaging-config.test.mjs`

- [ ] **Step 1: Write failing configuration and verifier tests**

Export the download manifest and SHA-256 verifier without running `main` on import. Assert every Windows artifact contains a 64-character lowercase SHA-256 value. Write a temporary fixture, verify a known digest, then assert mismatch deletes/rejects the artifact before installation.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx vitest run scripts/setup-media-tools.test.mjs scripts/packaging-config.test.mjs
```

Expected: manifest is not import-safe, artifacts lack SHA-256, and verifier is SHA-1/model-only.

- [ ] **Step 3: Implement verified temporary downloads**

Replace `sha1` with `sha256`, pin every artifact digest, download to `<target>.download`, verify before rename/extract, and verify reusable artifacts before accepting them. For archives, verify the archive before extraction. Always remove temporary paths in `finally`.

- [ ] **Step 4: Verify GREEN**

Run the focused tests. Expected: all pass.

## Task 9: Accessibility Completion

**Files:**
- Create: `src/renderer/src/features/accessibility/tabKeyboardNavigation.ts`
- Create: `src/renderer/src/features/accessibility/tabKeyboardNavigation.test.ts`
- Create: `src/renderer/src/features/accessibility/useModalFocus.ts`
- Create: `src/renderer/src/features/accessibility/useModalFocus.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`
- Modify: `src/renderer/src/features/assistant/CommentIntentDialog.tsx`
- Modify: `src/renderer/src/features/assistant/CommentChooser.tsx`
- Modify: `src/renderer/src/features/assistant/AssistantSidebar.tsx`
- Modify: relevant component tests
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: Write failing keyboard and focus tests**

Assert ArrowLeft/Right/Home/End choose and focus expected tabs, inactive tabs have `tabIndex=-1`, dialogs receive `aria-modal`, Escape closes safe dialogs, focus cycles within dialogs, and focus returns to the trigger.

Assert sidebar separator has `tabIndex=0`, `aria-valuenow/min/max`, and ArrowLeft/Right adjust/clamp width through patch persistence.

Assert MemorialPanel selects are not descendants of buttons. Assert reduced-motion CSS disables `bilimi-status-breathe` and `favorite-ledger-deepseek-progress` animations and nonessential transitions.

- [ ] **Step 2: Verify RED**

Run the relevant component/helper/style tests. Expected: keyboard/focus/semantics assertions fail.

- [ ] **Step 3: Implement focused accessibility helpers**

Use one pure tab-index function plus a small key handler shared by each tab list. Use one modal focus hook that records prior focus, focuses the first control, handles Tab/Escape, and restores focus. Move selects beside action buttons in their own control container. Add separator keyboard semantics and reduced-motion overrides.

- [ ] **Step 4: Verify GREEN**

Run all affected tests. Expected: all pass without nested-interactive DOM warnings.

## Task 10: Type Consistency And Quality Gates

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: failing TypeScript fixtures in Electron/renderer tests
- Modify: `electron/main/mainWindowCloseBehavior.ts`
- Modify: `electron/main/mainWindowControlReactions.ts`
- Modify: `package.json`

- [ ] **Step 1: Capture the current typecheck failure**

Run:

```powershell
npx tsc --noEmit --pretty false
```

Expected: failures for `FavoriteLedgerPreviewItem` shape, preference fixtures, MessageBox options, event listener types, and related production usage.

- [ ] **Step 2: Align production types before fixtures**

Add the fields actually produced/consumed by archive preview logic to `FavoriteLedgerPreviewItem` with the correct required/optional semantics. Change close dialog return type to Electron `MessageBoxOptions`, and make the event target overload accept Electron close event structure without contravariant mismatch.

- [ ] **Step 3: Update fixtures explicitly**

Update test builders to use complete defaults rather than weakening production types or adding broad casts. Keep source folder arrays and protection fields present in every preview/preferences fixture.

- [ ] **Step 4: Add scripts and verify typecheck**

Add:

```json
"typecheck": "tsc --noEmit",
"verify": "npm run typecheck && npm test && npm run build"
```

Run `npm run typecheck`. Expected: exit 0 with no diagnostics.

- [ ] **Step 5: Stabilize touched tests**

Fix the horizontal-scroll test so it waits for the actual state transition rather than racing effects. Wrap asynchronous pet/App updates touched by this work with Testing Library async utilities. Run the affected files repeatedly at least three times.

## Task 11: Full Verification, Documentation Cleanup, And One Commit

**Files:**
- Modify: `README.md`
- Modify: relevant `docs/` files selected by neat-freak reconciliation
- Modify: `docs/superpowers/specs/2026-07-10-project-reliability-security-remediation-design.md` only if implementation details require factual correction
- Modify: this plan checkbox status as tasks complete

- [ ] **Step 1: Repair local Electron installation if required**

Use the configured mirror command already defined by the project:

```powershell
npm run setup:electron
```

Verify `node_modules/electron/dist/electron.exe` exists before attributing Electron-import test failures to application code.

- [ ] **Step 2: Run complete verification**

Run:

```powershell
npm run typecheck
npm test
npm run build
python -m pytest tools -q
npm audit --omit=dev
```

If the Python suite uses a narrower configured command, record and run that exact discovered command. Do not claim success while any command exits non-zero.

- [ ] **Step 3: Run targeted repetition for concurrency/recovery tests**

Run the queue cancellation, crash recovery, credential migration, memo flush, preference patch, and formerly flaky horizontal-scroll tests three consecutive times.

- [ ] **Step 4: Perform project-required documentation cleanup**

Invoke `neat-freak`, reconcile README/docs with code, document encrypted/plaintext credential modes and accepted custom-endpoint risk, queue/crash recovery, browser permissions, and the new `npm run verify` command.

- [ ] **Step 5: Review final diff and workspace safety**

Run:

```powershell
git status --short
git diff --check
git diff --stat
git diff
```

Confirm the pre-existing preload/global typing changes are preserved, no secret value is present, no generated installer is included, and only intended files changed.

- [ ] **Step 6: Create one overall commit**

Stage the complete remediation and commit once:

```powershell
git add package.json README.md docs electron scripts src
git commit -m "fix: harden project reliability and security"
```

Do not amend unless the user explicitly requests it.
