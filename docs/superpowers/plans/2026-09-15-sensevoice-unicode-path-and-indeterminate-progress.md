# SenseVoice 中文路径与转写指示条 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SenseVoiceSmall 可在 Windows 中文用户目录/安装目录下运行，并让“正在转写音频”阶段的横条只表示处理中、数字仍显示估算百分比。

**Architecture:** SenseVoice provider 在检测到 helper 或模型路径含非 ASCII 字符时，使用当前已为 ASCII 的任务临时目录创建一个临时 Windows junction，向 sherpa-onnx 传入该 junction 下的 helper、模型和词表路径；转写任务清理时随任务临时目录一同清理 junction。渲染层保留既有百分比估算，但只为 `transcribing-segment` 使用无 `value` 的 `<progress>`，由浏览器呈现往返移动的不定指示。

**Tech Stack:** Electron 主进程、Node.js `fs/promises` junction、React 原生 `<progress>`、Vitest、Testing Library。

---

## File map

- Create: `electron/main/transcriptionProviders/senseVoicePathSandbox.ts` — 验证 SenseVoice 同根布局，必要时在任务 ASCII 临时目录中创建/复用 runtime junction，返回 helper/model 的 ASCII 路径。
- Create: `electron/main/transcriptionProviders/senseVoicePathSandbox.test.ts` — 覆盖中文源路径映射、ASCII 快路径、布局不一致和创建失败。
- Modify: `electron/main/transcriptionProviders/senseVoice.ts` — 在启动 helper 前准备安全路径；失败时保持简短、安全的错误文案。
- Modify: `electron/main/transcriptionProviders/senseVoice.test.ts` — 覆盖 provider 使用 sandbox 输出路径和不泄漏完整原生路径。
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx` — 为 `transcribing-segment` 保留百分比文本但移除 `<progress>` 的 `value`，使用浏览器原生不定进度条与正确 aria 文案。
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx` — 覆盖转写阶段文字百分比和无 `value` 横条；覆盖相邻阶段仍为确定进度。
- Modify: `docs/requirement-ledgers/2026-09-15-installed-transcription-failure-diagnosis.md` — 按 R001–R004 记录实际代码位置、自动化验证和待真实老电脑验收条件。

### Task 1: SenseVoice 路径映射的失败测试

**Files:**

- Create: `electron/main/transcriptionProviders/senseVoicePathSandbox.test.ts`

- [x] **Step 1: Write failing tests for the desired sandbox contract**

  Test that a model root such as `C:/Users/中文/AppData/Local/Programs/bilimi/resources/tools/win32/transcription-models/sensevoice-small` produces paths under an ASCII job directory such as `C:/Windows/Temp/bilimi-transcribe-x/sensevoice-runtime`, invokes the injected junction creator once with the true root, and never changes the audio file. Test that already ASCII paths bypass creation, incompatible helper/model layouts throw a safe setup error, and junction failure is surfaced as a concise setup error.

- [x] **Step 2: Run the sandbox test file and verify red**

  Run: `npm test -- electron/main/transcriptionProviders/senseVoicePathSandbox.test.ts`

  Expected: failure because `senseVoicePathSandbox.ts` is absent.

### Task 2: Minimal safe junction implementation

**Files:**

- Create: `electron/main/transcriptionProviders/senseVoicePathSandbox.ts`
- Test: `electron/main/transcriptionProviders/senseVoicePathSandbox.test.ts`

- [x] **Step 1: Implement the tested path sandbox**

  Export a function which accepts `helperPath`, `modelDirectory`, and `workingDirectory`. It must: detect ASCII-only paths; derive and validate the normal `<root>/runtime/bin/sherpa-onnx-offline.exe` and `<root>/model` layout; create a `junction` named `sensevoice-runtime` below `workingDirectory` only when the source helper/model paths are non-ASCII; and return the mapped helper and model directory. It must not copy model bytes, alter source directories, or delete the target.

- [x] **Step 2: Run the sandbox test file and verify green**

  Run: `npm test -- electron/main/transcriptionProviders/senseVoicePathSandbox.test.ts`

  Expected: all sandbox tests pass.

### Task 3: Wire sandbox into SenseVoice provider

**Files:**

- Modify: `electron/main/transcriptionProviders/senseVoice.ts`
- Modify: `electron/main/transcriptionProviders/senseVoice.test.ts`

