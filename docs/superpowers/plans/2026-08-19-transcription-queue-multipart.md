# 转写队列、多 P 与 DeepSeek 总结 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让札记能安全地临时选择当前视频的分 P 转写，保证不同 P 的档案不合并，并让 DeepSeek 总结与下一项本地转写并行而不越过单一 DeepSeek 通道。

**Architecture:** 当前页面仅在用户选择`多 P`并点击转写主卡后读取 `window.__INITIAL_STATE__.videoData.pages`，产生不持久化的选择清单；确认后才把完整 `账号 + AID + BVID + CID + P` 身份提交给既有唯一队列。队列将“本地转写 / 文稿归档”与“DeepSeek 总结”拆成两条互不阻塞的本地状态流，同时经主进程序列执行器与收藏整理共用一次一个的 DeepSeek 请求通道。档案身份对新精确 P 使用 `account + aid + cid`，旧条目按旧 ID 保持可读。

**Tech Stack:** Electron、TypeScript、React 19、Vitest、electron-vite。

---

## 文件与职责

| 文件 | 责任 |
| --- | --- |
| `src/shared/types.ts` | P 元数据、分 P 选择项和独立总结排队状态的跨进程类型。 |
| `src/shared/videoNotes.ts`、`src/shared/videoNoteArchive.ts` | 新精确 P 档案 ID 与旧档案兼容规则。 |
| `src/shared/*.test.ts` | 分 P 身份与档案隔离的纯函数回归。 |
| `electron/main/videoTranscriptionQueue.ts` | 本地转写串行、文稿先归档、总结单独串行并可取消/重试。 |
| `electron/main/videoTranscriptionQueue.test.ts` | 转写与总结并行及精准回写的状态机回归。 |
| `electron/main/deepSeekTaskQueue.ts` | 进程内、可取消的 DeepSeek 单请求执行器。 |
| `electron/main/deepSeekTaskQueue.test.ts` | 单通道和等待时取消的回归。 |
| `electron/main/index.ts` | 将札记总结和掌库 DeepSeek 整理接到同一执行器；保留账号校验。 |
| `src/renderer/src/features/notes/videoNoteMultipart.ts` | 当前页面 P 清单的纯校验与页面读取脚本。 |
| `src/renderer/src/features/notes/videoNoteMultipart.test.ts` | URL `p`、缺字段和页面 P 清单的解析回归。 |
| `src/renderer/src/App.tsx` | 读取当前页精确 P、批量入队、按来源 URL 跳转准确分 P。 |
| `src/renderer/src/features/notes/VideoNotesPanel.tsx` | 单 P / 多 P 下拉、临时选择面板、队列标题跳转和真实总结状态。 |
| `src/renderer/src/features/notes/VideoNotesPanel.test.tsx` | 用户界面模式、默认不勾选、全选及提交边界。 |
| `src/renderer/src/styles.css` | 与“投币厚赏”一致的窄下拉卡片和多 P 面板布局。 |
| `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx` | 收藏库所有转写入口在创建任务时传入自动总结设置快照。 |
| `docs/项目功能项目书.md`、需求账本 | 设计事实、实施证据与原文审计。 |

## Task 1：精确 P 身份与档案隔离（R005–R009）

**Files:**

- Modify: `src/shared/types.ts`, `src/shared/videoNotes.ts`, `src/shared/videoNoteArchive.ts`
- Test: `src/shared/videoNotes.test.ts`, `src/shared/videoNoteArchive.test.ts`

- [ ] **Step 1: Write failing tests for distinct CID archive identity**

```ts
it('creates separate archive entries for different CIDs of the same video', () => {
  const p1 = createNote({ source: { ...baseSource, accountMid: '42', aid: 7, cid: 70 } })
  const p2 = createNote({ source: { ...baseSource, accountMid: '42', aid: 7, cid: 71 } })
  expect(appendVideoNoteArchiveVersion(
    appendVideoNoteArchiveVersion([], p1, firstAt), p2, secondAt
  )).toHaveLength(2)
})
```

- [ ] **Step 2: Run the focused tests and observe failure**

Run: `npm test -- src/shared/videoNoteArchive.test.ts src/shared/videoNotes.test.ts`

Expected: the new test fails because both CIDs currently select `bvid:<bvid>`.

- [ ] **Step 3: Add P metadata and a precise archive-ID helper**

Add optional `partNumber`, `partTitle`, and `partDurationSeconds` to source/request types. Make `createVideoNoteId()` return `account:<mid>:aid:<aid>:cid:<cid>` only when all precise new-task identities exist; retain the present BVID/URL calculation for legacy source objects.

- [ ] **Step 4: Make the archive append path use the precise helper**

Keep legacy archives readable and untouched. Same account/AID/CID appends versions to one entry; differing CID creates a distinct entry.

- [ ] **Step 5: Run focused tests and mark evidence**

Run: `npm test -- src/shared/videoNoteArchive.test.ts src/shared/videoNotes.test.ts`

Expected: PASS, including the existing legacy BVID grouping test.

