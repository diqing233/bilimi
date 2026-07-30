# Old Favorite Scan Stall Design

## Problem

The old-favorite scan can appear frozen while a Bilibili favorite resource page fails. The current scan retries every failure three times, scans folders and pages serially, and exposes no current folder, page, or retry state. A new scan can also inherit the previous completed tag count, so `2337 / 2337` is displayed even though the current basic scan has not progressed.

The observed `favorite resource list ... returned HTML instead of JSON` proves that this run eventually completed with an HTML response; it does not prove the worker deadlocked. Code inspection additionally found two genuinely unbounded paths: the initial favorite-folder request has no timeout, and the resource timeout ends after response headers rather than after the response body is parsed.

## Approved behavior

- Treat HTML/login/challenge responses as non-retryable and fail that folder immediately.
- Retry only recoverable transport failures, retaining three attempts with visible retry state.
- Bound both the initial folder-list request and the complete resource response read/parse operation.
- Persist a scan-run identity plus the current folder id/title, page, attempt, and phase in the existing tag-store progress snapshot.
- Reset visible progress when a new scan run starts. A completed snapshot from a previous run must not mask a new `running` snapshot.
- Increase the basic-video count after each successfully read page, not only after an entire folder completes.
- Report the diagnostic belonging to the failed managed bilimi folder rather than blindly using the first failed source.
- Never persist cookies, response bodies, or other secrets as diagnostics.

## Data flow

`buildScanOldFavoritesScript` remains the scan owner in the active Bilibili webview. It writes lightweight progress to the existing local-storage tag store. `FavoriteLedgerPanel` continues polling through `onReadOldFavoriteTagEnrichment`, but progress merging becomes run-aware so a new run can transition from an old `complete` snapshot to `running` with lower counters. The panel renders the current operation beneath basic scan progress.

## Error handling

HTML responses are classified from content type/body and returned as non-retryable authentication/protection failures. Timeout and transient fetch failures remain retryable. Every awaited network+body operation has a hard deadline and honours scan cancellation between attempts. The final result retains failed/partial folder diagnostics.

## Verification

- API tests cover HTML fail-fast, recoverable retry timing/state, bounded list/body reads, page-level progress, and managed-folder diagnostic selection.
- Panel tests cover a previous `2337 / 2337 complete` snapshot followed by a new running scan and visible folder/page/retry details.
- The original dev reproduction is repeated without triggering any Bilibili write action.
- Full tests/build and the repository release checklist follow only after the dev blocker is cleared.
