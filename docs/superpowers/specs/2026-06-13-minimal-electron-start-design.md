# Minimal Electron Startup Design

- Date: 2026-06-13
- Status: Approved for implementation
- Scope: Restore the smallest Electron desktop shell needed to start Bilimi and inspect the current effect.

## Goal

Bilimi should be startable with `npm run dev` so the user can open the desktop application and inspect the first visible effect.

## Scope

This change restores only the minimum app shell:

1. Add Electron, electron-vite, Vite, React, and React DOM startup support.
2. Add development, build, and preview scripts.
3. Add an Electron main process that opens a desktop window.
4. Add a React renderer that fills the window with an embedded Bilibili webview.
5. Keep existing note-domain tests intact.

This change does not restore the sidebar, desktop pet, assistant action automation, collection management, or comment drafting.

## Architecture

The app uses `electron-vite` as the development and build runner. Electron owns the desktop window and enables `webviewTag`; the renderer is a small React app that renders the embedded Bilibili surface.

The browser surface configuration is kept in a small pure TypeScript model so it can be tested without Electron.

## Files

1. `package.json`: add runtime dependencies and `dev`, `build`, `preview` scripts.
2. `electron.vite.config.ts`: configure Electron main, preload, and React renderer.
3. `electron/main/index.ts`: create the desktop window and load the dev server or built renderer.
4. `electron/preload/index.ts`: expose a minimal desktop bridge.
5. `src/shared/constants.ts`: define app title, Bilibili URL, and session partition.
6. `src/shared/types.ts`: define the browser surface model.
7. `src/renderer/index.html`: renderer HTML entry.
8. `src/renderer/src/main.tsx`: React entry.
9. `src/renderer/src/App.tsx`: top-level shell.
10. `src/renderer/src/styles.css`: full-window layout styles.
11. `src/renderer/src/features/browser/browserSurfaceModel.ts`: create the webview configuration.
12. `src/renderer/src/features/browser/BiliWebview.tsx`: render the webview.
13. `src/renderer/src/features/browser/browserSurfaceModel.test.ts`: verify the browser surface defaults.

## Acceptance Criteria

1. `npm run test` passes.
2. `npm run build` succeeds.
3. `npm run dev` starts the Electron desktop app.
4. The opened app window shows the embedded Bilibili browsing surface.
5. The change is committed after implementation.
