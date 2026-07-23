# Favorite Library Entry Behavior Design

## Goal

Make every favorite-library entry predictable while preserving the current embedded drawer and its browsing state.

## Entry Semantics

- An entry inside the bilimi main window is a toggle.
  - Closed: open expanded.
  - Collapsed: expand.
  - Expanded: close.
- An entry from the floating XiaoMi assistant is a reveal action.
  - Restore, show, and focus the bilimi main window.
  - Open the favorite library if closed.
  - Expand it if collapsed.
  - Keep it expanded if already visible.
- The drawer's own collapse and close buttons keep their current meanings.

## State Ownership

The main renderer owns both `open` and `collapsed`. This gives incoming commands one authoritative state transition and avoids a second window-state system. The embedded `FavoriteLibraryApp` remains mounted after its first opening, preserving filters, selection, scroll position, and resized height.

## Main-Process Routing

The existing `favorite-library:open` IPC distinguishes the sender:

- Main renderer sender: send a `toggle` command.
- Floating assistant sender: restore/focus the main window and send a `reveal` command.

If the main window is being created or has not finished loading, the command waits for renderer readiness before delivery. Repeated reveal commands are idempotent and never close the drawer. The window is focused normally and is not made permanently always-on-top.

## Verification

Tests cover closed, collapsed, and expanded transitions; floating reveal behavior; main-window restore/focus behavior; delayed delivery while the renderer loads; and preservation of embedded library state across close/reopen.
