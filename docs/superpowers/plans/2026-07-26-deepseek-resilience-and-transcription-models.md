# DeepSeek Resilience and Transcription Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make faithful DeepSeek note processing resumable and tolerant of transient gateway failures, while adding SenseVoiceSmall as the bundled Chinese default and three optional downloadable transcription models: whisper.cpp small, faster-whisper large-v3-turbo, and faster-whisper large-v3.

**Architecture:** Preserve the immutable transcript and faithful local-patch workflow already present in the dirty working tree. Split DeepSeek proofreading and summary into persisted stages with bounded retry, then introduce one app-level transcription-provider contract backed by a SenseVoice adapter and a shared Whisper adapter. Model files are machine-global, preferences are account-scoped, and every optional model is installed atomically from a verified manifest.

**Tech Stack:** Electron main/preload/React renderer, TypeScript, Vitest, whisper.cpp, faster-whisper/CTranslate2, SenseVoiceSmall, Windows x64 helper processes.

---

## Non-Negotiable Product Decisions

- Bundled and new-install default: `SenseVoiceSmall`.
- Optional download: current `whisper.cpp small`, `faster-whisper large-v3-turbo`, and `faster-whisper large-v3`.
- `large-v3` and `large-v3-turbo` share one faster-whisper runtime.
- Existing completed transcripts are never regenerated automatically.
- Existing queued/running work keeps the provider/model captured when the job started.
- Model binaries are shared by the machine, not copied per Bilibili account.
- Model selection is remembered per account after that account's initial default.
- No speaker diarization in this plan.
- SenseVoice language/emotion/event tokens do not enter faithful transcript text; useful sound events remain optional metadata.
- Original transcripts remain immutable; failed DeepSeek processing never overwrites them.
- Do not package or publish until `docs/release-checklist.md` is completed for dev, preview, and installed forms.

## Task 1: Baseline and Preserve Existing Work

**Files:**
- Inspect: `electron/main/deepseekService.ts`
- Inspect: `electron/main/faithfulTranscriptPolishing.ts`
- Inspect: `electron/main/videoTranscriptionQueue.ts`
- Inspect: `src/shared/types.ts`
- Inspect all dirty files before editing.

- [ ] Record `git status --short` and identify user/Terra changes already present.
- [ ] Run the focused faithful-polishing, DeepSeek, queue, and archive tests before further changes.
- [ ] Do not reset, overwrite, or reformat unrelated dirty files.
- [ ] Use TDD for every behavior change below.

## Task 2: Add Explicit DeepSeek Stage Metadata

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/main/deepseekService.test.ts`
- Modify: `electron/main/videoTranscriptionQueue.ts`
- Modify: `electron/main/videoTranscriptionQueue.test.ts`

- [ ] Add stage identifiers `proofreading-batch`, `summary`, with batch index/count where applicable.
- [ ] Add a progress callback to the note-poster orchestration without changing other DeepSeek request behavior.
- [ ] Update queue progress so the UI can distinguish `正在保真校对 1/N` from `正在生成内容总结`.
- [ ] Ensure diagnostics include stage, elapsed milliseconds, model, status, and finish reason, but never API keys or full transcript text.
- [ ] Add tests proving a 504 identifies the failed stage.

## Task 3: Retry Only Transient DeepSeek Failures

**Files:**
- Create: `electron/main/deepseekRetry.ts`
- Create: `electron/main/deepseekRetry.test.ts`
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/main/deepseekService.test.ts`

- [ ] Write failing tests for status 429, 502, 503, and 504 retry behavior.
- [ ] Implement at most two retries after the initial attempt with abort-aware delays of 2 seconds then 6 seconds.
- [ ] Honor `Retry-After` when present and longer than the local delay, with a conservative upper bound.
- [ ] Never retry 400/401/403, invalid-output validation failures, or user cancellation.
- [ ] Keep retries scoped to the current proofreading batch or summary call; never restart completed batches.
- [ ] Add deterministic injected delay functions for tests; no real sleeps in test suites.

## Task 4: Persist Faithful Proofreading Checkpoints

