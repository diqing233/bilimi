# Default Favorite System Control Design

## Goal

Let each Bilibili account choose between bilimi's default favorite-folder system and a fully custom folder system, while preserving safe staging, live organization updates, local archive integrity, and explicit confirmation before deleting remote bilimi folders.

## Product Rules

### Account-scoped configuration

- Favorite-folder settings are stored separately for each Bilibili account.
- The first time an account is seen after local data initialization, it receives the default configuration once.
- Returning to an account restores that account's last switch value, enabled folders, custom folders, rules, and order.
- Clearing local user data makes every account new again.

### Default folder master switch

Add `启用默认收藏夹`, enabled by default.

When enabled:

- bilimi default folders participate in local classification and are valid DeepSeek archive targets.
- Unbound default folders can participate in tag collection and archive preview as local logical targets.
- A remote Bilibili folder is created or bound only when the user explicitly backs up folders or chooses Bilibili synchronization at final execution.
- Starting an old-favorite organization round automatically enables all ordinary default folders for that round.
- During an active organization round, ordinary default folders cannot be unchecked or deleted, but their keywords and DeepSeek constraints remain editable.

When disabled:

- ordinary default folders are visibly disabled, unavailable for selection, excluded from local classification, excluded from DeepSeek targets, and excluded from backup.
- custom and adopted recommendation folders remain available.
- the system staging folder remains available as a safety destination and is not treated as an ordinary default classification folder.
- already-created remote default folders are not deleted immediately. They become deletion candidates at the next explicit folder synchronization or final old-favorite Bilibili synchronization.

Settings copy must explain that disabling is for users who want a self-defined system, recommend creating several DIY folders first, and warn that existing remote default folders may be offered for deletion during the next synchronization.

### Folder controls outside and during organization

Outside an active organization round:

- all ordinary folders can be checked or unchecked.
- `取消全选` keeps the legacy behavior and clears the current selection.
- custom folders can be edited, deleted, and reordered.
- default folders can be unchecked for cleanup, but cannot be structurally deleted from the local default definitions.

During an active organization round:

- enabled default folders remain checked and cannot be unchecked or deleted.
- default keywords and DeepSeek constraints can still be edited.
- custom and adopted recommendation folders can still be checked, unchecked, edited, deleted, and reordered.
- `取消全选` clears custom and recommendation selections but leaves the round-required defaults enabled.
- once the remote execution plan is frozen or executing, later folder edits affect only a future round and never mutate in-flight Bilibili operations.

### Tag collection and preview unlock

- Preserve the current accuracy-first behavior: formal automatic classification waits for tag enrichment to finish.
- Archive preview stays locked while tag enrichment is running and clearly says that tags are being collected and preview classification will follow.
- `使用当前标签继续` may explicitly accept the current tag state and unlock classification early.
- When classification starts, it uses the folders enabled at that moment.
- Custom folders retain their existing precedence over default folders when both match.
- No suitable match remains unclassified; the user may explicitly stage it.

### Live reclassification

Reuse the authoritative main-process reclassification path. Do not add a renderer-owned classification state machine.

Reclassify all segments after:

- saving changed keywords or DeepSeek constraints;
- checking or unchecking a custom folder;
- adopting or removing a recommendation folder;
- changing folder order;
- changing the default-folder master switch.

Only replace `system-high` and `system-low` results. Preserve `manual` and `deepseek` classifications.

### Drag ordering

- Restore the compact 1.0.5 drag-and-drop ordering behavior without adding a third-party drag framework.
- Reordering updates sequential `priority` values and persists them for the current account.
- The order primarily controls display. Preserve the legacy classifier behavior where priority is only the final tie-breaker after folder kind, rule type, score, and matched-keyword count.
- UI copy only needs to say that dragging changes folder order.

### Save, backup, and Bilibili execution

The final organization decision keeps two actions:

- `仅保存本轮到收藏库`: writes videos, folder membership, organization history, and eligible local protection records without modifying Bilibili.
- `确认并同步到 B 站`: creates or binds required remote folders, executes the remote plan, and also writes every processed video to the local video library.

Confirmed formal remote success creates protection. Staging, failure, and result-unknown do not. Result-unknown must reconcile before completion or protection is shown.

### Remote folder deletion

Unchecking a folder or disabling the default system only changes the local draft. It never immediately deletes a Bilibili folder.

Before any explicit synchronization, detect disabled bilimi-managed folders that currently have remote bindings. Use one shared deletion-confirmation flow for both the standalone folder sync and final old-favorite Bilibili sync.

The flow must:

1. show the pending synchronization changes;
2. open a second destructive confirmation before deletion;
3. list folder names, folder count, and current remote video counts;
4. warn: `请确认这些 bilimi 收藏夹中没有需要保留的重要视频。`;
5. explain that deleting the folder does not delete Bilibili videos, but removes those favorite relationships;
6. default to cancel;
7. require an explicit `我已确认` checkbox before enabling the red `删除并同步` action;
8. refresh remote state immediately before deletion and abort if verification fails;
9. delete only bilimi-managed folders, never ordinary user folders;
10. stop on the first failure and report the specific folder without blind continuation or retry.

If the user cancels destructive confirmation during final old-favorite synchronization, return to the confirmation step and do not silently run a partial synchronization.

After successful deletion:

- remove the remote binding and stale physical-shard membership;
- retain local video records and organization history;
- invalidate protection targets pointing to the deleted folder;
- keep a video protected if another valid formal target remains;
- if no valid formal protection target remains, expose the video to the next incremental organization round.

## Architecture

- Keep the main-process workspace, repository, binding service, and sync service authoritative.
- Store the default-system switch and folder preferences in account-scoped assistant preferences or a small account-keyed preference projection; do not duplicate the complete workspace in renderer state.
- Extend the existing `autoClassifyAllSegmentsUnsafe(..., true)` path for configuration-triggered reclassification.
- Extend the existing `deleteDisabled` synchronization capability with a preview/verify/confirm command boundary rather than creating a second deletion implementation.
- Keep the renderer responsible only for drafts, dialogs, and explicit user intent.

## UI Behavior

- The only operable switch appears in Settings with detailed caution text; the folder overview only reflects disabled defaults.
- Disabled defaults use disabled controls plus an `已停用` text state; color alone must not communicate the state.
- Default folders that are locally enabled but unbound show a clear local-only/not-backed-up state rather than appearing unavailable.
- While tag enrichment blocks preview, show a useful progress/locked state instead of an empty preview.
- Destructive actions use explicit labels, remote counts, and a safe default focus.

## Performance Constraints

- No high-frequency polling.
- No renderer-owned organization state machine.
- No full-library DOM rendering; retain segmentation and virtualization.
- Reclassification runs in the main process using existing batched segment storage.
- Avoid unnecessary reclassification on keystrokes; trigger after an explicit save, toggle, reorder completion, recommendation action, or master-switch change.

## Verification

Tests must cover:

- per-account initialization and restoration;
- switch-on and switch-off classification inputs;
- staging availability with defaults disabled;
- round-time default locking while custom/recommendation controls remain editable;
- tag-enrichment preview locking and explicit early acceptance;
- reclassification preserving manual and DeepSeek decisions;
- drag order persistence and tie-break behavior;
- legacy `取消全选` semantics inside and outside a round;
- deletion candidate discovery, two-stage confirmation, remote recount, cancellation, and failure stop;
- protection invalidation with zero, one, and multiple remaining formal targets;
- both final execution choices writing the expected local video-library state;
- related renderer tests, main-process service tests, and `npm run build`.

## Non-goals

- Do not restore the legacy giant `FavoriteLedgerPanel`.
- Do not add DeepSeek per-video reasons.
- Do not add a new drag library or decorative animation system.
- Do not delete remote folders merely because the master switch changed.
- Do not alter ordinary non-bilimi Bilibili folders.