- [x] **Step 1: Write failing provider tests**

  Inject a sandbox function into `transcribeAudioSegmentWithSenseVoice`; assert it receives the WAV segment’s parent directory and the original paths, then assert `runProcess` is called only with sandbox-returned ASCII helper/model arguments. Add a failure test that preserves a short user-safe setup error rather than helper stderr or an absolute Unicode path.

- [x] **Step 2: Run provider tests and verify red**

  Run: `npm test -- electron/main/transcriptionProviders/senseVoice.test.ts`

  Expected: failure because the provider does not yet invoke the sandbox.

- [x] **Step 3: Implement the provider integration**

  Resolve sandboxed paths immediately before `runProcess`, use those paths only for process command/arguments, preserve cancellation semantics, and keep native helper `stderr` out of the queue-facing error.

- [x] **Step 4: Run provider and sandbox tests and verify green**

  Run: `npm test -- electron/main/transcriptionProviders/senseVoice.test.ts electron/main/transcriptionProviders/senseVoicePathSandbox.test.ts`

  Expected: all related tests pass.

### Task 4: Restore an indeterminate transfer bar only for local audio transcription

**Files:**

- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`

- [x] **Step 1: Write failing UI tests**

  In the active `transcribing-segment` fixture, keep assertions for `49%` / `68%`, change the progressbar assertion to expect no `value`, and assert an `aria-label` that identifies an active local-transcription indicator rather than overall completion. Add a neighboring `merging-transcript` fixture that still expects a numeric `value`.

- [x] **Step 2: Run the focused UI test file and verify red**

  Run: `npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

  Expected: failure because the current transcribing progress bar has `value`.

- [x] **Step 3: Implement the smallest rendering change**

  Keep `formatProgress` estimates and the text percentage unchanged. Add an `indeterminate` flag only for `transcribing-segment`, omit `<progress value>` when it is set, and use a processing-specific aria label. Chromium's native indeterminate `<progress>` restores the prior moving treatment without a custom CSS animation or additional rendering cost.

- [x] **Step 4: Run focused UI tests and verify green**

  Run: `npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

  Expected: all tests pass.

### Task 5: Regression verification, visual check, ledger, and local commit

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-15-installed-transcription-failure-diagnosis.md`

- [ ] **Step 1: Type/build and regression verification**

  Run: `npm test`, then `npm run build`, then `npm run dev` and inspect one running local transcription in the Electron development build. Confirm: current task retains its percentage text, only the bar moves during `transcribing-segment`, non-transcribing phases remain deterministic, clicks/scrolling remain responsive, and a normal window resize/minimize/close works.

- [x] **Step 2: Record evidence per ledger item**

  Record exact files/tests for R001–R004. State separately that true old-PC verification still requires a Windows account/install path containing Chinese characters and an actual SenseVoice run.

- [x] **Step 3: Final integrity checks**

  Run: `git diff --check`, `git diff --stat`, and `git status --short`; inspect that only the files in this plan plus its requirement ledger are changed.

- [ ] **Step 4: Commit the complete, verified topic**

  Run: `git add docs/requirement-ledgers/2026-09-15-installed-transcription-failure-diagnosis.md docs/superpowers/plans/2026-09-15-sensevoice-unicode-path-and-indeterminate-progress.md electron/main/transcriptionProviders/senseVoicePathSandbox.ts electron/main/transcriptionProviders/senseVoicePathSandbox.test.ts electron/main/transcriptionProviders/senseVoice.ts electron/main/transcriptionProviders/senseVoice.test.ts src/renderer/src/features/notes/VideoNotesPanel.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx && git commit -m "fix: support SenseVoice paths with Chinese characters"`

## Self-review

- R001/R002: Task 1–3 addresses the helper execution point, preserves concise errors, and does not claim that this is the only possible old-PC cause without a real old-PC run.
- R003: Task 2 uses an ephemeral ASCII junction rather than copying 284 MiB or asking users to move Windows directories.
- R004: Task 4 limits indeterminate presentation strictly to `transcribing-segment`; percentage text and all other progress computation remain unchanged.
- No task changes B 站 data, queue persistence semantics, model download/removal, or DeepSeek scheduling.
- 未完成的真实界面验收：开发版已启动，但桌面自动化返回 `unsupported Codex auth method: apikey`，无法取得 Electron 窗口；老电脑中文目录的安装版实际 SenseVoice 转写也需待新安装包生成后验证。
