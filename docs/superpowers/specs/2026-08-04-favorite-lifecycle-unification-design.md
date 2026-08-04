# Favorite Lifecycle Unification Design

## Goal

Unify Bilibili inventory facts, the bilimi local library, organization drafts, review classification, ledger provisioning, and remote synchronization so every surface uses the same identity, state, count, and permission rules without blocking renderer input.

## Safety boundaries

- Work directly in the existing dirty tree and preserve every pre-existing change.
- Do not reset, stash, revert, clean, package, push, alter installed builds, delete user data, or restore `package.json`.
- Treat video notes and archives as a protected mature subsystem. Favorite deletion, recycling, organization, and migration must not cascade-delete note archives, transcripts, versions, memos, stars, or exports.
- A partial, rate-limited, account-mismatched, or otherwise incomplete Bilibili scan is never authoritative evidence of deletion.

## Canonical three-ledger model

### Bilibili inventory facts

The remote inventory stores observed folder IDs, titles, account identity, membership relations, unavailable-video evidence, scan completeness, and the observation epoch. One relation is `(accountMid, aid, remoteFolderId)`. Folder titles are presentation data and never replace stable IDs.

### bilimi local library

The local library stores video metadata, logical ledger placement, organization/protection records, remote bindings, sync state, audit history, recycle state, and stable references to independent notes/transcripts/archives.

### Organization workspace

The workspace stores source selection, streaming batches, recommendations, automatic/DeepSeek/manual classifications, history, save intent, and frozen remote plans. It never masquerades as the current Bilibili inventory.

## Scan and batching contract

1. Read folder inventory and identify formal managed folders from reliable bindings, not title prefix alone.
2. Scan source pages and merge duplicate AIDs while retaining every source relation.
3. Classify each unique AID as unavailable, protected, pending-source-confirmation, or eligible for this round.
4. Eligible AIDs from selected ordinary sources fill batches up to the configured 500-2000 limit.
5. Seal a batch as soon as the limit is reached; start tag reuse/enrichment and classification while later pages continue scanning.
6. Seal the final partial batch when the full inventory succeeds.
7. A later duplicate only adds source relations. It never enters another batch.

The configured batch size is snapshotted when a round starts. Changing the setting affects the next round only.

## Scan overview contract

The four global metrics are:

- `扫描总数`: all observed Bilibili membership relations, including duplicates and unavailable videos.
- `本轮待整理`: globally unique selected-source AIDs excluding unavailable and protected AIDs.
- `已保护跳过`: globally unique valid protected AIDs.
- `失效视频`: globally unique unavailable AIDs.

The source table is a Bilibili-fact table. Ordinary and managed folders both show their observed total relation count. Its third column switches between per-folder `本轮待整理`, `已保护`, and `失效`. Per-folder values can overlap across rows; global cards remain the authoritative unique counts. An unselected ordinary source displays a dash for pending organization. Incomplete observations display `待确认`, never zero.

## Protection, conflicts, and recycle bin

- A local-only saved organization remains protected because absence of a remote placement is expected.
- A previously confirmed remote placement that changes during a complete scan becomes an organization conflict.
- If the video still has at least one Bilibili source, reuse saved metadata/tags and return it to organization.
- If a complete scan proves the video has no Bilibili source, remove it from active library scopes and put it in the recycle bin.
- Incomplete scans preserve the prior state and mark the source as pending confirmation.
- Recycle-bin records preserve metadata, tags, note/archive references, transcripts, audit history, and last known sources. Clearing the recycle bin removes favorite-library records only; note/archive deletion remains a separate explicit action.
- If a recycled AID reappears in Bilibili inventory, restore it to the active library and organize it with reused metadata.

## Current batch and whole-round projections

