# 远端收藏夹新鲜观察实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只用绕过 HTTP 缓存的 B 站收藏夹目录响应生成远端观察候选，杜绝已删除候选因旧响应回弹。

**Architecture:** 在收藏夹脚本共享的目录读取入口定义唯一的无缓存请求选项，让状态、备册、绑定预检和分册操作共享它。远端观察投影、弹窗取消语义和本地数据模型保持原样。

**Tech Stack:** TypeScript、Vitest、Electron webview 注入脚本。

---

### Task 1: 目录请求的无缓存回归测试

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] 新增测试：调用 `buildFavoriteLedgerStatusScript()`，捕获 `fetch` 的第二个参数，并断言目录 URL 使用 `{ credentials: 'include', cache: 'no-store' }`。
- [x] 运行：`npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`，确认在实现前因缺少 `cache: 'no-store'` 失败。

### Task 2: 收敛共享目录读取

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] 在 `sharedScriptHelpers()` 中新增 `fetchFreshFavoriteFolderList(mid)`，唯一职责是对 `buildListUrl(mid)` 使用 `{ credentials: 'include', cache: 'no-store' }`。
- [x] 将状态、备册、保存、绑定/改名预检和分册操作的 `created/list-all` 读取替换为该 helper；旧收藏扫描仅为目录读取传入无缓存选项，保留资源请求策略不变。
- [x] 运行 Task 1 测试，确认转绿。

### Task 3: 回归与账本核对

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-09-knowledge-renamed-and-merlin-backup.md`
- Verify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`, `src/renderer/src/App.test.tsx`, `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] 运行收藏夹 API、App、面板相关测试，确认候选仍只由目录响应产生，取消不持久化、草稿不自动创建。
- [x] 运行 `npm run build`、`git diff --check`，并逐项更新 I005 的代码位置和验证证据。
- [ ] 仅提交 Task 1–3 涉及文件和本计划/账本，不纳入本轮前已存在的无关未跟踪文档。
