# Old Favorites Visual Redesign Design

- Date: 2026-06-25
- Scope: `FavoriteLedgerPanel` old-favorites organization flow
- Status: Approved by direction: guided flow

## Goal

Redo the `整理旧藏` visualization so the user can understand old favorite scanning, generated favorite-folder candidates, append preview, and final execution as separate decisions.

## Design

Use a guided flow inside the existing `掌库` panel instead of adding a new page. The topbar keeps the existing `备册` and `整理旧藏` actions. After scanning, the panel shows an old-favorites guide with four steps:

1. `扫描概览`: total videos, source folders, auto-selected items, review items, and skipped items.
2. `生成收藏夹`: local candidates plus DeepSeek-enhanced names when available. The user can check candidates and save them through the existing `同步` action.
3. `归档预览`: concrete video rows with source folder, target folder, status badges, and per-item checkboxes.
4. `确认执行`: a summary of selected append operations and a guarded `确认整理` button.

DeepSeek only enhances deterministic candidates. It must not invent source folders, bypass local scanning, or directly execute append operations. If DeepSeek is unavailable or fails, local candidates remain visible with a local label.

## Bug Fix Focus

The current old-favorites visualization mixes scan insights, candidate ledgers, preview rows, and final execution in one dense block. The redesign fixes that by giving the user a visible step state and by showing scan failure messages instead of empty previews.

## Testing

Add focused component tests that prove:

1. Scanning opens the guide at `扫描概览`.
2. The guide can move to `生成收藏夹` and show DeepSeek-enhanced candidates.
3. The guide can move to `归档预览`, uncheck an item, and execute only checked append operations from `确认执行`.
4. Scan failures still show an error and do not render an empty preview.
