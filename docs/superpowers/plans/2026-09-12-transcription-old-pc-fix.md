# Old-PC Transcription Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SenseVoiceSmall work on Windows installations whose user/temp path contains Chinese characters, keep cancellation from exposing native helper logs, and make CUDA self-test failures actionable on older GPUs.

**Architecture:** Route transcription jobs through an ASCII-only temporary directory on Windows, with a safe fallback chain and the existing OS temp directory on other platforms. Keep cancellation semantics in the queue, but make the SenseVoice provider honor an abort signal that races with a helper exit and replace raw stderr with a concise, stable error. Expand the existing CUDA probe's generic failure guidance without changing GPU, driver, or model-selection policy.

**Tech Stack:** Electron main process, TypeScript, Vitest, electron-builder NSIS.

---

### Task 1: ASCII-safe transcription temp directory

**Files:**
- Create: `electron/main/transcriptionTempDirectory.ts`
- Test: `electron/main/transcriptionTempDirectory.test.ts`
- Modify: `electron/main/index.ts:18-20,1480-1482,2220-2222`

- [x] **Step 1: Write the failing tests** for Windows selecting an ASCII `SystemRoot\\Temp` root, retrying a failed root with the next candidate, and non-Windows preserving `tmpdir()`.
- [x] **Step 2: Run the focused test** and confirm it fails because the helper does not exist.
- [x] **Step 3: Implement the helper** with injectable platform, environment, `mkdtemp`, and `tmpdir` dependencies; use `SystemRoot\\Temp`, `SystemDrive\\Windows\\Temp`, and `C:\\Windows\\Temp` candidates only when ASCII, then fall back to `tmpdir()`.
- [x] **Step 4: Replace both direct `mkdtemp(join(tmpdir(), ...))` calls** in `index.ts` with the helper.
- [x] **Step 5: Run the focused temp-directory tests** and confirm they pass.

### Task 2: Stable SenseVoice failure and cancellation handling

**Files:**
- Modify: `electron/main/transcriptionProviders/senseVoice.ts:94-115`
- Test: `electron/main/transcriptionProviders/senseVoice.test.ts`

- [x] **Step 1: Add failing tests** proving an aborted signal yields an `AbortError` even when the helper returns a non-zero exit, and non-zero stderr is not exposed as the user-facing error.
- [x] **Step 2: Run the focused SenseVoice tests** and confirm the new assertions fail.
- [x] **Step 3: Implement the minimal provider change**: check `signal.aborted` after the process returns, throw an `AbortError`, and otherwise throw a concise SenseVoice error without native command/log text.
- [x] **Step 4: Run the focused SenseVoice tests** and confirm they pass.

### Task 3: Actionable CUDA self-test guidance

**Files:**
- Modify: `electron/main/fasterWhisperGpu.ts:78-90`
- Test: `electron/main/fasterWhisperGpu.test.ts`

- [x] **Step 1: Add a failing test** for a generic CUDA self-test failure and assert the reason explains likely VRAM/driver/runtime causes and CPU fallback.
- [x] **Step 2: Run the focused CUDA probe tests** and confirm the new assertion fails.
- [x] **Step 3: Update only the generic fallback reason**; retain the existing specific cuBLAS, cuDNN, timeout, cancellation, and low-memory branches.
- [x] **Step 4: Run the focused CUDA probe tests** and confirm they pass.

### Task 4: Requirement ledger and release verification

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-12-transcription-old-pc-diagnostics.md`

- [x] **Step 1:** Re-read the complete ledger and record R001/R002 as `已实施待验证`, including exact code locations, focused/full test evidence, package evidence, and the unavailable UI-authentication condition.
- [x] **Step 2:** Run focused tests, then `npm test` and `npm run build`.
- [x] **Step 3:** Check `git status --short`, `git diff --stat`, and `git diff --check`; ensure only this plan, ledger, tests, and implementation files changed.
- [x] **Step 4:** Create one local commit on `main` containing the code, tests, plan, and ledger.
- [x] **Step 5:** Run the required Windows packaging entry point `npm run dist:win`; verify the NSIS artifact and SHA-256. Do not install the package without explicit user authorization.
