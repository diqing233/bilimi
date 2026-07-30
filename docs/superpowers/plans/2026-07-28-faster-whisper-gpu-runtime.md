# Faster-Whisper GPU Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make faster-whisper large models reliably use an NVIDIA GPU when CUDA is usable, explain every CPU fallback, and show the actual runtime in model settings and transcription status.

**Architecture:** Treat CUDA libraries as part of the controlled faster-whisper runtime rather than part of a model. The Python/helper entry point discovers its bundled or installed NVIDIA DLL directories before importing CTranslate2; the main process runs the same real CUDA health check in development and packaged modes and returns structured GPU identity, memory, compute type, and failure reason. Renderer state is derived only from that probe and from the queue's authoritative actual runtime.

**Tech Stack:** Electron main/preload, TypeScript, React, Vitest, Python 3.12, faster-whisper 1.2.1, CTranslate2 4.8.0, CUDA 12 cuBLAS, cuDNN 9, PyInstaller.

---

### Task 1: Controlled CUDA Runtime Discovery

**Files:**
- Modify: `tools/transcribe_faster_whisper.py`
- Modify: `tools/transcribe_faster_whisper_test.py`
- Modify: `tools/faster-whisper-runtime-requirements.txt`
- Modify: `tools/build_faster_whisper_helper.py`
- Modify: `tools/build_faster_whisper_helper_test.py`

- [ ] Add failing Python tests proving NVIDIA DLL directories are registered before CTranslate2 loads and the helper build collects the pinned CUDA runtime packages.
- [ ] Run the focused Python tests and confirm the new assertions fail for the missing behavior.
- [ ] Implement deterministic discovery for bundled `_MEIPASS` DLLs and Python `site-packages/nvidia/{cublas,cudnn}/bin` directories.
- [ ] Pin CUDA 12 cuBLAS and cuDNN 9 build dependencies and include their binaries in the controlled helper build.
- [ ] Re-run the focused Python tests and confirm they pass.

### Task 2: Authoritative GPU Probe and Diagnostics

**Files:**
- Modify: `electron/main/audioDownload.ts`
- Modify: `electron/main/fasterWhisperGpu.ts`
- Modify: `electron/main/fasterWhisperGpu.test.ts`
- Modify: `electron/main/transcriptionModelManager.ts`
- Modify: `electron/main/transcriptionModelManager.test.ts`
- Modify: `src/shared/types.ts`

- [ ] Add failing tests for process environment overrides, development-Python CUDA probing, GPU name/driver/free-memory evidence, and actionable missing-cuBLAS/cuDNN reasons.
- [ ] Run focused Vitest files and confirm the assertions fail for the missing behavior.
- [ ] Allow controlled process calls to extend `PATH` without losing the parent environment.
- [ ] Probe either the packaged helper or checked Python entry point with identical CUDA arguments and parse safe failure categories.
- [ ] Return structured GPU identity and memory evidence through shared types.
- [ ] Re-run focused Vitest files and confirm they pass.

### Task 3: Model Settings and Active Runtime Feedback

**Files:**
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.tsx`
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] Add failing renderer tests for GPU-ready, CPU fallback, re-detect, active CUDA, and completed runtime labels.
- [ ] Run focused renderer tests and confirm the new assertions fail.
- [ ] Show concise probe status only for selected faster-whisper models and provide a `重新检测 GPU` action.
- [ ] Show the main-process-selected device during the active job and retain it on completed queue records.
- [ ] Display the concrete CPU fallback reason without adding a force-GPU switch.
- [ ] Re-run focused renderer tests and confirm they pass.

### Task 4: Real Machine Validation

**Files:**
- Modify only if diagnostics expose a tested defect in the files above.

- [ ] Install the pinned build/runtime dependencies into the configured development Python.
- [ ] Run the helper CUDA health check against the installed large-v3-turbo model and require structured `device: cuda` evidence.
- [ ] Run a real audio transcription and verify the helper command/runtime reports CUDA float16.
- [ ] Restart the development app without clearing user data and verify model settings plus active/completed runtime feedback.

### Task 5: Regression Gates

**Files:**
- No additional production files unless a failing gate reveals a scoped regression.

- [ ] Run all focused GPU, model manager, transcription provider, queue, settings, and notes tests.
- [ ] Run the full `npm test` suite.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and compare TypeScript diagnostics against the existing baseline.
- [ ] Record remaining external limitations; do not package or publish a Windows installer in this task.
