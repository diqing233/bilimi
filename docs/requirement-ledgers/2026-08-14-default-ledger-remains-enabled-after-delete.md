# 默认收藏夹删除后仍保持勾选需求账本

本账本记录本轮主题从用户首次提出到明确说“开始”为止的全部用户原文。原文区保持不变；后续分析、实施与验收只追加在索引表或实施记录中。

## 原文区

### R001

用户原文：

> 你忘了默认收藏夹不能取消勾选吗，只是变成了未备册

### R002

用户原文：

> 开始

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001、R002 | 默认收藏系统开启时，默认收藏夹即使其 B 站备册被删除，也必须保持已勾选、不可单独取消勾选；状态只显示为“已删除 · 未备册”。 | 右侧收藏夹面板的启用按钮；默认规则的 `enabled` 字段、账户有效规则和整理启动规则。 | `managedFolderDeletedByUser` 为真时仍显示“已删除 · 未备册”；默认系统开启时仍为选中且锁定；全局关闭默认收藏系统的现有行为保留。 | 右侧删除默认收藏夹后，不把默认规则切换为未勾选；用户不能通过该卡片关闭它；点击“备册”仍是显式恢复远端收藏夹的入口。 | 删除远端默认收藏夹后持久化 `managedFolderDeletedByUser: true` 与无绑定状态，但持久化 `enabled: true`；不因该改动自动新建、按同名重绑或修改 B 站收藏夹。 | 不改备册按钮文案或恢复流程；不改非默认收藏夹的勾选和删除语义；不改全局关闭默认收藏系统的行为；不移除防止已删除默认收藏夹按名称自动发现/重建的保护。 | `favoriteLedgerDeletion` 删除投影；`FavoriteLedgerOverview` 面板保存与锁定；`assistantState` 有效规则；`oldFavoriteWorkspaceClassification` 整理启动；单册备册入口；远端文件夹投影保护。 | 已实施，待真实 Electron 界面验收 | 共享、Electron 持久化、有效规则、整理启动、远端防自动恢复、全局关闭下的单册备册拒绝和右侧面板定向测试均通过；`App.test.tsx` 104 项、`FavoriteLibraryApp.test.tsx` 139 项及 `npm run build` 通过。桌面自动化运行时当前没有可调用窗口上下文，真实窗口只读验收待补。 |

## 实施前核对与计划

- 当前分支：`main...origin/main [ahead 894, behind 1]`。
- 当前未提交文件：无；可以只处理本轮主题。
- 最近本地提交：`30f3106e fix: color deleted favorite status as unbacked`。
- 本轮允许修改范围：`src/shared/favoriteLedgerDeletion.ts`、对应测试；`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`、对应测试；`src/renderer/src/features/state/assistantState.ts`、对应测试；`electron/main/oldFavoriteWorkspaceClassification.ts`、对应测试；`electron/main/managedFavoriteLedgerDeletionPersistence.test.ts`、`electron/main/favoriteLibraryManagedFolderProjection.test.ts`、`src/renderer/src/App.tsx`、对应 `App.test.tsx` 和本账本。保留 `electron/main/favoriteLibraryManagedFolderProjection.ts` 对 `managedFolderDeletedByUser` 的同名远端候选跳过逻辑。

### 已确认条目

1. `R001`：默认收藏夹删除 B 站备册后，仍不得取消勾选，只是未备册。
2. `R002`：授权按本轮已确认范围实施并提交。

### 待用户决定

无。

### 被明确替代

无。本轮 `R001` 明确替代先前实现中“已删除默认收藏夹应随删除被禁用、排除自动目标”的语义；旧账本原文不删除。

### 明确不做

无新增排除项；按 I001 的边界保留备册显式恢复和同名远端不自动重建保护。

### 实施计划

