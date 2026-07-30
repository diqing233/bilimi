# Whole-App Responsive Interaction Design

**Date:** 2026-07-29

## Goal

Keep the current UI, business behavior, user data, and task semantics unchanged while making startup and every visible interaction responsive. A slow operation may show local loading or progress, but it must not freeze pointer movement or unrelated surfaces.

## First Principle

Visible interaction and durable work use separate paths:

- Visual state changes locally before persistence, IPC, validation, queries, or statistics begin.
- Work that cannot complete immediately exposes local status within 100 ms.
- Background work never blocks unrelated settings, the pet, video playback, the favorite library, notes, or archive browsing.
- Stale asynchronous results cannot overwrite a newer user action.

## Invariants

- Do not change layout, wording, colors, control placement, or existing enabled/disabled rules.
- Do not clear `%APPDATA%\bilimi-dev`, rewrite user archives, or change remote Bilibili state as part of performance work.
- Do not replace existing repository, transcription queue, DeepSeek, export, or video navigation semantics.
- Preserve accessibility names, keyboard behavior, scaling behavior, and reduced-motion behavior.

## Response Classes

### Immediate interactions

Checkboxes, radio buttons, inputs, selects, disclosure controls, selection, starring, pet hover/click/drag/resize, sidebar navigation, and local menus update their owning component immediately. Persistence is coalesced after the visible update.

### Local loading interactions

Opening a favorite folder, video detail, archive, or note first updates the selected shell. Only the data-owning region displays cached content, a skeleton, or loading status. Existing content is not globally cleared.

### Background tasks

Scanning, synchronization, organization, transcription, DeepSeek, export, model download, diagnostics, and GPU probing run outside the renderer interaction path. They publish bounded stage/progress patches and support cancellation where the existing task contract permits it.

## Architecture

### Interaction channel

Transient state lives in the smallest component that renders it. Event handlers perform no full-preference normalization, repository scans, large array transforms, synchronous disk operations, or full-snapshot IPC before the browser can paint.

### Data channel

Settings and repository consumers subscribe to the narrowest entity or field they need. Complete snapshots remain recovery/bootstrap boundaries, not the normal update protocol. Cached data stays visible during refresh.

### Task channel

Long-running operations publish task identity, stage, progress, and terminal state. Renderer updates are coalesced by frame or a bounded interval. One task update patches affected controls and rows rather than replacing the entire application snapshot.

## Surface Requirements

### Startup and navigation

Render the application shell and last-known navigation immediately. Restore settings, favorite summaries, archives, transcription queue, login state, and webviews independently. Switching sidebar tabs must not recreate an unrelated video webview or wait for another workspace query.

### Settings and pet

Settings fields render their local value first and coalesce field patches. Expensive validation runs only on explicit validation actions. Pet animation, pointer hit testing, chat input, drag, and resize remain isolated from settings renders and persistence.

### Favorite library

Navigation disclosure, search input, selection, menus, and detail disclosure remain local. Folder changes update selection immediately and load data in the content region. Lists remain virtualized, progress events patch affected rows, and repository notifications are coalesced.

### Video and timeline

Opening a video immediately activates or creates its tab shell. Reuse the same video tab for the same video/part where the current contract requires it. Timeline clicks immediately select the target; only the latest pending seek may complete. Webview loading and Bilibili page cost must not block bilimi controls.

### Transcription and DeepSeek

Enqueue/cancel/retry actions update task controls immediately. Stages distinguish audio download, preparation, model loading, device selection, transcription, polishing, summary, and archive registration. Completed transcript checkpoints survive summary failure, and summary-only retry remains available.

### Review, notes, archive, and export

Review actions optimistically advance the local item while persistence and permitted remote work run in the background. Note input remains local and saves after idle. Opening archives and export dialogs is immediate; document generation remains a cancellable background task.

## Performance Gates

- Immediate controls visibly update before their persistence callback performs application-level work.
- Rapid operations across multiple controls remain usable and preserve the final value of every field.
- Local disclosure does not render unrelated heavy workspaces.
- Progress bursts are coalesced and do not produce one application render per event.
- Stale folder, detail, seek, and task results are rejected by identity and request generation.
- Existing focused and full tests, build, diff check, TypeScript baseline comparison, and preserved-data development restart remain required.

## Delivery Stages

1. Settings preference interaction and persistence path.
2. Pet animation/input/persistence isolation.
3. Favorite navigation/list/detail isolation and local loading states.
4. Video tab/webview/timeline command isolation.
5. Transcription/DeepSeek progress publication and affected-row updates.
6. Review/notes/archive/export interaction isolation.
7. Startup restoration, whole-app rapid-interaction acceptance, and full verification.