**Files:**
- Create: `src/shared/noteProcessingCheckpoint.ts`
- Create: `src/shared/noteProcessingCheckpoint.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `electron/main/videoNoteArchiveStore.ts` or the established archive persistence owner discovered in Task 1.
- Modify: corresponding persistence tests.

- [ ] Define a checkpoint keyed by account/video/transcript hash/prompt version/model.
- [ ] Persist completed proofreading batch IDs, locally assembled polished segment text, correction records, review items, and completion state.
- [ ] Hash the immutable normalized source transcript so stale checkpoints cannot apply to changed source text.
- [ ] Write checkpoints atomically using the repository's established store pattern.
- [ ] On cancellation or process exit, retain completed batch checkpoints.
- [ ] On source or prompt-version mismatch, ignore the checkpoint without deleting the original transcript.

## Task 5: Resume Summary Without Re-Proofreading

**Files:**
- Modify: `electron/main/deepseekService.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/videoTranscriptionQueue.ts`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: relevant tests.

- [ ] Resume missing proofreading batches only.
- [ ] When proofreading is complete and summary fails, retain the polished transcript checkpoint.
- [ ] Make `重新生成总结` call only the summary stage when a valid checkpoint exists.
- [ ] Preserve current archive registration behavior: original transcript remains saved even when DeepSeek fails.
- [ ] Replace raw `504 Gateway Timeout` UI text with `DeepSeek 服务响应超时，文稿和精修结果已保留。请稍后仅重试内容总结。` when the summary stage times out.
- [ ] Do not claim the polished result is available if proofreading itself failed.

## Task 6: Introduce the Unified Transcription Provider Contract

**Files:**
- Create: `electron/main/transcriptionProviders/types.ts`
- Create: `electron/main/transcriptionProviders/registry.ts`
- Create: `electron/main/transcriptionProviders/registry.test.ts`
- Modify: `electron/main/videoTranscriptionService.ts`
- Modify: `electron/main/videoTranscriptionService.test.ts`
- Modify: `src/shared/types.ts`

- [ ] Define provider/model IDs: `sensevoice-small`, `whisper-small`, `faster-whisper-large-v3-turbo`, `faster-whisper-large-v3`.
- [ ] Normalize every backend to ordered `{ start, end, text }` transcript segments plus optional diagnostics metadata.
- [ ] Capture the selected model ID in each queued item when enqueued.
- [ ] Resolve a provider once per job; never switch models in the middle of an audio file.
- [ ] If an already-downloaded explicit model fails, report the failure; only automatic/default selection may offer a deliberate compatibility fallback.

## Task 7: Add Account-Scoped Model Preferences

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/state/assistantState.ts`
- Modify: `electron/main/localDataService.ts` or the established preference persistence owner.
- Modify: corresponding tests.

- [ ] Add `transcriptionModelId` with `sensevoice-small` as the initial default.
- [ ] Preserve explicit model choices per account.
- [ ] Existing queued/running tasks keep their captured model; completed tasks do not change.
- [ ] Model installation state remains machine-global and must not be duplicated during account migration.
- [ ] Existing users with an explicit legacy model choice keep it; users with no explicit choice receive SenseVoiceSmall after it passes runtime health checks.

## Task 8: Build the SenseVoiceSmall Backend

**Files:**
- Create: `electron/main/transcriptionProviders/senseVoice.ts`
- Create: `electron/main/transcriptionProviders/senseVoice.test.ts`
- Add a focused helper under `tools/` or `electron/helpers/` using the smallest verified Windows-compatible runtime.
- Modify: media-tool path and startup-diagnostic owners.

- [ ] Verify the official SenseVoiceSmall weight license and redistribution terms before bundling; record source URL, version, license, and SHA-256 in a checked-in manifest.
- [ ] Select a Windows x64 CPU-capable runtime that does not require users to install Python manually.
- [ ] Parse timestamps and speech text into the common segment contract.
- [ ] Strip language, emotion, audio-event, and control tokens from transcript text without deleting spoken words.
- [ ] Retain useful event tokens only in optional metadata.
- [ ] Add fixtures for Mandarin, filler words, repeated words, English phrases, numbers, and event tokens.
- [ ] Add a startup health check using a tiny known audio fixture.
- [ ] Bundle SenseVoiceSmall only after dev runtime validation; otherwise keep the registry disabled with an actionable diagnostic rather than silently pretending it is available.

## Task 9: Add the Shared faster-whisper Backend

**Files:**
- Modify/reuse: `electron/main/fasterWhisperTranscription.ts`
- Modify/reuse: `tools/transcribe_faster_whisper.py`
- Create or modify corresponding tests.
- Modify: provider registry and diagnostics.

