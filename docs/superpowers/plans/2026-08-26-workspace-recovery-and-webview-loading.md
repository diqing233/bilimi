# 工作区恢复与 WebView 初始加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除备册开始时 journal 读写交错造成的误报恢复失败，并让已完成初始加载的新 B 站标签不再永久显示整页遮罩。

**Architecture:** `OldFavoriteWorkspaceStore.recover()` 复用既有序列化写队列，保证恢复读取只看完成的 manifest/journal 边界；渲染器只对恢复快照做一次后台重读，成功时恢复正常 UI、真实损坏仍保留重建提示。`BiliWebview` 在监听器就绪后探测已分配且不再 loading 的 WebView，作为错过 `did-finish-load` 的收束信号。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library。

---

### Task 1: 工作区恢复稳定边界与自愈

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts:614-836`
- Test: `electron/main/oldFavoriteWorkspaceStore.test.ts`
- Modify: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts:364-420,1117-1129`
- Test: `src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

- [x] **Step 1: 写 RED 测试**

```ts
const writing = store.appendOverlay('100', 'workspace-1', overlay)
const recovered = store.recover('100', 'workspace-1')
await expect(recovered).resolves.toMatchObject({ classifications: { '1': { targetLedgerIds: ['music'] } } })
await writing

mockOpen.mockResolvedValueOnce(rebuildRequired).mockResolvedValueOnce(healthySnapshot)
// advance the one bounded recovery retry; expect the healthy snapshot.
```

- [x] **Step 2: 验证 RED**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceStore.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

Expected: 新用例分别读到旧快照、保留 `rebuild-required`，证明当前没有稳定读/自愈。

- [x] **Step 3: 最小实现**

```ts
async recover(accountMid: string, workspaceId: string) {
  return this.queue(() => this.recoverUnsafe(accountMid, workspaceId))
}

// Keep the existing recovery body in recoverUnsafe().
```

```ts
useEffect(() => {
  if (!snapshot || !('recovery' in snapshot)) return
  const timer = window.setTimeout(() => void refresh(true), 250)
  return () => window.clearTimeout(timer)
}, [refresh, snapshot])
```

- [x] **Step 4: 验证 GREEN**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceStore.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

Expected: 全部通过；真实损坏 journal 的既有测试仍为 `rebuild-required`。

### Task 2: WebView 初始加载收束

**Files:**
- Modify: `src/renderer/src/features/browser/BiliWebview.tsx:220-345`
- Test: `src/renderer/src/features/browser/BiliWebview.test.tsx`

- [x] **Step 1: 写 RED 测试**

```ts
render(<BiliWebview active ... />)
// The mock guest already has an id and isLoading() is false; do not dispatch did-finish-load.
await advanceTimersByTimeAsync(0)
expect(screen.queryByRole('status', { name: 'B 站页面加载中' })).toBeNull()
```

- [x] **Step 2: 验证 RED**

Run: `npx vitest run src/renderer/src/features/browser/BiliWebview.test.tsx`

Expected: 失败，当前代码只在 `did-finish-load` 后清除 `loading`。

- [x] **Step 3: 最小实现**

```ts
const settleInitialLoadIfReady = () => {
  if (typeof webview.getWebContentsId?.() !== 'number' || webview.isLoading?.() !== false) return
  handleLoadSuccess()
}
window.setTimeout(() => { reportTargetState(); settleInitialLoadIfReady() }, 0)
```

- [x] **Step 4: 验证 GREEN**

Run: `npx vitest run src/renderer/src/features/browser/BiliWebview.test.tsx`

Expected: 全部通过；导航开始仍显示加载反馈，`did-fail-load` 仍显示原有失败卡。

### Task 3: 账本、Electron 只读验收与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-26-backup-continuation-and-browser-loading.md`
- Create: `.codex-artifacts/2026-08-26-workspace-recovery-webview-loading.png`

- [x] **Step 1: Electron 只读验收**

启动开发版；只读检查工作区不再误报损坏、新标签的加载遮罩会消失，以及网络失败卡仍可见。不得点击备册、创建、绑定、删除或视频写入。

- [x] **Step 2: 完整验证**

Run: `npm test`, `npm run build`, `git diff --check`, `git diff --stat`, `git status --short`.

Expected: 全绿；若 Electron 无法安全触发真实备册路径，账本明确记录该验收缺口。

- [ ] **Step 3: 选择性提交**

只提交本计划、当前需求账本、两个生产文件及其测试；不暂存 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`。
