# Adaptive Window Density Design

## Goal

Make bilimi usable on Windows machines with high display scaling, especially 2K displays at 200%, without asking users to change system scaling.

## Problem

Electron BrowserWindow dimensions are device-independent pixels. On a 2560x1440 display at 200% scaling, the app sees roughly 1280x720 logical space. The current fixed main window minimum of 1280x820 can exceed the available logical height, so the minimized app still looks almost fullscreen.

## Design

Main window sizing should be computed from the current display work area. The preferred initial size remains 1600x960 on roomy displays, but the actual initial size must be capped to about 92% of the logical work area. The minimum size should stay spacious on normal logical displays and relax to a compact floor on small logical displays, while never exceeding the current work area.

Assistant sidebar width should also clamp against the current window width. Wide windows keep the existing 320-384px feel. Medium and small logical windows can use narrower minimums and defaults so the embedded Bilibili webview keeps enough usable width.

Renderer density should tighten only the app chrome and assistant sidebar at compact breakpoints. The app should not globally scale the entire UI with CSS transforms, and it should not force the embedded Bilibili page to ignore the user's Windows scaling preference.

Floating pet, menu, and assistant windows already use work-area-aware placement. This change should leave their behavior intact unless a regression test proves they need adjustment.

## Acceptance Criteria

- A logical work area near 1280x720 produces a main window below fullscreen size and a minimum height that does not exceed the work area.
- Roomy displays still open near the existing 1600x960 preferred size.
- Sidebar width preferences are re-clamped for the current window width.
- Compact renderer styles reduce app chrome spacing and assistant sidebar density without applying a global transform.
- Tests cover the window sizing helper, sidebar width clamp behavior, and compact CSS guardrails.
