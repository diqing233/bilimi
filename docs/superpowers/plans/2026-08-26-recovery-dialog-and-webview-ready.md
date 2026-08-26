# 恢复弹窗与 WebView 就绪遮罩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作镜像需重建状态投影为项目书规定的中文重建路径，并确保已经可交互的 B 站主页面不会被加载遮罩永久覆盖。

**Architecture:** 恢复准备在发现 `rebuild-required` 快照后立即返回结构化恢复摘要，不再进入依赖完整工作镜像的扫描、DeepSeek 或同步暂停调用；渲染器只把结构化摘要投影为恢复三选项或重建入口，未知准备失败也只显示中文可重试信息。WebView 加载反馈使用主页面就绪事件收束 `loading`，而非永久等待不保证抵达的 finish 事件；主框架失败卡、标签和会话逻辑保持原样。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library。

---

### Task 1: 重建状态的结构化恢复准备与中文故障投影

**Files:**

- Modify: `electron/main/index.ts:2517-2534`
- Test: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:746-802,1358-1362`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 1: 写 RED 测试**

```ts
it('returns the structured rebuild summary without asking recovery workers to pause', async () => {
  const rebuild = {
    recovery: 'rebuild-required' as const,
    preserveCompletedLocalResults: true as const,
    accountMid: '100', workspaceId: 'workspace-100'
  }
  // prepare-recovery sees rebuild, does not call scan/DeepSeek/sync pause,
  // and resolves the coordinator recovery summary with recoveryChoices: ['view'].
})

it('does not expose an IPC recovery error in the organization dialog', async () => {
  window.bilimiDesktop = {
    prepareOldFavoriteWorkspaceRecoveryV1: vi.fn()
      .mockRejectedValue(new Error("Error invoking remote method 'old-favorite-workspace-v1:prepare-recovery': Error: Old favorite workspace requires rebuild."))
  } as typeof window.bilimiDesktop
  // Click 整理收藏; expect Chinese recovery-preparation text and no English error/method name.
})
```

- [x] **Step 2: 验证 RED**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 结构化重建短路和中文错误断言均失败；旧实现会继续调用恢复暂停链，且渲染原始 English error。

- [x] **Step 3: 最小实现**

```ts
const before = await oldFavoriteWorkspaceCoordinator!.getSnapshot(accountMid)
if (!before) return null
if ('recovery' in before) {
  return oldFavoriteWorkspaceCoordinator!.getRecoverySummary(accountMid)
}
// only a complete workspace enters scan/DeepSeek/sync pause preparation
```

```ts
function recoveryPreparationFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  if (detail.includes('requires rebuild')) return '工作镜像暂时无法恢复，请重新打开整理收藏。'
  return '整理草稿准备失败，请重试。'
}
```

Render the mapped Chinese text and label the retry action `重新尝试`; preserve the normal three recovery actions exclusively for structured recoverable summaries. Do not trigger rebuild, scanning, DeepSeek, or B 站 writes automatically.

- [x] **Step 4: 验证 GREEN**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: all selected tests pass; recoverable summaries still show `恢复草稿`、`重新扫描`、`放弃本轮整理`; recovery-required returns the existing Chinese scan-overview rebuild path.

### Task 2: 已可用主页面的加载遮罩收束

**Files:**

- Modify: `src/renderer/src/features/browser/BiliWebview.tsx:263-365`
- Test: `src/renderer/src/features/browser/BiliWebview.test.tsx`

- [x] **Step 1: 写 RED 测试**

```tsx
it('clears loading feedback when the active main document becomes ready without a finish event', () => {
  render(<BiliWebview active tabId="video" url="https://www.bilibili.com/video/BV1ready" />)
  const webview = document.querySelector('webview') as Electron.WebviewTag

  act(() => webview.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true })))
  act(() => webview.dispatchEvent(new Event('dom-ready')))

  expect(screen.queryByRole('status', { name: 'B 站页面加载中' })).not.toBeInTheDocument()
})
```

- [x] **Step 2: 验证 RED**

Run: `npx vitest run src/renderer/src/features/browser/BiliWebview.test.tsx`

Expected: the new test fails because current `dom-ready` only reports target state and leaves `loading` true without `did-finish-load`.

- [x] **Step 3: 最小实现**

```ts
const handleDomReady = () => {
  reportTargetState()
  handleLoadSuccess()
}

webview.addEventListener('dom-ready', handleDomReady)
webview.removeEventListener('dom-ready', handleDomReady)
```

Keep `did-start-navigation` limited to the main frame, retain `did-finish-load` for existing link capture/seek completion, and retain `did-fail-load` error-card behavior. Do not change B 站 URLs, session settings, page scripts, or remote behavior.

> 实施补充：真实 Electron 验收显示 `dom-ready` 单独不足以覆盖持续资源加载完成后的遗留遮罩，因此新增并回归覆盖 guest `did-stop-loading` 的同一成功收束；它不改变主框架导航开始或失败卡逻辑。

- [x] **Step 4: 验证 GREEN**

Run: `npx vitest run src/renderer/src/features/browser/BiliWebview.test.tsx`

Expected: the new main-document-ready regression passes together with navigation feedback, initial-race, subframe, proxy-failure, and archived-video regressions.

### Task 3: 账本证据、只读 Electron 验收与本地提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-26-organization-recovery-dialog-chinese.md`
- Modify: `docs/superpowers/plans/2026-08-26-recovery-dialog-and-webview-ready.md`
- Create: `.codex-artifacts/2026-08-26-webview-ready-without-veil.png`

- [x] **Step 1: Electron 只读验收**

启动开发版，打开已有 B 站视频标签或新的只读视频页面，等待正文可见并确认没有“正在加载 B 站页面…”覆盖层；验证普通刷新出现短暂反馈后消失。不得点击备册、绑定、删除、同步、收藏或写入视频。工作镜像真实重建路径不安全触发时，账本明确标为自动化已验收、真实 B 站无副作用路径待验证。

- [x] **Step 2: 完整验证**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/browser/BiliWebview.test.tsx`, `npm test`, `npm run build`, `git diff --check`, `git diff --stat`, `git status --short`.

Expected: all commands exit successfully. Preserve unrelated `pnpm-lock.yaml` and `pnpm-workspace.yaml` without staging them.

- [x] **Step 3: 选择性提交**

Stage only the two production areas, their tests, this plan, and the current ledger; run `git diff --cached --check`, then commit as `fix: restore recovery actions and clear ready webview veil`. Do not stage `pnpm-lock.yaml`, `pnpm-workspace.yaml`, screenshots, or unrelated files.
