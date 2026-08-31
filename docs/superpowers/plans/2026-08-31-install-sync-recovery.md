# 安装版同步恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复安装版同步计划冻结、远端候选删除刷新和确认窗口反馈，并把 B 站首页 guest WebView 移出首屏交互关键路径。

**Architecture:** marker 以轻量 manifest 引用校验，不信任松散缓存；所有已确认远端删除复用同一账号投影收尾。同步准备始终留在一个模态框中。首页标签可先显示，首页 WebView 只在首屏可交互后的空闲阶段或用户浏览动作中挂载。

**Tech Stack:** Electron、TypeScript、React、Vitest、Testing Library、electron-vite。

---

### Task 1: 文档与范围

**Files:**
- Modify: `docs/项目功能项目书.md:50-51, 4.1, 5.8`
- Modify: `docs/requirement-ledgers/2026-08-31-install-sync-bilibili-discussion.md`
- Create: `docs/superpowers/plans/2026-08-31-install-sync-recovery.md`

- [x] **Step 1: 先更新项目书**

已写入四项不变式：关系 overlay 保留 `currentSegmentId`；marker 同时校验活动分段、overlay revision、journal cursor 和 checksum；候选/草稿远端删除也走成功 ID 的同一账号收尾；同步准备状态只在当前确认窗口中显示；首页 guest WebView 不与首屏创建处于同一阻塞任务。

- [x] **Step 2: 固定审计边界**

本轮仅允许修改：

```text
electron/main/oldFavoriteWorkspaceCoordinator.ts
electron/main/oldFavoriteWorkspaceCoordinator.test.ts
src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx
src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx
src/renderer/src/App.tsx
src/renderer/src/App.test.tsx
```

不得修改 DeepSeek、转写、删除确认知情语义、视频同步执行或单个备册入口。

### Task 2: 工作区关系投影和 marker

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:10720-10820`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:6101, 6633, 7557, 8053`

- [x] **Step 1: 写入失败测试：关系刷新后仍可冻结**

完成多批扫描并选中 `segment-2`，调用关系刷新后冻结空计划，断言 marker 保留活动分段：

```ts
await coordinator.selectSegment('100', 'segment-2')
await coordinator.refreshRelationshipProjection('100')
await expect(coordinator.freezeForBilibiliExecution('100')).resolves.toMatchObject({ status: 'frozen' })
expect((await repository.getSnapshot('100')).workspace?.workspaceRef.currentSegmentId).toBe('segment-2')
```

- [x] **Step 2: 写入失败测试：manifest 变更不复用旧缓存**

直接追加具有新来源元数据的 overlay 而不写 repository marker；同一 coordinator 的 `getSnapshot()` 必须恢复并显示新来源：

```ts
await store.appendOverlay('100', workspaceId, {
  currentSegmentId: 'segment-1', classifications: [], history: [],
  scanMetadata: { sourceFolders: [{ id: 'fresh', title: 'Fresh', itemCount: 1, isBilimiWorkFolder: false }] }
})
await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({ sourceFolders: [{ id: 'fresh', title: 'Fresh' }] })
```

- [x] **Step 3: 验证 RED**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: 新增测试分别因空活动批次和陈旧内存投影失败。

- [x] **Step 4: 最小实现**

`refreshRelationshipProjectionUnsafe()` 用 `this.currentSegment(workspace)` 写 overlay。把 `matchesMarker()` 改为异步轻量校验：先比较 ID、账号、状态、baseline，再调用 `workspaceStore.readRecoverySummary()` 比较活动分段、overlay revision、journal cursor 和 checksum；读取失败或任一失配返回 false。`openUnsafe()` 和 `requireWorkspace()` await 该校验；不读取完整 journal，保留 `restoreFromStore()` 的完整性保护。

- [x] **Step 5: 验证 GREEN**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS。

### Task 3: 候选远端删除收尾

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:143-210`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:4035-4084`

- [x] **Step 1: 写入失败测试**

模拟 `deleteManagedRemoteFolders()` 返回成功 ID 与失败 ID，调用候选删除入口后回调只接收成功 ID：

```ts
await coordinator.deleteManagedRemoteFolderCandidates('100', ['draft'], false, undefined, undefined, {
  draft: { remoteFolderId: '9001', title: 'bilimi·草稿' }
})
expect(onManagedFolderDeletion).toHaveBeenCalledWith('100', [{
  logicalLedgerId: 'draft', remoteFolderIds: ['9001'], remoteDeleted: true
}])
```

