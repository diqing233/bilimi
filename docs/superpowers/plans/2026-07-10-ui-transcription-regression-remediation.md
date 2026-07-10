# UI And Transcription Regression Remediation Implementation Plan

**Status:** Completed on 2026-07-11 after user-reviewed UI and queue behavior restoration.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Follow TDD and do not create intermediate commits; the project requires one final commit after all remediation and documentation cleanup.

**Goal:** Restore the previously approved UI behavior and transcription lifecycle while retaining the necessary reliability, cancellation, security disclosure, and accessibility fixes.

**Architecture:** Keep the transcription queue in main-process memory for the current application run, but clear persisted queue state on application startup after archiving recoverable drafts. Expose a session-only completed count through queue snapshots. Preserve the existing visual hierarchy by using legal sibling controls inside shared visual containers, and keep status-light navigation explicit.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Restore Restart-Clears-Queue Semantics And Session Completion Count

**Files:**
- Modify: `electron/main/store.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/videoTranscriptionQueue.ts`
- Modify: `electron/main/videoTranscriptionQueue.test.ts`
- Modify: `src/shared/types.ts`

- [ ] Write failing tests proving startup archives recoverable drafts, clears every persisted queue state, and returns an empty queue.
- [ ] Run the store tests and confirm the new restart expectations fail.
- [ ] Restore load-time queue clearing without discarding recoverable draft notes.
- [ ] Write failing queue tests for a session-only `sessionCompletedCount` that increments only after successful archive persistence.
- [ ] Run the queue tests and confirm the count is missing or incorrect.
- [ ] Add the count to queue snapshots; do not persist it. Failed and canceled jobs do not increment it; a successful retry increments once.
- [ ] Run focused store and queue tests.

### Task 2: Restore Transcription Status-Light Semantics

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Write failing tests for `暂无转写`, `暂无转写 · 完成 N`, running/pending precedence, hover detail, and restart count zero.
- [ ] Write a failing navigation test proving the transcription light always opens the notes body, even after the archive view was previously active.
- [ ] Run focused tests and confirm failure.
- [ ] Derive idle display from `sessionCompletedCount`, never from historical completed queue items.
- [ ] Make the transcription light explicitly open `notes` with the `notes` view.
- [ ] Remove the permanent `转写完成` terminal state and stale completion event inference.
- [ ] Run focused tests.

### Task 3: Rebuild Queue Controls Without Breaking Header Alignment

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] Write failing tests proving completed history does not automatically replace the current video note or remain as the default visible queue card.
- [ ] Write failing tests for a custom queue popover: pending cancel, failed retry, canceled re-transcribe, completed view-only, and correct item IDs.
- [ ] Write failing tests that running cancellation is in the status/progress row, not the title row.
- [ ] Add layout-contract tests: title and queue trigger are direct header children; title wraps; trigger never shrinks and aligns to the first line.
- [ ] Run focused tests and confirm failure.
- [ ] Replace the native select with an accessible non-modal queue popover using separate row-selection and row-action buttons.
- [ ] Keep running cancellation in the progress/status row; pending cancellation stays in the popover.
- [ ] Use a dedicated two-column queue header grid: `minmax(0, 1fr) max-content`, with natural title wrapping and a nonshrinking trigger.
- [ ] Default the notes body to the current video; queue items are selected only by explicit user action or active work for the current video.
- [ ] Run focused component and style tests.

### Task 4: Restore Review Action Quick-Setting Placement

**Files:**
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx`
- Modify: `src/renderer/src/features/assistant/MemorialPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] Write failing structure and interaction tests proving each select shares one visual action card with its action button but is not nested inside the button.
- [ ] Run focused tests and confirm failure.
- [ ] Implement a compound action-card shell with sibling button and select controls.
- [ ] Restore the pre-regression top-right placement and dimensions; do not restore the previously reverted full-height rail.
- [ ] Verify select changes do not execute the action, while the main action area executes exactly once.
- [ ] Run focused tests.

### Task 5: Restore DeepSeek Key Layout And Status Disclosure

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] Write failing tests for the four key-status placeholders and screen-reader descriptions.
- [ ] Write a failing test proving successful save clears the draft so the saved-status placeholder becomes visible.
- [ ] Write a failing layout-contract test proving the divider belongs above the key field, not above the model field.
- [ ] Run focused tests and confirm failure.
- [ ] Restore the direct two-column key label structure with a semantic class instead of `nth-of-type` positioning.
- [ ] Show `已保存 · 系统加密保护`, `已保存 · 本地明文保存`, `无法读取 · 请重新填写`, or `尚未保存` in the password input placeholder.
- [ ] Keep a screen-reader-only full status, set `aria-invalid` for damaged credentials, handle key-status load rejection, and clear the draft after successful save.
- [ ] Run focused tests.

### Task 6: Keep Recommendation Copy Buttons Attached To Their Values

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] Write failing DOM and style-contract tests for model/value copy groups.
- [ ] Run focused tests and confirm failure.
- [ ] Split each row into prefix plus an inseparable value-and-copy-button group.
- [ ] Make the entire group wrap together when width is insufficient; keep the service button immediately after `v1`.
- [ ] Preserve stable button width and existing copy feedback.
- [ ] Run focused tests.

### Task 7: DeepSeek Status Light Opens The DeepSeek Settings Section

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [ ] Write a failing test that first selects another settings section, clicks the DeepSeek light, and expects the settings select value to become `deepseek`.
- [ ] Verify the target section receives `scrollIntoView` and repeated clicks remain stable.
- [ ] Run focused tests and confirm failure.
- [ ] Route the DeepSeek status light through `openSettingsSection('deepseek')` instead of the generic settings-tab jump.
- [ ] Run focused tests.

### Task 8: Documentation, Review, And Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/release-checklist.md`
- Modify: `docs/superpowers/specs/2026-07-10-project-reliability-security-remediation-design.md`
- Modify: `docs/superpowers/plans/2026-07-10-project-reliability-security-remediation.md`

- [ ] Restore documentation to “restart clears the transcription queue after archiving recoverable drafts.”
- [ ] Document the session-only completion count and queue controls without describing rejected UI layouts.
- [ ] Run spec-compliance review for every confirmed item: BUG-01, BUG-02, UI-01 through UI-06.
- [ ] Run code-quality review and address all actionable findings.
- [ ] Run `npm run verify`, Python transcription tests, audit, secret scan, diff checks, and CP936 roundtrip verification.
- [ ] Run the neat-freak documentation reconciliation.
- [ ] Stage all intended changes and create one final Git commit.
