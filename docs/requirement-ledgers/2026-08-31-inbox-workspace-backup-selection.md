# 收藏库 bilimi 暂存备册候选账本

## 原文区

### R001

时间：2026-08-31

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5e96c443-a369-4ce7-987d-503f37870100.png`

截图目标：左侧“bilimi 工作夹”中红框标出 `bilimi: 暂存`，数量为 `84`；点击“备册工作夹”后出现的“备册 bilimi 工作夹”对话框未列出该项。

原文：

> 讨论收藏库怎么没有bilimi暂存，我点备册工作夹

### R002

时间：2026-08-31

原文：

> 未备册的其他都可以识别，暂存当然应该也可以

## 逐项索引

| 编号 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002 | 恢复默认逻辑收藏夹 `bilimi·暂存` 在“备册 bilimi 工作夹”中作为可选备册目标的资格，与其他未备册工作夹一致；不能把仅承载本地成员的 `local:inbox` 误当作远端实体。 | 收藏库左侧工作夹投影；“备册 bilimi 工作夹”对话框候选列表。 | 即使暂存默认不写视频、当前归属为 0 或尚未已有逻辑工作夹投影，也须以保存且启用的稳定规则 ID `inbox` 出现在备册范围；远端草稿仍排除。 | 用户选择后仅走现有首册创建/同名候选绑定确认；备册不上传暂存中的视频。 | 只在用户确认后执行既有 B 站创建或绑定；不执行视频写入、删除、移动或隐式认领。 | 不改应用数据、收藏整理、同步、删除确认、DeepSeek、转写、视频同步。 | 本地规则目录、收藏库文件夹投影、备册候选规划、默认暂存规则、相关项目书与契约。 | 已实施待真实远端场景验证 | 诊断：原实现只按 `kind === 'bilimi-logical'` 遍历，遗漏仅有 `local:inbox` 投影的暂存；`favoriteLibraryModel.ts:111-114` 将其显示为 `bilimi·暂存`。实现：`FavoriteLibraryApp.tsx:76-89` 的 `workspaceBackupFolders()` 在存在 `local:inbox` 且缺少逻辑 `inbox` 时补出虚拟逻辑候选，`:1753-1765` 与 `:2263-2264` 共用该集合并继续调用 `ensureFavoriteLedger('bilimi-logical:inbox', { lightweightBackup: true })`；`FavoriteLibraryApp.test.tsx` 新增仅有 `local:inbox` 的回归。自动化：`FavoriteLibraryApp.test.tsx` 154/154、收藏相关组合（`favoriteLedgerApi.test.ts`、`FavoriteLibraryWorkspace.test.tsx`、`App.test.tsx`）355/355、`FavoriteLedgerOverview.test.tsx` 118/118、`npm run build` 通过。Electron 只读截图：`.codex-artifacts/2026-08-31-inbox-workspace-backup-selection.png`；当前开发账号已物化 `bilimi·暂存` 并显示“已备册”，因此未能在真实账号中复现“仅 local:inbox、未备册”的候选列表。未执行创建、绑定、删除、移动或视频写入；真实远端副作用仍待用户在可控账号中确认。 |

## 讨论诊断

1. 截图中的左侧 `bilimi: 暂存（84）` 来自本地回退文件夹 `local:inbox` 的显示投影。它保存未匹配视频，不能直接作为远端 folder ID 或绑定实体。
2. 同时，默认规则目录中的稳定 ID `inbox` 才是可备册的逻辑收藏夹身份。它可创建或绑定自己的第一条物理分册；此动作不上传 `local:inbox` 的 84 条视频。
3. 当前“备册工作夹”对话框和执行循环都只遍历仓库中已存在的 `bilimi-logical:*` 项。因此未备册暂存只有 `local:inbox` 投影时不会显示；测试只覆盖了已预先存在 `bilimi-logical:inbox` 的情形，遗漏了未备册的首次入口。