## Task 2：当前页面 P 清单的纯解析与防误入队（R003–R004、R006、R008–R013）

**Files:**

- Create: `src/renderer/src/features/notes/videoNoteMultipart.ts`, `src/renderer/src/features/notes/videoNoteMultipart.test.ts`
- Modify: `src/renderer/src/features/notes/videoNoteExtractor.ts`, `src/renderer/src/App.tsx`

- [ ] **Step 1: Write failing parser tests**

```ts
expect(resolveMultipartVideo({ url: 'https://www.bilibili.com/video/BV1?p=2', pages })).toEqual({
  aid: 7, bvid: 'BV1', currentPart: expect.objectContaining({ number: 2, cid: 71 }), parts: expect.any(Array)
})
expect(() => resolveMultipartVideo({ url: 'https://www.bilibili.com/video/BV1?p=99', pages })).toThrow('当前分 P 无效')
```

- [ ] **Step 2: Run test and observe failure**

Run: `npm test -- src/renderer/src/features/notes/videoNoteMultipart.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure validator and browser script**

Validate positive safe AID/CID/P and nonblank title; parse `p` from the current URL and index `pages[p - 1]`, not `videoData.cid`. Return error states rather than falling back to P1 when `p` is present but invalid. The browser script only reads page state; it does not make B 站 network requests.

- [ ] **Step 4: Update current single-P extraction and queue input**

Carry AID/CID/current P data through normalization, and include identity fields in `enqueueRuntimeVideoAudioTranscription()`. Preserve current behaviour for legacy or non-video pages.

- [ ] **Step 5: Run parser and extractor regression tests**

Run: `npm test -- src/renderer/src/features/notes/videoNoteMultipart.test.ts src/renderer/src/features/notes/videoNoteExtractor.test.ts`

Expected: PASS.

## Task 3：队列先归档、总结独立排队（R002–R004、R014）

**Files:**

- Modify: `electron/main/videoTranscriptionQueue.ts`, `electron/main/index.ts`, `src/shared/types.ts`
- Test: `electron/main/videoTranscriptionQueue.test.ts`

- [ ] **Step 1: Write failing queue tests for pipeline independence**

```ts
it('starts the next local transcription while the previous archived note is summarized', async () => {
  // P1 transcription settles, its summary remains deferred, then P2 starts.
  expect(transcribe).toHaveBeenCalledTimes(2)
  expect(saveArchiveVersion).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ cid: 70 }) }), '')
})
```

Also add tests that a canceled summary leaves its exact archived transcript intact, and a summary writes only to its registered `{ archiveId, versionId }`.

- [ ] **Step 2: Run test and observe failure**

Run: `npm test -- electron/main/videoTranscriptionQueue.test.ts`

Expected: the second transcription has not started because the current `processing` lock wraps summary generation.

- [ ] **Step 3: Split the local-transcription and summary workers**

On transcription success: save an empty-summary archive version first, complete the local job, then queue a separate `summaryStatus: 'queued'` job. Keep one local `processing` lock and one summary worker/controller. A summary cannot change its item to local `running`; it keeps its completed transcript state and independently reports summary progress.

- [ ] **Step 4: Preserve cancel, retry and account protections**

Cancel summary only aborts that summary; retry summary rereads its exact immutable archive version. `cancelAllAndWait()` waits for both workers. Archive-registration failure remains retryable without a second download.

- [ ] **Step 5: Run focused queue suite**

Run: `npm test -- electron/main/videoTranscriptionQueue.test.ts electron/main/transcriptionQueueAccountGuard.test.ts`

Expected: PASS.

## Task 4：共享 DeepSeek 单通道（R003、R019）

**Files:**

- Create: `electron/main/deepSeekTaskQueue.ts`, `electron/main/deepSeekTaskQueue.test.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write failing serial-executor tests**

```ts
await Promise.all([queue.run(first), queue.run(second)])
expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
```

Include a queued task whose signal aborts before its turn and assert its callback never starts.

- [ ] **Step 2: Run test and observe failure**

Run: `npm test -- electron/main/deepSeekTaskQueue.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the small cancellation-aware serialized executor**

The executor runs one `generateDeepSeekResult()` call at a time and always releases its slot. It does not persist state or alter B 站 data.

- [ ] **Step 4: Wire note summaries and old-favorite organizer requests through it**

Wrap only the actual external generation calls. Retain each subsystem’s own cancellation/checkpoint/error logic, so summary and organizer work have one request at a time but no shared mutable workspace state.

- [ ] **Step 5: Run queue and organizer regressions**

Run: `npm test -- electron/main/deepSeekTaskQueue.test.ts electron/main/videoTranscriptionQueue.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

Expected: PASS.

## Task 5：札记 UI、临时 P 面板与准确来源跳转（R001、R010–R018）

**Files:**

- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`, `src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert: default select value is `single`; changing it alone calls no enqueue; a successful multi-P scan opens a list with no checked P; `全选` excludes busy/archived rows; empty selection disables `加入转写队列`; clicking a queue-title control calls the precise source opener but clicking the enclosing selection control does not.

