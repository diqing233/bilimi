# 收藏库疑似 Bilimi 草稿收藏夹投影

## 原文记录

### R001

时间：2026-09-10

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8da98a93-e148-4c4d-9783-b2215e4064cd.png`

截图目标区域：B 站收藏夹左侧列表中的 `bilimi·哈哈` 与 `bilimi·ok`；待收藏库界面验收其不再归入“其他收藏夹”。

原文：

```text
这两个是疑似的怎么还会放在其他收藏夹
```

### R002

时间：2026-09-10

原文：

```text
扫描概览是扫描概览，收藏库位置是收藏库位置你不要搞错了
```

### R003

时间：2026-09-10

原文：

```text
不影响其他效果的同时，只优化这个你的方案是什么
```

### R004

时间：2026-09-10

原文：

```text
不用，只是调整草稿收藏夹，放在bilimi工作夹里，别搞得太麻烦
```

### R005

时间：2026-09-10

原文：

```text
开始
```

## 逐项索引

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001, R004 | 将“疑似 Bilimi”的草稿收藏夹从“其他收藏夹”投影到既有“bilimi 工作夹”组内。 | 收藏库左侧导航的收藏夹分组；仅影响 `ambiguous-bilimi-like` 远端收藏夹的显示投影。 | 已有名称规则识别为疑似 Bilimi、但没有正式本地绑定证据时显示在 bilimi 工作夹组；普通 B 站收藏夹继续显示在其他收藏夹。 | 保持现有只读/复制能力；不将草稿提升为正式已绑定工作夹。 | 未写入持久化数据；未迁移；未调用 B 站创建、绑定、改名、删除、同步或其他写入。 | 不调整扫描概览、扫描来源、镜像、候选恢复、备册、绑定判断及其他收藏夹既有行为。 | `resolveFavoriteFolderCapabilities()` 的 `ambiguous-bilimi-like` 身份与收藏库导航分组。 | 已实施，待真实 Electron 界面验收。 | 代码：`src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`、`FavoriteLibraryNavigation.tsx`、`FavoriteLibraryNavigationGroupView.tsx`。自动化：`FavoriteLibraryApp.test.tsx` 新增 `bilimi·哈哈` 在 `workspace`、普通夹在 `bilibili`、疑似项无菜单；完整文件 183/183 通过。主进程摘要：`favoriteRepositoryService.test.ts` 新增 1/1 计数测试并在完整文件 105/105 通过。桌面自动化因 `unsupported Codex auth method: apikey` 无法启动，未做真实截图验收。 |
| R002 | 将“扫描概览”与“收藏库位置”严格隔离。 | 收藏库侧栏显示投影。 | 本轮只处理收藏库位置。 | 无。 | 无 B 站副作用。 | 不以此修改扫描行为。 | 同上。 | 已实施，待真实 Electron 界面验收。 | 差异仅在收藏库导航投影及其侧栏统计；没有修改扫描模块。`FavoriteLibraryApp.test.tsx` 183/183、`favoriteRepositoryService.test.ts` 105/105、`favoriteLedgerCapabilities.test.ts` 6/6 通过。 |
| R003 | 在不影响其他效果的前提下做最小优化。 | 收藏库侧栏分组。 | 仅疑似 Bilimi 草稿受影响。 | 无额外操作。 | 无。 | 维持已存在的“其他收藏夹”和正式 Bilimi 工作夹行为。 | 现有导航项目的 `workspace` / `protected` 分类。 | 已实施，待真实 Electron 界面验收。 | 完整相关测试 294/294 通过；`npm run build` 成功；`git diff --check` 成功。构建保留既有的 Vite dynamic/static import 警告。 |

## 实施计划与执行记录

1. 覆盖 R001、R004：先在 `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx` 写失败用例，要求 `bilimi·哈哈` 位于 `workspace`，普通收藏夹位于 `bilibili`，且疑似项没有菜单。失败原因确认是当前按原始 `kind: 'bilibili'` 归类。
2. 覆盖 R001、R004：在 `FavoriteLibraryApp.tsx` 复用既有 `resolveFavoriteFolderCapabilities()`，仅将 `ambiguous-bilimi-like` 加入现有工作夹投影；在导航项新增 `readOnlyWorkspace`，`FavoriteLibraryNavigationGroupView.tsx` 仅据此抑制疑似远端草稿菜单。未改变本地草稿、暂存或正式工作夹菜单。
3. 覆盖 R001、R003：在 `electron/main/favoriteRepositoryService.ts` 使用同一既有身份计算两个侧栏组的去重视频统计，并在 `favoriteRepositoryService.test.ts` 覆盖 `bilimi·哈哈` 与普通收藏夹各一条视频时的 1/1 统计。
4. 覆盖 R002、R003：验证测试、构建、差异检查；不运行任何 B 站写入操作。真实 Electron 验收尝试受桌面自动化环境认证阻断，保留为待验收事项。