1. `R001`：先在共享删除投影、Electron 持久化、账户有效规则、整理启动和右侧面板分别添加或调整期望为 `enabled: true` 的回归断言；运行定向测试，预期因当前代码产出 `enabled: false` 或允许取消而失败。风险：测试只覆盖渲染而漏掉保存路径。验收：每层都有独立断言。
2. `R001`：将默认规则的删除投影与右侧删除完成状态保持 `enabled: true`；默认系统开启时，删除标记不再解除右侧启用锁定，也不再让账户有效规则或整理启动将其禁用。风险：意外自动恢复远端收藏夹。验收：保留远端文件夹投影测试，确认删除标记仍阻止按名称自动发现；单册备册入口在全局关闭默认系统时与批量备册一样拒绝创建远端收藏夹。
3. `R001`：运行共享、Electron、状态和面板定向测试及构建；执行 `git diff --check`，在可用的 Electron 开发版中只读核对右侧卡片状态、勾选和不可点击条件。风险：现有桌面自动化仍可能无法读取窗口状态；如发生则如实记录为待补验收。

## 实施与验收记录

- `I001`（R001、R002）：先修改五层回归断言并执行红灯测试。修改前分别收到：共享删除投影 `enabled: false`、Electron 删除持久化 `enabled: false`、账户有效规则 `enabled: false`、整理启动仍保留 `enabled: false`，以及右侧“移出同步”按钮未禁用；失败均由本轮需求指出的旧语义导致。
- `I001`（R001、R002）：已在 `src/shared/favoriteLedgerDeletion.ts` 的默认规则远端删除投影中保留 `enabled: true`；在 `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 的默认系统锁定和删除完成保存路径中保持勾选并禁用取消操作；在 `src/renderer/src/features/state/assistantState.ts` 与 `electron/main/oldFavoriteWorkspaceClassification.ts` 中让默认系统开启时的有效规则、整理启动规则保持启用。`electron/main/favoriteLibraryManagedFolderProjection.ts` 未改，且其测试现使用 `enabled: true` 的已删除默认规则，仍证明同名远端候选不会自动重建。
- `I001`（R001、R002）：绿灯验证通过：`favoriteLedgerDeletion.test.ts` 1 项、`managedFavoriteLedgerDeletionPersistence.test.ts` 4 项、`assistantState.test.ts` 31 项、`oldFavoriteWorkspaceClassification.test.ts` 与 `favoriteLibraryManagedFolderProjection.test.ts` 合计 28 项、`FavoriteLedgerOverview.test.tsx` 84 项、`App.test.tsx` 104 项、`FavoriteLibraryApp.test.tsx` 139 项。`npm run build` 通过。后两组既存 React `act(...)` 警告仍出现，但无断言失败。
- `I001`（R001、R002）：真实 Electron 界面验收待补。已按只读原则尝试启用桌面自动化，但当前运行时没有提供可调用的窗口控制上下文；未点击删除、备册、保存或执行任何会改写应用/B 站数据的操作。
- `I001`（R001、R002）：提交前只读审查发现 `ensureFavoriteLedger` 单册备册入口此前未检查 `defaultFavoriteSystemEnabled`；而删除后的默认规则现会持久化为 `enabled: true`，会导致全局关闭系统时仍可经收藏库“备册当前收藏夹”创建远端收藏夹。该问题属于 I001 的“全局关闭行为不改”边界，已纳入本轮修复与回归测试。
- `I001`（R001、R002）：已在 `src/renderer/src/App.tsx` 的 `ensureFavoriteLedger()` 账户解析后，加入与批量备册一致的全局关闭保护；新 `App.test.tsx` 用例以 `enabled: true`、`managedFolderDeletedByUser: true` 的默认规则重现单册创建成功（红灯），修复后断言返回拒绝、`missingTargets: ['music']` 且创建脚本不被调用（绿灯）。审查同时确认右侧删除调用的 `onSaveLedgers` 只持久化本地偏好，远端创建仍只经显式 `onSyncLedgers`/备册路径发生。
