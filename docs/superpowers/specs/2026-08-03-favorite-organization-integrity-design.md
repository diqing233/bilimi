# Favorite Organization Integrity Design

## Purpose

Make multi-batch favorite organization predictable and recoverable from the first DeepSeek request through local library persistence and Bilibili synchronization. The design also fixes daily-review replacement so a DeepSeek correction replaces obsolete bilimi membership instead of only appending the new destination.

## Non-goals

- Do not change unrelated review, transcription, LocalData, modal, pet, or installed-version behavior.
- Do not remove the existing memo/render-isolation work.
- Do not delete drafts, repository data, or previously completed results.
- Do not claim input responsiveness or Bilibili reliability without real Electron verification.

## 1. Immutable DeepSeek Work Plan

Starting DeepSeek organization creates one durable work plan before the first provider request. The plan freezes:

- workspace id and organization mode;
- requested scope (`current` or `all`);
- included scan segment ids;
- the selected source-folder revision;
- the ordered AID set per scan segment;
- total video count;
- provider request groups and their stable ids;
- completed AIDs, pending AIDs, failed AIDs, and cancellation state.

When every scan segment is already ready, the displayed total must be final from the beginning. A run containing 129 videos must never begin as 100 and later grow to 129.

If some scan segments are still tagging, the UI must explicitly label the total as provisional: `N videos included, X scan batches waiting`. The overview may update only when another scan batch becomes ready, not after each video.

Scan batches and provider request groups are separate concepts:

- scan progress: `batch 2/3`;
- DeepSeek request progress: `group 5/7`.

## 2. Cancellation And Resume

Cancellation is cooperative. It waits for the in-flight provider request to settle, preserves every valid result already applied, and prevents later groups from starting.

A canceled checkpoint is historical state, not the state of a new attempt. Restarting the same all-batch plan must:

- keep completed AIDs;
- clear `canceled` before publishing the restarted snapshot;
- rebuild work only for remaining or failed AIDs;
- immediately expose the cancel action again;
- keep the global DeepSeek task signal and workspace checkpoint consistent.

The application must never show `DeepSeek working` globally while the archive panel says `DeepSeek stopped`.

## 3. Provider Timeout And Retry Policy

The ordinary request group remains 20 videos. Each provider call has a 180-second upper bound.

Recovery policy:

1. Retry a timed-out 20-video group once after a bounded backoff.
2. If it times out again, split it into two stable 10-video child groups.
3. If a 10-video group times out, split it into stable 5-video child groups.
4. A 5-video group gets one bounded retry, then becomes a durable failure.

The implementation must distinguish:

- client timeout;
- HTTP 429/rate limit;
- HTTP 5xx;
- network failure;
- invalid structured result;
- unavailable target ledger;
- incomplete AID coverage.

Only one old-favorite DeepSeek provider call runs at a time. A retry must not start until the previous request is aborted or conclusively settled. Successful AIDs are checkpointed and never resent.

## 4. Progress Semantics

The UI reports independent facts:

- request groups settled;
- videos successfully applied;
- videos waiting for retry;
- videos durably failed;
- scan batches still waiting.

`129/129` may only mean all 129 results were successfully applied. When 89 succeeded and 40 timed out, the UI must say `89/129 applied, 40 waiting for retry`, even if all original request groups have settled.

Automatic group splitting may change the request-group denominator, but it must not change the video total. The UI explains the split instead of making it look like a new scan batch appeared.

## 5. Read-only Browsing During Work

The background working segment and the user's viewed segment are different state:

- `workingSegmentId` belongs to the immutable DeepSeek plan;
- `viewedSegmentId` belongs to renderer navigation.

While DeepSeek, local commit, or Bilibili sync runs, the user may:

- view scan overview, recommendations, archive preview, and confirmation;
- switch current-batch and whole-run views;
- select another batch for read-only inspection;
- resize, close a video, collapse the sidebar, or move the pointer normally.

Mutating controls remain disabled: source selection, candidate adoption, manual transfer, undo/redo, classification changes, and starting another organization.

Changing the viewed segment must not call the coordinator command that changes the DeepSeek working segment.

## 6. Failure Resolution And Execution Gate

Whole-run local save or Bilibili sync cannot begin while the work plan is running, canceled, waiting, or failed.

The user gets two explicit resolution paths:

1. Retry only failed AIDs.
2. `Use original automatic classifications for N videos`.

The second path requires explicit confirmation. It restores the pre-DeepSeek classification for those AIDs, records the resolution in the draft history, clears the failure gate, and does not pretend that DeepSeek classified them.

The renderer disables unsafe actions, but the main-process coordinator is the authoritative enforcement boundary. A stale renderer cannot freeze or execute a partial plan.

## 7. Local-first Whole-run Execution

The required order is:

```text
editable draft
-> complete local commit for each ready batch
-> immutable Bilibili sub-plans/checkpoints
-> Bilibili writes in batch order
```

Rules:

- no Bilibili video write starts before the complete local result for that batch is durable;
- a Bilibili failure leaves the local organized result intact;
- later batches may finish DeepSeek while earlier frozen batches sync;
- Bilibili scanning and Bilibili writing share one remote-operation arbiter;
- restored sync runs in the background so polling and progress remain live;
- read-only navigation remains available while every mutation is locked.

## 8. Bilibili Temporary Failure Handling

Inventory, scanning, reconciliation, and sync diagnostics record HTTP status, content type, Bilibili code, and a sanitized response category. Cookies and response bodies containing user data are not persisted.

The application distinguishes non-JSON responses, 403, 412, 429, 5xx, network failure, account mismatch, target navigation, and target unavailability.

If a folder declares members but its list temporarily returns empty, the result is anomalous. It must not overwrite local repository data. The operation backs off once and otherwise preserves its checkpoint for later continuation.

In a multi-webview window, every operation binds an explicit active target and validates webContents id, instance id, navigation epoch, and account before and after the request.

## 9. Daily-review Replacement Integrity

Daily review currently excludes `inbox` from `removeLedgerIds`. This produces an append instead of a replacement when the first pass stores a video in `bilimi temporary` and DeepSeek later chooses another bilimi ledger.

The corrected behavior is:

```text
initial bilimi membership: temporary
DeepSeek correction: knowledge
Bilibili operation: remove temporary + add knowledge
local desired membership: knowledge
user-owned non-bilimi memberships: unchanged
final state: aligned
```

The Bilibili adjustment result must include enough evidence to persist both the added and removed bilimi physical folders. Local repository persistence occurs only after the Bilibili adjustment is confirmed. If removal or addition is not confirmed, the repository remains `result unknown`/unaligned rather than falsely reporting alignment.

This rule applies to every bilimi-managed prior target, including the remote `inbox` ledger. It does not remove ordinary user-created Bilibili favorites.

## 10. Acceptance Criteria

- A ready three-batch run displays its final video total before request 1.
- Cancel then restart resumes remaining AIDs and immediately shows a cancel button.
- Current/global status never disagree about running, waiting, canceled, failed, or completed.
- A 20-video timeout retries and adaptively splits without resending successful AIDs.
- Failed AIDs block whole-run save and sync until retry or explicit fallback resolution.
- Current-batch and whole-run views work during background processing.
- Complete local persistence precedes the first remote write.
- Resumed Bilibili sync continues to publish progress.
- Temporary Bilibili empty/invalid responses never erase local data.
- Daily review from temporary to knowledge removes temporary remotely and locally while preserving user favorites.

