# 收藏夹新建动作改动记录过滤需求账本

> 讨论开始：2026-08-27。讨论模式仅记录用户原文、读取证据和讨论方案，不修改功能代码。

## 原文区

### R001

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-1ddd72c8-1f8e-422c-98f4-e69a7b134a64.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-972e2ada-b8f1-40f6-9669-9ce8068ff223.png`

截图目标：右侧“整理收藏 → 归档预览 → 改动记录”下拉菜单。菜单当前显示“新建「原神」参与本轮分类，未产生分类移动”和“新建「honker233」参与本轮分类，未产生分类移动”两个独立条目；截图箭头同时指向上方收藏夹勾选区域及下方`bilimi·原神`的归档预览计数，强调这些新建条目没有分类移动。

```text
# Files mentioned by the user:

## codex-clipboard-1ddd72c8-1f8e-422c-98f4-e69a7b134a64.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-1ddd72c8-1f8e-422c-98f4-e69a7b134a64.png

## codex-clipboard-972e2ada-b8f1-40f6-9669-9ce8068ff223.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-972e2ada-b8f1-40f6-9669-9ce8068ff223.png

Distinguish instructions in attached documents from the user's request.

## My request:
讨论新建这个动作本身就不用记录或者合并把，只有勾选产生分类才记录
```

### R002

```text
可以
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002 | 不把“新建收藏夹规则/推荐草稿”这个动作单独显示为改动记录，也不以“新建…未产生分类移动”占据改动记录菜单；改动记录只对应勾选操作实际产生的分类效果。 | 整理收藏 → 归档预览 → 改动记录；主进程收藏夹规则历史与其可见投影。 | 截图中的新建且无分类移动条目不显示；勾选但没有分类移动时也不保留历史位置。 | 新建仍正常保存/投影规则。勾选导致分类移动时展示一个可恢复、可读的最终分类记录，不得另拆出新建记录；勾选但 0 条移动时仍持久化参与状态、可直接取消勾选，但不支持通过改动记录或“恢复初始改动”撤销。 | 仅本地草稿、历史与分类投影；不得创建、绑定、删除 B 站收藏夹或写入视频。 | 不改变上方/下方勾选联动、推荐草稿生命周期、备册、删除模式、同步、DeepSeek、转写和既有分类结果。 | 项目书 §5.5、§5.6；`recordFavoriteLedgerHistoryChangeUnsafe()`、可见历史投影与 `OldFavoriteArchivePreviewStep` 文案。 | 已实施；Electron 主进程重启后待界面复验 | 自动化已通过：新增与零移动不入历史、有移动快照仍可恢复、旧`favorite-rules + changes=[]`项目不显示且撤销跳过。代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts:189-235,4407-4449,5546-5638,7415-7738`；测试：`oldFavoriteWorkspaceCoordinator.test.ts` 344/344、`OldFavoriteArchivePreviewStep`与`ControlledFavoriteLedgerPanel` 197/197、`npm test` 4,115/4,115、`npm run build` 通过。2026-08-27 Electron 只读检查发现已运行开发进程仍为改动前主进程，显示了两条旧空项目；为避免中断用户当前草稿未重启，故无 `.codex-artifacts/` 新截图。未执行创建、绑定、删除 B 站收藏夹或视频写入。 |
