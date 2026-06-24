# Favorite Ledger Topbar Actions Design

- Date: 2026-06-24
- Scope: `掌库` panel header layout
- Status: Approved

## Goal

Place the `备册` and `整理旧藏` actions to the right of the `掌库` title, matching the compact topbar shown in the requested screenshot.

## Design

Keep the current `FavoriteLedgerPanel` structure and behavior. The existing topbar already groups the title and setup actions together, so the change is a layout refinement rather than a component rewrite.

The topbar should render as one horizontal row in normal widths:

1. `掌库` stays left-aligned.
2. `备册` and `整理旧藏` sit on the right side of the same framed topbar.
3. The two topbar action buttons use the same width and match the `转写音频` primary action scale.
4. If the available width becomes too narrow, the row may wrap without clipping text.

## Testing

Add a focused component/style test that verifies the topbar uses the right-side toolbar layout. Existing interaction tests for `备册` and `整理旧藏` continue to cover behavior.