- [ ] **Step 2: Run test and observe failure**

Run: `npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/App.test.tsx`

Expected: FAIL because the dropdown, temporary panel and title/source callback do not exist.

- [ ] **Step 3: Render the narrow `单 P / 多 P` select beside the existing primary action**

Reuse the existing memorial action-card markup/CSS geometry, but hold mode in local component state. Stop pointer/click propagation from the select; reset the mode on source identity change, cancel, completion and component remount.

- [ ] **Step 4: Implement the temporary selection dialog**

Use `BilimiModal`, show scan progress without blocking the browser window, show `重试` and `返回` on parser failure, and only call a batch enqueue callback from `加入转写队列`. Derive busy/archived states from the authoritative queue snapshot and archives supplied to the panel.

- [ ] **Step 5: Implement exact title navigation**

Add a dedicated title button/callback. In `App.tsx`, match existing tabs by exact normalized `?p=N` source before opening a new tab; retain the existing timestamp seeking behaviour and never use an invalid URL.

- [ ] **Step 6: Run focused UI tests**

Run: `npm test -- src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/App.test.tsx src/renderer/src/styles.test.ts`

Expected: PASS.

## Task 6：收藏库自动总结设置快照（R002、R019）

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`, `electron/main/favoriteLibraryCommands.test.ts`

- [ ] **Step 1: Write failing tests for a collection-library enqueue payload**

Assert that list-row, detail and batch transcription calls include `summarizeWithDeepSeek: deepSeekEnabled && deepSeekAutoSummaryEnabled` when creating new jobs.

- [ ] **Step 2: Run tests and observe failure**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteLibraryCommands.test.ts`

Expected: FAIL because existing UI calls omit the option and the command defaults it to false.

- [ ] **Step 3: Pass the one-time preference snapshot through every collection-library start path**

Do not change the default used for older external callers; each renderer action supplies the explicit boolean at the moment the user starts work.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteLibraryCommands.test.ts`

Expected: PASS.

## Task 7：full verification, Electron 验收、账本和提交（R020）

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-19-transcription-queue-and-multipart-capability.md`

- [ ] **Step 1: Run static and automated verification**

Run: `npm test` then `npm run build`, followed by `git diff --check`.

Expected: all focused and full tests/build pass; no whitespace errors.

- [ ] **Step 2: Launch Electron development mode and perform protected-path QA**

Run: `npm run dev`.

Verify a public multi-P page: default `单 P`, selecting `多 P` does nothing until the primary card is clicked, list starts unselected, P1/P2 enter separately, queue title opens exact P, and window mouse movement/click/scroll/resize/minimize/close remain responsive during a pending summary. Also verify a single-P page, legacy archive visibility, collection-library row/detail/batch starts, and ordinary archive source opening.

- [ ] **Step 3: Record per-index evidence**

Write code locations, test commands/results and Electron conditions for I001, I002, I005, I008–I015; identify any unverified external DeepSeek/B 站 condition honestly.

- [ ] **Step 4: Final repository checks and one local commit**

Run: `git status --short`, `git diff --stat`, `git diff --check`, `git status --short --branch`.

Stage only this topic’s source, tests, project book and ledger; create one local `main` commit. Do not push, merge, rebase, reset or mutate B 站 data.

## Plan self-review

- **Coverage:** I001 maps to Task 5; I002/I014 map to Tasks 3–4/6; I003/I004/I006 set explicit Task 2 non-expansion boundaries; I005 maps to Task 1; I008–I013 map to Task 5; I015 maps to Task 7.
- **Explicit exclusions:** no basic favorite scan field expansion, no collection-library automatic P enumeration, no old archive automatic splitting, no B 站 writes.
- **Cross-system risks:** queue persistence, archive migration compatibility, source-tab reuse, DeepSeek contention, cancel/retry, favorite-library start routes, and Electron responsiveness each have a dedicated test or QA step.

## Implementation record — 2026-08-19

- [x] Task 1 — 新精确 `account + aid + cid` 档案身份已经实现；旧 BVID/URL 条目保持原身份可读，未自动拆分。
- [x] Task 2 — 当前已打开视频页的只读分 P 解析、准确 `?p=N` 来源和基础单 P 资料透传已经实现；没有扩展基础收藏扫描。
- [x] Task 3 — 文稿先归档、总结独立串行 worker、取消/重试精确回写已经实现。
- [x] Task 4 — 札记总结与掌库 DeepSeek 整理已接入同一可取消单通道。
- [x] Task 5 — 窄下拉、临时多 P 选择面板、精确来源标题跳转已实现。
- [x] Task 6 — 收藏库详情、批量、列表行新建转写均在点击时快照自动总结设置。
- [ ] Task 7 — 自动化与构建验证已完成；Electron 仅完成指定多 P 公开页的只读加载和当前视频识别。用户在札记入口点击前接管窗口，故剩余多 P 弹窗、标题跳转、收藏库三入口和总结期间响应性必须由后续人工实机验收。
