# Managed Favorite Membership Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume interrupted old-favorite batches without re-appending videos when a non-empty bilimi target folder's full resource endpoint returns HTML but its lightweight membership endpoint remains available.

**Architecture:** Keep ordinary source folders on `/x/v3/fav/resource/list` so classification retains title, author, description, category, and tags. Read non-empty bilimi-managed folders from `/x/v3/fav/resource/ids`, merge those aids with ordinary source metadata through the existing protection partition, and fail closed with a safe HTTP diagnostic when target membership cannot be read.

**Tech Stack:** TypeScript, React runtime bridge, generated webview scripts, Vitest/JSDOM.

---

### Task 1: Prove managed membership uses the lightweight endpoint

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`

- [ ] **Step 1: Write the failing scan regression test**

Add a test whose folder list contains one ordinary source and one managed folder with `media_count: 1`. Make `/x/v3/fav/resource/list` succeed only for the ordinary source, make `/x/v3/fav/resource/ids` return `[{ id: 7, type: 2 }]`, and throw if the managed folder reaches the full resource endpoint. Assert source metadata is retained, target membership is `{ '9001': [7] }`, the managed scan is complete, and only the source uses the full endpoint.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts -t "uses lightweight ids for non-empty managed folders"`

Expected: FAIL because the current scanner requests `/x/v3/fav/resource/list?media_id=9001`.

- [ ] **Step 3: Add the minimal managed membership reader**

In `buildOldFavoriteScanScript`, add a builder for `/x/v3/fav/resource/ids?media_id=<folder id>` and a reader that validates `data` as an array, keeps positive finite IDs whose type is video (`2`), and returns only aids. Route reliably empty managed folders to `[]`, non-empty managed folders to the ID reader, and ordinary folders to the existing detail reader.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: PASS with no managed `/resource/list` request.

### Task 2: Preserve reorganization semantics and interrupted-batch recovery

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`

- [ ] **Step 1: Write failing behavior tests**

Cover an old persisted batch cursor where source aid `7` also appears in managed membership, then assert source metadata survives and the runtime preview places aid `7` in `scanContext.protectedVideos` instead of an appendable item. Add target-only aid `8` to membership and assert it creates neither an item nor a protected video. Assert no request body or URL uses delete, move, unfavorite, or archive-confirm operations.

- [ ] **Step 2: Run the focused tests and verify RED where behavior is missing**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx -t "managed membership|interrupted managed scan|target-only"`

Expected: the API regression fails before implementation; existing partition behavior may already pass and acts as characterization coverage.

- [ ] **Step 3: Make only the necessary integration changes**

Keep source folder objects unchanged, populate `targetMembership` from IDs, and leave target-only aids out of source folders. Do not change execution-plan request builders.

- [ ] **Step 4: Re-run the focused tests**

Run the command from Step 2.

Expected: all selected tests PASS.

### Task 3: Fail closed with safe target-membership diagnostics

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`

- [ ] **Step 1: Write failing HTML/login/risk tests**

Return HTML from `/x/v3/fav/resource/ids` with a redirecting final URL, HTTP status, and content type. Assert `managedFolderScanComplete` is false, target membership is not treated as empty, the folder failure is labeled as target-membership failure, and its safe diagnostic retains status/content type/final URL/redirected without retaining the HTML body. At the runtime boundary, assert the user message says `目标收藏夹成员读取失败` and the batch remains pending.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx -t "target membership failure"`

Expected: FAIL because current API errors omit content type, final URL, redirect state, and the precise target-membership message.

- [ ] **Step 3: Add structured safe diagnostics**

Extend generated API errors with `httpStatus`, normalized `contentType`, sanitized final URL, and `redirected`. Copy only those fields plus a bounded message into the managed folder failure record. Never copy response bodies. Update the runtime failure message to identify target membership specifically.

- [ ] **Step 4: Re-run focused tests**

Run the command from Step 2.

Expected: PASS; pending batch state remains present after the failed scan.

### Task 4: Review, verify, and integrate

**Files:**
- Review only the files changed above and this plan.

- [ ] **Step 1: Request an independent sub-agent review**

Ask the reviewer to check endpoint routing, schema handling, fail-closed behavior, recovery semantics, append-only safety, diagnostics privacy, and test gaps. Resolve every critical or important finding and rerun affected tests.

- [ ] **Step 2: Run repository verification**

Run: `git diff --check`

Run: `npm test`

Run: `npm run build`

Expected: all commands exit 0. Do not run preview, packaging, installer, release, or real Bilibili mutations.

- [ ] **Step 3: Create the one required commit**

Stage only the intended plan, production, and test files. Commit once with message `fix: recover managed favorite membership scans`.

- [ ] **Step 4: Fast-forward local main**

After the commit, switch to local `main` and fast-forward it to `codex/project-reliability-security`. Do not fetch, merge, push, or force-update GitHub.