- [ ] Use one shared faster-whisper/CTranslate2 runtime for both `large-v3-turbo` and `large-v3`.
- [ ] Detect NVIDIA CUDA availability and usable compute type.
- [ ] Prefer `float16`; allow `int8_float16` when configured or when memory pressure requires it.
- [ ] Keep a CPU diagnostic path but do not recommend CPU for either large model.
- [ ] Enable VAD conservatively and verify low-volume speech is not silently dropped.
- [ ] Preserve filler words, repetitions, foreign text, numbers, and timestamps in output.
- [ ] Package the helper as a controlled process so end users never install Python manually.

## Task 10: Implement Verified Optional Model Installation

**Files:**
- Create: `electron/main/transcriptionModelManifest.ts`
- Create: `electron/main/transcriptionModelManager.ts`
- Create corresponding tests.
- Modify preload/global API types and IPC owner.

- [ ] Create a manifest containing model ID, version, runtime family, official source, optional domestic source, byte size, installed size, required files, license metadata, and SHA-256 for every artifact.
- [ ] Optional downloads are Whisper small, large-v3-turbo, and large-v3; SenseVoiceSmall is marked bundled.
- [ ] Download to a temporary `.partial` location with progress reporting and resumable range requests.
- [ ] Check free disk space before download and extraction.
- [ ] Verify every required hash before atomic installation.
- [ ] Never activate partial or unverified models.
- [ ] Support retry, pause/cancel, delete, and local-folder import.
- [ ] Prefer a verified domestic source for Chinese users, fall back to the official source, and never require a proxy.
- [ ] Do not invent or ship unverified mirror URLs or hashes; if licensing/source verification cannot be completed, expose local import only and report the blocker.

## Task 11: Add the Transcription Model Settings UI

**Files:**
- Modify the established settings component under `src/renderer/src/features/assistant/`.
- Modify: relevant CSS and tests.

- [ ] Show four rows: SenseVoiceSmall `中文快速 · 默认自带`, Whisper small `通用兼容`, large-v3-turbo `通用高质量`, large-v3 `最高质量`.
- [ ] Show download size, installed size, required hardware, installation state, and current selection.
- [ ] Use `下载`, `暂停/继续`, `设为当前模型`, and `删除模型` controls with consistent existing UI styling.
- [ ] Do not allow selecting an uninstalled model.
- [ ] Prevent deletion while a running job uses that model.
- [ ] Explain that large-v3 and turbo share their runtime and model files are machine-global.
- [ ] Keep the settings compact; do not introduce a model marketplace.

## Task 12: Migration and Recovery

**Files:**
- Modify the established migration registry and tests.
- Modify queue persistence tests.

- [ ] Detect an existing valid `ggml-small.bin` as already-installed Whisper small.
- [ ] Do not redownload or delete existing model files during migration.
- [ ] Normalize legacy queue items without a model ID to the model captured by legacy behavior (`whisper-small`).
- [ ] New jobs use the current account preference.
- [ ] Restored running jobs become waiting/restart using their captured model.
- [ ] Model download state and partial files survive safe restarts without appearing installed.

## Task 13: Benchmark and Acceptance Fixtures

**Files:**
- Create: `docs/transcription-model-evaluation.md`
- Add local ignored audio fixtures or a documented fixture acquisition process with no copyrighted media committed.

- [ ] Compare all four models on the same Mandarin, mixed Chinese-English, numbers/models, noisy/music, low-volume, repeated/filler, and 30-60 minute samples.
- [ ] Record character error observations, protected-token errors, missing segments, timestamp drift, runtime, peak RAM/VRAM, model size, and failure behavior.
- [ ] SenseVoiceSmall may remain the bundled default only if it does not regress protected numbers/models or silently omit speech relative to current Whisper small.
- [ ] If it fails the default gate, keep the implementation available but retain Whisper small as bundled default and report the evidence rather than forcing the product decision.

## Task 14: Verification

**Files:**
- Verify every changed file.

- [ ] Run focused DeepSeek, faithful polishing, retry, checkpoint, provider, model-manager, queue, archive, preference, migration, and settings tests.
- [ ] Run the full test suite with enough timeout and report pre-existing failures separately.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Start a clean development build and test SenseVoice default, each downloaded model selection, cancellation, retry, restart, deletion guard, and DeepSeek 504 resume behavior.
- [ ] Do not run `npm run dist:win` until the user explicitly requests packaging and the complete `docs/release-checklist.md` dev/preview/installed procedure is followed.
- [ ] Do not push, publish, or sleep the computer unless explicitly requested in the active task.