- [x] **Step 2: 验证 RED**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: 失败原因是候选路径没有调用 `onManagedFolderDeletion`。

- [x] **Step 3: 最小实现**

提取“从 `candidates` 和 `succeededRemoteFolderIds` 构造 confirmed deletions”的私有 helper。两个删除入口均调用 helper，且仅对 confirmed 列表调用既有回调。不修改同步服务、候选确认或本地规则删除语义。

- [x] **Step 4: 验证 GREEN**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS，现有部分成功测试继续确认只收尾成功 ID。

### Task 4: 单一同步确认窗口反馈

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx:3310-3395`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:1200-1700`

- [x] **Step 1: 写入失败测试**

令 `onSyncLedgers` 返回 deferred Promise。点击“确认备册并继续”后，同一个 dialog 完成前必须有 `role="status"`：

```tsx
const confirmation = await screen.findByRole('dialog', { name: '同步前备册确认' })
fireEvent.click(within(confirmation).getByRole('button', { name: '确认备册并继续' }))
expect(await within(confirmation).findByRole('status')).toHaveTextContent('正在按确认范围备册收藏夹。')
```

- [x] **Step 2: 验证 RED**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 失败，因为状态只传给被遮罩的 `OldFavoriteGuide`。

- [x] **Step 3: 最小实现**

在现有 `OldFavoriteModal` 正文渲染 `confirmationPreparationStatus` 为 `role="status"`，保留错误为 `role="alert"`；存在 `bilibiliBackupPreflight` 时不把同一临时状态传给 `OldFavoriteGuide`。不得新增或关闭模态框，也不得改变备册/确认调用顺序。

- [x] **Step 4: 验证 GREEN**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: PASS。

### Task 5: 首页 WebView 首屏隔离

**Files:**
- Modify: `src/renderer/src/App.test.tsx:354-385`
- Modify: `src/renderer/src/App.tsx:753-760, 848-860, 1057-1080, 1308-1311, 3802-3820`

- [x] **Step 1: 写入失败测试**

导出无副作用决策 helper。生产运行时首页首屏不挂载；显式激活首页或新标签总挂载；测试运行时仍立即挂载：

```ts
expect(shouldMountBrowserTab('home', false, false)).toBe(false)
expect(shouldMountBrowserTab('home', true, false)).toBe(true)
expect(shouldMountBrowserTab('video-1', false, false)).toBe(true)
expect(shouldMountBrowserTab('home', false, true)).toBe(true)
```

- [x] **Step 2: 验证 RED**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: helper 不存在或首页尚无延后状态。

- [x] **Step 3: 最小实现**

增加 `homeWebviewActivated` 状态。测试运行时初始 true；生产运行时在首屏稳定后的 idle callback/有界 fallback timer 才置 true。选择首页、刷新首页、点击浏览区或打开内部标签时立即置 true。首页标签不变；首页 WebView 根据该状态延后，新视频页始终立即挂载。清理 idle/timer，保持刷新、标签、页面桥和 active WebView 语义。

- [x] **Step 4: 验证 GREEN**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: PASS。

### Task 6: 回归、只读验收与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-31-install-sync-bilibili-discussion.md`

- [x] **Step 1: 运行聚焦测试**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`; `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`; `npm test -- src/renderer/src/App.test.tsx`.

Expected: PASS。

- [x] **Step 2: 运行全量门禁**

Run: `npm test`; `npm run build`; `git diff --check`; `git diff --stat`; `git status --short`.

Expected: 测试与构建退出码 0，且只含本轮 docs、代码与测试。

- [ ] **Step 3: Electron 只读验收**

启动开发版，验证首页首屏、鼠标移动、点击、滚动、缩放、最小化和关闭保持响应；验证同步确认窗口内状态位置；不点击任何会创建、绑定、删除或同步 B 站的按钮。截图存入 `.codex-artifacts/`。

- [x] **Step 4: 回填账本并提交**

逐项回填 R001-R003 的代码位置、自动化测试、截图与真实远端副作用未验证条件；选择性提交项目书、账本、计划、本轮代码和测试，不混入构建产物或其他主题。
