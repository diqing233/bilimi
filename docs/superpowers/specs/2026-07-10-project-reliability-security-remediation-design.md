# Project Reliability And Security Remediation Design

## Goal

Complete the confirmed project-wide remediation in one delivery: make transcription resumable and cancelable, protect DeepSeek credentials when possible, constrain browser permissions, recover from renderer crashes, prevent note loss, remove preference overwrite races, make diagnostics truthful, verify bundled tools, restore TypeScript correctness, and enforce the resulting quality gates.

The work is delivered as one implementation, one documentation cleanup, and one final Git commit. It does not produce or publish a Windows installer.

## Scope

### Included

- Persist and restore the real transcription queue without clearing unfinished items.
- Cancel pending and running transcription tasks, including their child process trees on Windows.
- Add stage timeouts and distinguish cancellation, timeout, network, and tool failures.
- Connect transcription cancel and retry controls through the complete renderer component chain.
- Prefer Electron `safeStorage` for DeepSeek API keys, migrate existing plaintext keys, and expose whether the active key is encrypted or plaintext.
- Fall back to plaintext key storage when `safeStorage` is unavailable, as explicitly selected by the user.
- Keep custom DeepSeek base URLs fully supported, including HTTP URLs and arbitrary hosts, without a new warning gate.
- Add timeouts to DeepSeek generation and connection testing.
- Install a permission policy for the persistent Bilibili browser session.
- Deny sensitive remote-page permissions by default and allow only the minimal Bilibili capabilities needed by the app.
- Detect webview, renderer, and child-process failures; automatically recover once and stop reload loops after a repeated crash.
- Preserve unsaved archive memo drafts across selection changes, panel closure, and failed saves.
- Roll back optimistic archive mutations when persistence fails.
- Add patch-based preference persistence for cross-window updates.
- Make startup preference failures visible and retryable.
- Make storage diagnostics perform a real reversible read/write/delete check.
- Add SHA-256 verification for all downloaded media binaries and archives.
- Resolve current production and test TypeScript errors and add type checking to normal verification.
- Fix regression-test warnings or instability directly touched by this remediation.
- Address the confirmed accessibility gaps for tabs, dialogs, nested controls, and the sidebar separator.
- Update project documentation to describe credential storage modes, custom endpoint trust, crash recovery, queue recovery, and verification commands.

### Excluded

- Restricting custom DeepSeek endpoints to HTTPS or official hosts.
- Showing a first-use warning for custom DeepSeek endpoints.
- Replacing Electron `<webview>` with another browser architecture.
- A wholesale rewrite of `FloatingAssistantApp.tsx`, `FavoriteLedgerPanel.tsx`, or `electron/main/index.ts`.
- Shipping or validating a Windows installer in this remediation.
- General dependency upgrades unrelated to the confirmed defects.

## Architecture

The remediation introduces focused boundary modules instead of adding separate ad hoc fixes to each caller.

### Cancelable Process Runner

A main-process runner owns child process creation, output collection, timeout handling, abort handling, and process-tree termination. Media operations receive an `AbortSignal` and stage-specific timeout. On Windows, cancellation terminates the spawned process and descendants so yt-dlp, ffmpeg, and whisper cannot remain orphaned.

The runner returns or throws classified outcomes:

- `canceled`: explicitly requested by the user.
- `timeout`: the configured stage deadline expired.
- `process-failed`: the tool exited unsuccessfully.
- `spawn-failed`: the process could not be started.

Existing successful command output behavior remains compatible with current callers.

### Reliable Transcription Queue

The queue owns one `AbortController` for its active item. Enqueue, state transitions, progress updates, completion, cancellation, and retry are persisted immediately.

On startup:

- Recoverable draft notes are saved to the archive before queue cleanup.
- The stored queue is cleared and no previous task is resumed automatically.
- The per-launch completed count starts at zero and is kept only in main-process memory.

Cancellation behavior:

- A pending item changes directly to `canceled`.
- A running item aborts its controller, terminates the current process tree, and finishes as `canceled` rather than `failed`.
- Retrying a failed or canceled item resets transient error/progress fields and returns it to `pending`.

The notes UI exposes context-appropriate controls for the selected queue item and synchronizes from queue change events. Running cancellation stays beside progress, while pending cancellation and retry actions live in the queue popover. Completed history does not replace the current video's note automatically.

### DeepSeek Credential Store

A credential adapter separates secret persistence from general preferences. It uses two mutually exclusive persisted representations:

- encrypted data produced by Electron `safeStorage`;
- plaintext fallback data when encryption is unavailable.

Read order and migration:

1. Read and decrypt the encrypted field when present.
2. Otherwise read the legacy plaintext field.
3. If encryption is available, migrate the legacy plaintext value to encrypted storage and remove the plaintext field.
4. If encryption is unavailable, keep the plaintext value and report plaintext protection status.
5. If encrypted data cannot be decrypted, do not use it as an API key; return a recoverable error that asks the user to enter the key again.

Saving prefers encrypted storage and falls back to plaintext only when `safeStorage` reports encryption unavailable. Clearing removes both representations. Renderer APIs expose only configuration and protection status, never the secret value.

Custom DeepSeek addresses retain current freedom. Requests and connection tests receive bounded timeouts and abort cleanly.

### Browser Session Policy And Recovery

The persistent `persist:bilimi` session is configured once after Electron becomes ready and before remote content is used.

