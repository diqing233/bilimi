# 未备册状态颜色需求账本

本账本记录本轮主题从用户首次提出到明确说“开始”为止的全部用户原文。原文区保持不变；后续分析、实施与验收只追加在索引表或实施记录中。

## 原文区

### R001

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-672b925c-3283-4376-9635-8a8110c72975.png`

用户圈定/描述的目标区域：右侧“正在编辑：bilimi·音乐舞台”区域中的状态文字 `已删除 · 未备册`；截图中该文字显示为绿色，用户询问为何仍然是绿色。

用户原文：

> 这个提示怎么还是绿色

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001 | 查明并修正右侧编辑区中 `已删除 · 未备册` 仍使用绿色的问题。 | `FavoriteLedgerOverview` 右侧编辑区的绑定状态节点及其 CSS。 | 当状态文字语义包含“未备册”时应为红色；“已备册”才可为绿色。 | 仅修正状态颜色映射/样式优先级；不改变删除、备册、绑定或 B 站副作用。 | 无新增持久化、迁移或 B 站副作用。 | 不改删除范围、备册识别、草稿发现、绑定或恢复逻辑。 | 状态文字、`data-binding-state` 与 `FavoriteLedgerOverview` CSS。 | 已实施待真实界面验收 | 根因：`bindingLabelForLedger()` 先产生 `已删除 · 未备册`，但旧 `bindingStateForLedger()` 优先返回 `ledger.bindingState: "bound"`，使节点命中 `styles.css:5023` 的绿色。现已让“未备册”语义优先：`已删除 · 未备册` 输出 `data-binding-state="unbound"`，命中 `styles.css:5026` 的现有红色。新增 DOM 回归先失败（收到 `bound`）后通过。 |

## 实施前核对与计划

- 当前分支：`main...origin/main [ahead 893, behind 1]`。
- 当前未提交文件：本账本；属于本轮主题，没有其他未提交改动。
- 最近本地提交：`f17d0877 fix: keep deleted favorites out of automatic targets`。
- 本轮允许修改范围：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`、对应 `FavoriteLedgerOverview.test.tsx` 与本账本。不改 `styles.css` 的色值、删除范围、备册识别、草稿发现、绑定或恢复流程、B 站 API 或持久化数据。

1. `R001`：在 `FavoriteLedgerOverview.test.tsx` 添加右侧编辑区回归用例，使用同时带有 `managedFolderDeletedByUser: true` 与旧 `bindingState: 'bound'` 的默认收藏夹，断言显示文案为 `已删除 · 未备册` 且节点输出 `data-binding-state="unbound"`。先运行该测试，预期收到 `bound` 以重现截图的绿色根因。
2. `R001`：在 `bindingStateForLedger()` 中让“未备册”语义优先于旧的持久化绑定字段；`已删除 · 未备册` 映射为 `unbound`，继承现有红色 CSS。风险是影响未保存、未绑定和已备册的颜色；通过面板全量测试覆盖各状态。
3. `R001`：运行定向面板测试、删除持久化和左侧收藏库回归、`npm run build` 与 `git diff --check`。只读 Electron 界面验收不会触发删除或备册写入。

## 实施与验收记录

- `I001`（R001）：在 `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 调整 `bindingStateForLedger()` 的优先级。含“未备册”的标签不再服从旧的 `bindingState: 'bound'`；其中 `已删除 · 未备册` 映射为 `unbound`，普通“未备册”映射为 `unbacked`，均使用已有红色 CSS。未修改 `styles.css`、删除、备册、绑定、草稿或 B 站流程。
- 先失败后通过的新增回归：`FavoriteLedgerOverview.test.tsx` 的 `renders a deleted default ledger as unbound even when its previous Bilibili binding remains recorded`。修复前收到 `data-binding-state="bound"`；修复后定向面板测试 83 项通过。
- 关联验证：`electron/main/managedFavoriteLedgerDeletionPersistence.test.ts`（4 项）、`src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`（139 项）、`src/renderer/src/features/state/assistantState.test.ts`（31 项）均通过；`npm run build` 通过。收藏库套件存在既有 React `act(...)` 警告，但没有断言失败。
- 真实界面验收：已启动新的开发版 bilimi Electron 实例。桌面自动化服务能够列出其窗口，但只读 `get_window_state` 返回 `node_repl exec context not found`，未读取到界面截图，也未点击删除、备册或保存。因此真实窗口颜色仍待该服务恢复后补验。
