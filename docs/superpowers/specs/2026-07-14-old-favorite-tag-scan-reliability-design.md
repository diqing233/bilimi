# Old Favorite Tag Scan Reliability Design

## Goal

Restore reliable tag recognition during old-favorite scans without losing caching, resumable state, or truthful progress reporting.

## Design

The initial scan remains one logical operation. It first reads favorite video metadata, then resolves every unique video's missing tags before returning the archive preview. Cached tags are reused immediately. Missing tags are requested sequentially with a timeout and limited retries so one stalled request cannot block the whole scan forever.

Progress is persisted after every unique video outcome. Basic and tag totals use unique video aids, and the UI distinguishes completed, failed, paused, and running states. Failed videos do not block later videos; the final preview contains all successfully resolved tags and reports the failure count explicitly.

The persisted queue remains available for recovery after navigation or webview restart. A resumed worker uses the same timeout, retry, cache, and progress rules as the initial scan.

## Verification

- Regression tests prove the initial scan waits for tag results and returns them in the preview.
- Tests cover cache hits, duplicate videos, retries, timeout/failure continuation, and persisted resume.
- UI tests cover consistent totals and terminal failure messaging.
