# Settings Background Preference Save Design

## Goal

Make settings controls feel instant and keep mouse movement, scrolling, hover, and window interaction responsive while preferences are persisted in the background.

## Problem

Settings clicks currently update UI state and persist preferences through Electron IPC. The previous improvement reduced preference persistence from many synchronous `electron-store` writes to one batched write and removed unnecessary snapshot refreshes. That removed the obvious freeze, but the remaining synchronous disk write can still cause a small hitch on Windows, especially when antivirus, indexing, or slow storage touches the app config file.

The target behavior is that settings controls never wait for persistence work. A click should update the visible control immediately, while durable storage happens later without blocking the UI or the Electron main process hot path.

## Scope

- Apply to ordinary assistant preferences changed from settings controls, including pet style, fullscreen pet visibility, pet hover shortcuts, review action defaults, favorite archive mode, and DeepSeek feature toggles.
- Keep explicit commands such as saving a DeepSeek API key, testing DeepSeek, resetting DeepSeek, syncing ledgers, and running automation actions outside the silent background-save path.
- Preserve cross-window preference updates for the main window, floating assistant, and floating pet.
- Preserve the current preference schema and migration behavior.

## Non-Goals

- Do not change the visual design of the settings page.
- Do not change Bilibili automation behavior.
- Do not move sensitive DeepSeek API key storage into the ordinary debounced preference queue.
- Do not add a heavy worker or utility process unless the async writer still leaves measurable input hitches.

## Recommended Approach

Use a two-stage persistence model:

1. Renderer-side optimistic updates and save scheduling.
2. Main-process in-memory preference cache with asynchronous file persistence.

This keeps the click path short and makes disk IO happen outside the immediate UI event path.

## Renderer Design

Introduce a small preference save scheduler used by `FloatingAssistantApp`.

Responsibilities:

- Apply preference patches to local React state immediately.
- Merge rapid changes into the latest complete preference snapshot.
- Debounce ordinary settings saves by roughly 200-300 ms.
- Ensure only one save is in flight at a time.
- If changes arrive during an in-flight save, enqueue only the latest snapshot for the next save.
- Expose `flush()` for explicit saves and app/window shutdown paths.

Expected behavior:

- Clicking a radio or checkbox changes the control immediately.
- Rapidly toggling several settings sends one or two saves instead of one save per click.
- The renderer never calls snapshot refresh after ordinary settings persistence.
- Save failures do not roll back the visible choice immediately; they show a compact status/error and keep the latest snapshot available for retry.

DeepSeek API key behavior:

- Typing the API key remains local draft state.
- Clicking "Save DeepSeek" flushes pending ordinary preference changes first, then saves the key through the existing explicit API key path.
- Testing DeepSeek saves/flushes explicit settings before the test, because the user asked for a command with an observable result.

## Main Process Design

Replace the ordinary preference hot path with an async preference repository.

Responsibilities:

- Load preferences once into memory during app startup or first access.
- Serve `assistant:load-preferences` from memory after the initial load.
- Accept complete preference snapshots from the renderer.
- Normalize and update the in-memory snapshot synchronously.
- Broadcast `assistant:preferences-changed` from memory after accepting a valid snapshot.
- Persist the latest snapshot to disk asynchronously.
- Coalesce writes so only the latest dirty snapshot is written after the current write finishes.

Disk persistence:

- Keep the existing config shape compatible with `loadAssistantPreferences`.
- Prefer an atomic async write pattern: write temp file, then rename.
- Keep the DeepSeek API key in its existing storage field and avoid leaking it into renderer preferences.
- On write failure, keep the in-memory value and report a save error to the renderer so the user can retry.

Shutdown behavior:

- On app quit, flush the latest dirty preference snapshot.
- Use a bounded timeout so quit is not trapped forever by a bad disk.
- If flush fails, log the error and keep the previous on-disk config.

## Data Flow

Ordinary setting toggle:

1. User clicks a setting.
2. Renderer immediately updates `preferences` state.
3. Renderer scheduler records the latest full snapshot.
4. After the debounce window, renderer sends the latest snapshot to `assistant:save-preferences`.
5. Main process normalizes it, updates memory, broadcasts preferences, and schedules async disk persistence.
6. Disk write completes later without blocking the UI click path.

Explicit DeepSeek save:

1. User edits DeepSeek fields and clicks save.
2. Renderer flushes pending ordinary preference changes.
3. Renderer saves the API key through the existing explicit key channel if needed.
4. Renderer persists the complete DeepSeek preference snapshot and shows success/error status.

## Error Handling

- Invalid preference payloads are normalized before being accepted.
- Disk write failures do not crash the app.
- The UI shows a quiet "settings not saved yet" error only if persistence actually fails.
- A later preference change retries persistence with the latest full snapshot.
- If the app quits before a successful write, the previous on-disk preferences remain valid.

## Testing

Unit tests:

- Scheduler applies optimistic state immediately.
- Rapid changes are coalesced into the latest snapshot.
- In-flight saves are serialized.
- A pending save can be flushed explicitly.
- Failed saves preserve the latest pending snapshot for retry.

Main process/store tests:

- Saving preferences updates the in-memory snapshot immediately.
- Async disk writes are coalesced.
- Load returns the in-memory snapshot after initialization.
- DeepSeek API key state remains separate from renderer-visible preferences.
- Quit flush writes the latest dirty snapshot or times out safely.

Renderer tests:

- Settings controls update immediately before the save promise resolves.
- Ordinary settings changes do not call `notifyAssistantSnapshotChanged`.
- DeepSeek explicit save flushes ordinary preferences before saving/testing.

Verification:

- `npm test`
- `npm run build`
- Manual check in the app: click settings controls repeatedly and confirm mouse movement, scrolling, and hover remain responsive while the saved value survives restart.

## Acceptance Criteria

- Ordinary settings clicks do not visibly freeze mouse movement or scrolling.
- A burst of setting changes results in coalesced persistence rather than one disk write per click.
- No ordinary settings save refreshes the assistant snapshot.
- Preferences still synchronize to the main window, floating assistant, and floating pet.
- Saved ordinary preferences survive app restart.
- DeepSeek key save/test/reset behavior remains explicit and reliable.
