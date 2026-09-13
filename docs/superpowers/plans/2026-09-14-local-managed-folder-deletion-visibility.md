# 本地工作夹删除可见性与状态投影实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让收藏库本地工作夹删除不立即反弹，左右备册状态一致，并保留既有右侧备册与远端删除边界。

**Architecture:** 主进程的空壳恢复器记录“删除动作紧随的一次本地摘要读取”并只跳过这一次恢复；之后的独立本地活动仍复用原恢复链。收藏库摘要以持久化右侧规则状态补足物理分册证据，标题模型只返回显示状态而非跳转操作。远端删除继续只在已确认成功时由现有持久化投影清除正式绑定。

**Tech Stack:** Electron 主进程、React、TypeScript、Vitest。

---

### Task 1: 删除后的单次恢复抑制（I001 / R001、R004）

**Files:** `electron/main/favoriteRepositoryEmptyManagedFolderRecovery.ts`、`electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`

- [x] 写失败测试：`managed-folder:delete-local:*` 变更后，紧随的 `restoreForLocalRead()` 不创建 `bilimi-logical:music`；再一次独立 `restoreForLocalRead()` 才创建空壳。
- [x] 运行 `npm test -- electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`，确认新增断言因当前立即恢复而失败。
- [x] 在恢复器中按账号记录并消费一次删除后的本地读取抑制；仅匹配受管删除命令，保留普通仓库活动恢复和所有 B 站隔离边界。
- [x] 重新运行该测试，确认通过。

### Task 2: 左右备册状态与标题入口（I002、I003 / R002）

**Files:** `electron/main/index.ts`、`src/renderer/src/features/favorites/favoriteLibraryModel.ts`、`src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`、`src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`、`src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] 写失败测试：持久化规则为 `bindingState: 'unbound'` 且无正式物理分册时，收藏库摘要状态为 `unbound`；标题模型不含“去掌库收藏夹设置保存后绑定”动作。
- [x] 运行相应 Vitest 文件，确认新增断言失败。
- [x] 最小实现：摘要把右侧规则的明确未绑定状态传给共享状态决策；标题移除该动作标签和跳转，仅保持“恢复当前收藏夹”分支。
- [x] 重新运行相应测试，确认通过；检查右侧“备册当前收藏夹”代码路径未改动。

### Task 3: 远端删除状态收束回归（I004 / R002、R003）

**Files:** `electron/main/managedFavoriteLedgerDeletionPersistence.test.ts`、`electron/main/favoriteRepositoryIpc.test.ts`

- [x] 写失败测试：远端删除成功返回的摘要投影为 `unbacked`，纯本地、失败或未知不改现有规则状态。
- [x] 运行相应 Vitest 文件，确认新增测试在缺少覆盖时失败或暴露不一致。
- [x] 仅在测试证明确有缺口时修改持久化/通知代码；不添加 B 站读取、重试或写入。
- [x] 运行目标测试和关联回归。

### Task 4: 收束与验收（I001-I004）

**Files:** `docs/requirement-ledgers/2026-09-14-local-managed-folder-deletion-visibility.md`

- [x] 运行 `git diff --check`、相关 Vitest、`npm test`、`npm run build`。
- [x] 在开发版和预览版检查删除后不反弹、状态文案、右侧备册入口、远端删除成功后的未备册；若桌面自动化不可用，记录阻碍而不把自动测试伪称为真实界面验收。
- [x] 将账本逐条补充实际代码位置和验收结果，并只提交本轮文件。
