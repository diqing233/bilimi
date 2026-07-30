# Audio Download And DeepSeek Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover transient Bilibili audio downloads and prevent valid compact DeepSeek summaries from being rejected by obsolete mechanical thresholds.

**Architecture:** Keep the current yt-dlp and two-stage DeepSeek pipeline. Add bounded retry only around transient yt-dlp network failures, relax summary validation to structural validity, and make one focused completion request only when required summary fields are missing.

**Tech Stack:** TypeScript, Electron, Vitest.

---

### Task 1: Transient audio download retry

**Files:**
- Modify: `electron/main/audioDownload.test.ts`
- Modify: `electron/main/audioDownload.ts`

- [x] Add failing tests for SSL EOF retry success, permanent failure without retry, and cancellation without retry.
- [x] Run the focused test and confirm the expected failures.
- [x] Add at most three attempts with abortable 1s/3s delays for transient network failures only.
- [x] Run the focused audio tests.

### Task 2: Compact DeepSeek result recovery

**Files:**
- Modify: `electron/main/deepseekService.test.ts`
- Modify: `electron/main/deepseekService.ts`

- [x] Add a failing test accepting concise but meaningful key points and one complete outline item.
- [x] Add a failing test that requests only missing required fields once and merges the repair result.
- [x] Remove fixed character/count thresholds while retaining non-empty structural validation.
- [x] Add one bounded JSON repair request for missing title, subtitle, key points, or outline.
- [x] Run the focused DeepSeek tests.

### Task 3: Verification

- [x] Run audio, DeepSeek, transcription service, queue, archive, and notes UI tests.
- [x] Run `npm run build` and `git diff --check` on touched files.
- [ ] Restart the existing development instance without clearing `%APPDATA%\bilimi-dev`.