- `当前批次` renders only that batch's organization work.
- `本轮总览` renders aggregate counts and operations and does not repeat current-batch progress.
- Whole-round recommendation and archive views update once per completed/sealed batch rather than per scanned page.
- Archive and confirmation whole-round views always list every enabled target plus `bilimi·暂存`, including zero-count targets.
- Whole-round DeepSeek and execution intents wait for future batches required by the chosen scope.

## Save, provision, and synchronize

Classification selection, provisioning, and remote synchronization are distinct:

- A checked ledger means its classification rule is enabled.
- `备册` creates or binds the corresponding Bilibili managed folder.
- Synchronization writes video membership only to provisioned, checked managed folders.

Remote execution is always local-first:

1. Complete and atomically save the local organization result.
2. Mark saved videos organized and protected.
3. Freeze the remote plan by stable logical/physical IDs.
4. Wait for remote inventory reads to finish.
5. Execute paced Bilibili writes in batch order.
6. Reconcile or resume only remaining operations after failure.

Saving locally does not auto-synchronize later. It creates an explicit pending-sync indication.

## Ledger settings and provisioning

- Enabling the default system checks default rules and makes them non-cancelable while enabled.
- Names, keywords, constraints, and bindings are not overwritten merely by checking defaults.
- Custom/recommended ledgers remain user-selectable.
- Reset restores default ledger names and keywords, preserves other ledger definitions, unchecks non-default rules, persists immediately, and does not show an unsaved label.
- The former small `同步` control becomes `备册`. Its adjacent dropdown enters a temporary remote-folder deletion selection mode. Cancel restores the normal rule selections exactly.
- Only reliably bound managed folders may be remotely deleted. Ordinary folders and ambiguous/local drafts are local-library-only deletion targets.

## Review behavior

- Review classification uses the same checked ledger rules as organization.
- A checked but unprovisioned best match remains visible as `最佳匹配：…（未备册）`.
- Existing title, UP, and predicted-placement lines remain unchanged; the provisioning warning is additive.
- Until targets are provisioned, `赏藏赐` performs its existing non-favorite actions and does not silently create folders or backfill remote favorites.
- Provisioning never automatically synchronizes previously reviewed videos.

## Favorite Library permissions

Formal managed folders support copy, move, refresh, reorganize, sync, local deletion, safe remote folder deletion, and rule editing.

Ordinary Bilibili folders support copy into bilimi, refresh, reorganize, summaries/transcription/archive access, local-library deletion, and opening Bilibili for manual folder editing. They never expose move of the ordinary source, ordinary-folder remote deletion, or ordinary-favorite removal.

Video deletion choices are:

- Remove only from the bilimi local library.
- Remove from the local library and every reliably bound bilimi managed folder, while preserving ordinary Bilibili sources.

The second choice lists both managed and ordinary sources. If no ordinary source exists, it shows a high-risk second confirmation. Unknown/incomplete source state blocks the remote choice.

## Filtering

Status uses one nested menu with sync, protection, and organization dimensions. A source filter provides `全部`, `有其他收藏夹`, and `仅在bilimi工作夹`. Unknown source state appears only under `全部`.

## Migration and notes protection

Export/import and account cleanup must preserve the new inventory facts, bindings, rule selections, provisioning state, organization drafts, recycle records, pending sync/reconcile work, and source-confirmation state. Imported remote facts remain pending verification and never trigger remote actions automatically.

Notes, archives, transcripts, versions, memos, stars, and exports retain their existing account/AID/CID identity and lifecycle. Favorite operations only retain references to them.

## Responsiveness contract

- Renderer clicks do not traverse the whole library or serialize multi-thousand-video drafts.
- Main-process calculations are cooperative/chunked and publish compact summaries at bounded intervals.
- Only one batch of cards is mounted; long navigation/source lists remain virtualized.
- Loading state is scoped to the affected action rather than the entire window.
- Real Electron acceptance must exercise pointer motion, resizing, close/minimize, tab switching, and note editing during scan, classification, DeepSeek, provisioning, and sync.