Permission policy:

- Only Bilibili origins may receive the small set of capabilities required for normal playback and app integration, such as fullscreen and safe clipboard operations where Electron requests them.
- Camera, microphone, geolocation, notifications, display capture, HID, USB, serial, MIDI, pointer lock, keyboard lock, filesystem access, and unknown permissions are denied by default.
- Non-Bilibili origins receive no privileged permission grants.
- Both permission-check and permission-request handlers implement the same policy.

Crash recovery:

- Webviews report load failures and renderer termination to their owning tab.
- The first qualifying crash in the recovery window triggers one automatic reload.
- A repeated crash in that window stops automatic reload and displays an inline error state with a manual reload action.
- Main renderer failure recreates the main window and restores locally persisted browser tab state.
- Child-process failure is logged for diagnosis without initiating an infinite application restart.
- Logs contain timestamp, URL, reason, and exit code only; they exclude cookies, request headers, page content, and credentials.

### Reliable Persistence

Archive memo editing tracks the draft separately from the last confirmed persisted value.

- Blur submits the draft as today.
- Selecting another archive, selecting another version, closing the archive panel, or unmounting first flushes the current draft.
- Navigation that would discard a dirty draft waits for the save result.
- A failed save preserves the draft, displays an error, and offers retry.
- Successful feedback appears only after the main process confirms persistence.

Archive memo, star, update, and delete mutations may update the UI optimistically, but they retain the previous snapshot. A rejected persistence request restores that snapshot and displays the failure instead of leaving false success state.

Preferences gain a patch-based IPC operation. Main process merges a validated patch into the latest stored preferences and broadcasts the resulting complete preferences. Sidebar width persistence uses this operation so a stale renderer snapshot cannot overwrite settings changed by another window.

### Diagnostics And Startup

Preference loading failures no longer silently mark onboarding as complete. The startup surface shows an actionable error and retry control.

Storage diagnostics perform a reversible probe against the actual application store:

1. Write a unique temporary value.
2. Read and compare it.
3. Delete it in `finally`.
4. Report an error if any stage fails.

DeepSeek diagnostics inherit the new request timeout. Media diagnostics continue checking required paths and also report executable validation failures when applicable.

### Supply-Chain Verification

Every downloaded media artifact has a pinned SHA-256 digest:

- yt-dlp executable;
- FFmpeg archive;
- whisper.cpp archive;
- Whisper model.

Downloads go to temporary files, are verified before replacement or extraction, and are removed on mismatch. Existing reusable artifacts are accepted only after verification. The packaging tests assert that every configured download has a digest.

### Accessibility

- Every tab list implements ArrowLeft, ArrowRight, Home, and End navigation with roving `tabIndex` and correct tab/panel relationships.
- Modal dialogs use `aria-modal`, focus the first meaningful control, close on Escape where safe, trap focus, and restore prior focus.
- Interactive selects are moved outside `AssistantActionButton` elements rather than relying on stopped propagation inside invalid nested controls.
- The sidebar separator is focusable, exposes current/min/max values, and supports keyboard resizing.
- Reduced-motion styles disable the additional status and progress animations identified during review.

## Error Handling

Errors cross process boundaries as stable user-facing categories rather than raw child-process or fetch exceptions. Detailed technical information is logged locally; UI messages identify the failed stage and whether retry is appropriate.

No operation reports success until its durable write or external action resolves. Cancellation is treated as an intentional terminal state, not an error notification.

## Quality Gates

The implementation follows test-driven development. Each behavior receives a failing regression test before production code changes.

Required focused coverage includes:

- queue restoration and no-clear behavior;
- running-task cancellation and process-tree termination;
- timeout classification;
- UI cancel/retry wiring;
- encrypted credential migration, plaintext fallback, clear, and decrypt failure;
- DeepSeek timeouts;
- browser permission allow/deny rules;
- one-shot crash recovery and repeated-crash error state;
- memo flush, save failure retention, mutation rollback, and retry;
- atomic preference patching under stale-window updates;
- startup preference retry and real storage diagnostics;
- SHA-256 download verification;
- keyboard tabs, modal focus behavior, and separator keyboard resizing;
- current TypeScript model consistency.

`package.json` adds a `typecheck` command. Final verification runs, in order:

1. Focused regression tests throughout implementation.
2. `npm run typecheck`.
3. `npm test`.
4. `npm run build`.
5. Existing Python transcription tests.
6. `npm audit --omit=dev`.

The Electron binary installation problem found during review must be repaired or clearly reported before treating the full test suite as green. A flaky test is not accepted merely because it passes once; it must pass repeated targeted runs or be made deterministic.

## Documentation And Delivery

After implementation and verification, run the project-required `neat-freak` cleanup to reconcile `README.md`, `docs/`, release guidance, and implementation details. Review the final diff for accidental changes and secrets, then create one overall Git commit containing the specification, plan, implementation, tests, and documentation.

No Windows installer is built in this work. A later packaging request must complete every dev, preview, and installed-package path in `docs/release-checklist.md` before release claims.

## Accepted Risks

The user explicitly accepts these residual risks:

- Custom DeepSeek endpoints may use HTTP or arbitrary hosts.
- The application does not add a first-use trust warning before sending the API key to a custom endpoint.
- When `safeStorage` is unavailable, the API key may be stored as readable plaintext to preserve functionality; the settings UI must disclose that state.
