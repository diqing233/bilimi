# Old Favorite Preview Polish Design

## Goal

Polish the multi-batch archive preview and confirmation screens without changing DeepSeek, batch scanning, persistence, undo/redo, or Bilibili synchronization semantics.

## Confirmed behavior

- Favorite-library list and detail panels use the same repository `libraryStates.sync` fact. A video is synced only when it is observed in a bound bilimi work folder.
- The archive-preview scope switch stays beside the `归档预览` title and matches the compact recommendation-page switch.
- Each archive group uses a two-line header. The title/count occupy the first line; `批量转移` and `显示全部` occupy the second line with a divider reaching the right edge.
- Normal cards remain white. Entering batch-transfer mode automatically expands the group, hides the expand control, and lets card-body clicks toggle selection without checkboxes. Selected cards use the existing blue selected treatment.
- Batch mode shows `全选`, `取消批量`, and a destination menu. One submission applies the existing bulk-classification command and produces one undoable history entry. Exiting or completing the transfer collapses the group.
- Cards keep a fixed compact footprint whether collapsed or expanded. The bordered information area contains exactly title, UP, source, tags, and confidence. The transfer row sits outside that border; original classification appears beside the transfer control, truncates when needed, exposes the full value by tooltip, and disappears when absent.
- The history menu renders in a body portal using viewport coordinates so transformed and scrolling sidebar ancestors cannot clip it. It opens below the trigger when possible and above it when necessary.
- Confirmation overview resolves ledger IDs to display names. Special IDs such as `inbox` use user-facing labels. Targets are separated by horizontal dividers instead of nested cards.

## Performance constraints

- Expanded and batch modes keep `VirtualOldFavoriteTrack` for groups above the virtualization threshold.
- Full selection stores AIDs in component state and submits one bulk assignment; it does not render all cards or issue per-video mutations.
- Whole-run confirmation continues to consume segment summaries only.

## Verification

- Component tests cover sync-state agreement, title/scope alignment contract, compact cards, batch entry/selection/transfer, portal history visibility, display-name mapping, and divider-based confirmation rows.
- Existing archive preview, confirmation, repository service, and favorite-library tests remain green.
- Real Electron dev verification covers the reported 2,000-item batch without performing DeepSeek, save, delete, or Bilibili sync actions.
