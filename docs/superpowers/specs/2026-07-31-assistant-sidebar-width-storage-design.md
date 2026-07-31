# Assistant Sidebar Width Storage Design

## Goal

Keep the assistant sidebar content following the pointer in real time while removing the roughly 1.6 second Electron main-process stall that occurs after releasing the resize handle.

## Root Cause

The resize interaction currently persists `assistantSidebarWidthPx` through the shared assistant preference store. The development profile's `config.json` is about 3.13 MB, so `electron-store` synchronously rewrites that entire file for a single width number. Repeated direct measurements of `patchPreferences({ assistantSidebarWidthPx })` took 1.59-1.61 seconds. During that synchronous main-process write, Electron window input is delayed even though the renderer has already applied the final width.

## Design

Add a dedicated layout preference store whose file contains only `assistantSidebarWidthPx`. The main process exposes focused load/save IPC handlers and broadcasts a focused width-changed event to the main renderer. The sidebar reads this store on mount, saves to it after resize, and listens for focused updates. It no longer saves width through the shared assistant preferences channel.

For compatibility, the first load falls back to the existing `assistantSidebarWidthPx` value in the shared preference store when the dedicated layout file has no value. The fallback value is returned immediately and copied into the lightweight store, but the legacy field is not deleted because deleting it would itself rewrite the large shared config and reintroduce the stall during migration.

The existing shared preference field remains readable for old code and older installations, but sidebar resizing and default-layout reset use only the dedicated store. The root application and `FloatingAssistantApp` therefore do not receive an assistant preference patch for a width-only change.

## Data Flow

1. Sidebar mount invokes `layout:assistant-sidebar-width-load`.
2. Main process reads the lightweight layout file.
3. If absent, it falls back to the legacy shared preference value and seeds the lightweight file.
4. Pointer movement continues applying the CSS width variable directly for real-time feedback.
5. Pointer release removes the resize shield and schedules a lightweight width save.
6. Main process writes the small layout file and broadcasts `layout:assistant-sidebar-width-changed` only to the main renderer.
7. Double-click reset and default-layout reset save `null` through the same focused IPC.

## Failure Handling

If loading fails, the sidebar uses its existing responsive default. If saving fails, the width remains locally applied and a later resize may retry. Invalid or out-of-range stored values are normalized with the existing sidebar width helpers.

## Verification

- Unit-test lightweight store load, save, normalization, and legacy fallback.
- Renderer-test that sidebar mount and resize use the focused layout API rather than `patchPreferences`.
- Test focused width-change synchronization and default reset.
- Run existing sidebar, default-layout, preference, and main-process tests.
- In the real Electron development build, measure pointer release to width-save completion and immediate tab click response. The save should no longer take seconds or block interaction.
