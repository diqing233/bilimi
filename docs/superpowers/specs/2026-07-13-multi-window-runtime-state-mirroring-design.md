# Multi-Window Runtime State Mirroring Design

## Goal

Keep the sidebar and floating assistant consistent by making them render the same application runtime state while preserving independent tabs, scrolling, expansion, and window layout.

## Scope

The shared runtime state covers:

- DeepSeek connection status: pending, validating, connected, and failed.
- Favorite organization status: backed up, scanning, pending organization, organizing, completed, canceled, and failed.
- Operation feedback that describes shared work, including scan completion and DeepSeek connection results.
- Existing transcription queue state remains on its current main-process broadcast path.

Navigation feedback such as opening a tab, scrolling, expanding a section, or collapsing a window remains local to that window.

## Architecture

The Electron main process is the authority for assistant runtime status. Renderer windows read an initial snapshot when they mount and subscribe to subsequent changes. A renderer publishes a runtime-status patch when shared work starts, progresses, completes, fails, or is acknowledged.

The shared snapshot is session-only. It is not persisted across application restarts. DeepSeek connection evidence is invalidated when the enabled flag, saved credential state, model, or base URL changes. Favorite organization state is scoped to the current Bilibili account and is reset when the account changes.

The sidebar remains the sole owner of automatic startup connection validation. The floating assistant observes the result instead of issuing a duplicate request.

## State Priority

Favorite organization status uses this display priority:

1. Active work such as scanning or organizing.
2. Failure or cancellation requiring attention.
3. Pending review or execution.
4. Completed work.
5. Base backup status from the assistant snapshot.

Shared operation feedback replaces the local ready message in every assistant window. Local navigation feedback may temporarily appear only in the window where it occurred and must not overwrite the shared operation result in other windows.

## Error Handling

- A late-opened window reads the latest main-process snapshot immediately.
- A rejected stale update returns the authoritative snapshot to the sender.
- Completing or acknowledging work clears the relevant shared state in every window.
- Connection-test task broadcasting remains responsible for the temporary validating indicator; the final result is stored in the shared runtime snapshot.

## Verification

Automated tests must cover bridge broadcasts and late snapshot reads, including DeepSeek success and invalidation, old-favorite scan status and feedback, blue running progress, acknowledgement cleanup, and account reset. Existing single-window component tests remain as regression coverage.
