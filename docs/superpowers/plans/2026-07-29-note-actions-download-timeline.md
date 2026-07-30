# 札记操作、下载弹窗与时间线播放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一札记与收藏库的复制、下载和时间线交互，并将重复视频转写记录按最新优先平铺。

**Architecture:** 保留现有导出服务和 `VideoNoteBatchExportDialog` 状态模型，只统一触发入口并把弹窗提升为应用级固定遮罩。播放行为集中在 `buildSeekVideoTimeScript`，队列平铺只调整 `VideoNotesPanel` 的派生展示数据。

**Tech Stack:** React 19、TypeScript、Electron webview、Vitest、Testing Library

---

### Task 1: 统一复制与下载入口

**Files:**
- Modify: `src/renderer/src/features/notes/CopySplitButton.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteArchivePanel.test.tsx`

- [ ] 新增失败测试：复制为单一展开按钮；下载为单一按钮且只调用打开弹窗回调。
- [ ] 运行对应组件测试并确认因旧分裂按钮行为失败。
- [ ] 最小实现普通复制下拉按钮和普通下载按钮。
- [ ] 重跑对应测试并确认通过。

### Task 2: 将导出弹窗改为应用中央模态

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNoteBatchExportDialog.tsx`
- Modify: `src/renderer/src/features/notes/VideoNoteBatchExportDialog.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] 新增失败测试：弹窗具有遮罩、中央模态结构、Escape/遮罩关闭和导出中禁止关闭。
- [ ] 运行弹窗与样式测试并确认失败原因正确。
- [ ] 使用 portal 将遮罩挂到 `document.body`，补齐 dialog 语义和关闭约束。
- [ ] 重跑弹窗与样式测试并确认通过。

### Task 3: 统一收藏库下载入口

**Files:**
- Modify: `src/renderer/src/features/notes/VideoSummaryMenu.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx`

- [ ] 新增失败测试：下载文稿是直接动作，不再打开格式子菜单，默认格式由中央弹窗管理。
- [ ] 运行收藏库和队列测试并确认旧子菜单导致失败。
- [ ] 调整 `VideoSummaryMenu` 下载契约及各调用点，点击时直接打开导出弹窗。
- [ ] 重跑相关测试并确认通过。

### Task 4: 时间线定位后自动播放

**Files:**
- Modify: `src/renderer/src/features/notes/videoNoteTimeAutomation.test.ts`
- Modify: `src/renderer/src/features/notes/videoNoteTimeAutomation.ts`
- Modify: `src/renderer/src/features/browser/BiliWebview.test.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [ ] 新增失败测试：暂停视频定位完成后调用 `play()`，播放拒绝时保留定位并返回 false。
- [ ] 运行自动化测试并确认当前“保留播放状态”行为导致失败。
- [ ] 修改统一定位脚本为设置时间后主动播放，并安全处理播放拒绝。
- [ ] 重跑自动化、webview 与 App 测试并确认通过。

### Task 5: 平铺同视频转写记录

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] 新增失败测试：同视频多条记录全部可见、最新在上、无历史记录按钮。
- [ ] 运行队列测试并确认当前分组折叠导致失败。
- [ ] 删除分组和展开状态，按 `updatedAt` 倒序渲染全部非活动记录。
- [ ] 删除不再使用的历史按钮样式并重跑测试。

### Task 6: 综合验证

**Files:**
- Verify only

- [ ] 运行定向 Vitest 测试文件。
- [ ] 运行 `npm test`。
- [ ] 运行 `npm run build`。
- [ ] 检查 `git diff --check` 与目标文件差异，确认没有覆盖无关基线改动。
