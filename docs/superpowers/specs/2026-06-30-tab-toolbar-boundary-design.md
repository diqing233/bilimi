# Tab Toolbar Boundary Design

## Goal

Keep the browser tab strip from overlapping the top-right window controls when many videos are open, and add a refresh control for the active webview beside the existing expand or collapse control area.

## Design

The main browser header becomes a two-zone toolbar. The left zone is a scrollable tab list that owns `role="tablist"` and contains every browser tab. The right zone is a fixed control cluster separated by a visible boundary. Because the right zone is outside the tab scroller, extra tabs can only consume or scroll inside the left zone and cannot cover the controls.

The refresh button sits immediately to the left of the existing expand or collapse button location. It refreshes only the active `webview`, using the same active-webview lookup path already used by runtime actions. If no webview is ready yet, the click is a no-op.

## Files

- `src/renderer/src/App.tsx`: add the fixed toolbar control cluster and the active-webview refresh handler.
- `src/renderer/src/styles.css`: make `.browser-tabs` a bounded toolbar, add a scrollable tab-strip child, and style the fixed controls with a boundary.
- `src/renderer/src/App.test.tsx`: prove the refresh button calls `reload` on the current active webview.
- `src/renderer/src/styles.test.ts`: lock in the fixed right control area and scrollable left tab strip.

## Testing

Use TDD for the refresh behavior and style guard. Run the focused tests first, then run the full `npm test` suite before committing.
