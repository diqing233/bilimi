# 收藏库删除与侧边栏收藏夹删除结果对照需求账本

本账本记录本轮主题从用户首次提出到明确说“开始”为止的全部用户原文。原文区保持不变；后续分析、实施与验收只追加在索引表或实施记录中。

## 原文区

### R001

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-0a07b71b-d12e-409e-aed6-3ecc9211361b.png`

用户圈定/描述的目标区域：右侧“收藏夹”卡片中的“影视动漫”和“音乐舞台”卡片；“音乐舞台”编辑区的 `B站绑定：1个收藏夹，共141个视频`；左侧仍存在的 `bilimi:音乐舞台 141` 工作夹。截图中“影视动漫”显示 `已删除 · 未备册`，用户说明这对应收藏库删除；“音乐舞台”显示 `已删除 · 未备册`，用户说明这对应侧边栏收藏夹删除。

用户原文：

> 影视动漫是收藏库删除的效果，音乐舞台是侧边栏收藏夹删除的效果

### R002

用户原文：

> 未备册应该是红色

### R003

用户原文：

> 备册也没有识别到草稿

### R004

用户原文：

> 备册能识别不用处理，继续处理删除

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001 | 对照并确认“收藏库删除”与“侧边栏收藏夹删除”两条路径各自造成的右侧卡片状态、左侧工作夹保留情况和 B 站绑定状态；不得把两个效果混为同一种删除。 | 左侧 `FavoriteLibraryApp` 删除入口；右侧 `FavoriteLedgerOverview` 删除入口、状态卡与编辑区；分类和同步使用的有效册目投影。 | 截图中的影视动漫与音乐舞台均显示 `已删除 · 未备册`；音乐舞台左侧工作夹和 B 站绑定仍可见。 | 左侧“仅从收藏库删除”调用本地删除服务，且 `remoteDeleted: false` 时持久化层不改右侧规则或绑定；右侧默认卡的本地删除则会保留恢复卡并显式写入 `managedFolderDeletedByUser: true`。有效册目投影不得把带该删除标记的默认项重新启用。 | 左侧仅本地删除不应有 B 站副作用；右侧仅本地删除保留左侧工作夹与 B 站收藏夹；两者的 B 站删除范围仍以弹窗选择为准。 | 不改备册识别、远端草稿发现、绑定或恢复分支；不改变“未备册”的红色编码。 | 上一轮 `2026-08-14-favorite-backup-and-deletion-regression.md` 的 I002、I003、I004；默认卡片恢复语义、`effectiveFavoriteLedgersForAccount()`。 | 已实施待真实界面验收 | 根因：`effectiveFavoriteLedgersForAccount()` 在默认系统启用时无条件把默认项设为 `enabled: true`，忽略 `managedFolderDeletedByUser`；因此已从右侧删除的默认项会重新进入整理、批阅和同步的有效目标集。代码：`assistantState.ts:294-302`。新增自动化回归 31 项通过；关联删除回归、构建通过；真实 Electron 只读验收受桌面自动化服务阻断。 |
| I002 | R002 | “未备册”状态保持红色显示。 | 右侧收藏夹状态卡、编辑区状态文本，以及其他展示未备册状态的位置。 | 只要状态语义为未备册即使用红色；已备册不得使用红色。 | 本条只确认视觉编码，不改变各删除入口的实际状态、绑定或恢复逻辑。 | 无新增持久化、迁移或 B 站副作用。 | 不以消除颜色为方式处理“侧边栏删除但 B 站仍绑定”的信息表达。 | I001 的状态定义。 | 已确认，自动化证据通过，待真实界面验收 | 现有 `FavoriteLedgerOverview` 状态测试 82 项通过；本轮未改状态映射或 CSS，`data-binding-state="unbound"` 仍映射红色。真实 Electron 只读验收受桌面自动化服务阻断。 |
| I003 | R003, R004 | 点击“备册”后的草稿识别不属于本轮实施范围。 | 右侧“备册”操作与草稿识别链路。 | 保持现状。 | 不修改。 | 无本轮副作用。 | R004 明确要求“备册能识别不用处理”。 | 上一轮备册全量规则保护、默认卡恢复和远端草稿识别流程。 | 明确不做，被 R004 替代 | R004。 |

## 当前排查记录（非实施）

- 当前分支：`main...origin/main [ahead 892, behind 1]`。
- 最新本地提交：`35c5f7bd fix: separate favorite backup and deletion scopes`。
- 创建账本前工作树干净。
- R001 没有说明影视动漫当时在左侧弹窗选择的是“仅从收藏库删除”还是“同时从 B 站删除”。这两个选项对应不同的右侧状态预期，不能据截图推断。
- R001 也尚未明确要求改变音乐舞台当前“已删除 · 未备册”的状态文案；该卡同时仍显示 B 站绑定，是否属于需要修正的显示冲突，待用户决定。
- 根因结论：右侧默认卡在“仅删除右侧”时，`FavoriteLedgerOverview.tsx:792` 有意写入 `managedFolderDeletedByUser: true`，所以音乐舞台保留左侧工作夹和 B 站绑定、同时显示红色恢复状态是当前设计结果。左侧“仅从收藏库删除”走 `FavoriteLibraryApp.tsx:1473-1478`，持久化层在 `remoteDeleted: false` 时应原样保留右侧规则和绑定；它本身不应把影视动漫变成红色。若影视动漫确实选的是左侧仅本地删除，则红标只能是操作前已留存的删除标记，或实际走过 B 站删除范围，需用删除前状态/弹窗选择进一步区分。

## 实施前核对与计划

- 当前分支：`main...origin/main [ahead 892, behind 1]`。
- 当前未提交文件：本账本；属于本轮主题。没有其他主题的未提交改动。
- 最近本地提交：`35c5f7bd fix: separate favorite backup and deletion scopes`。
- 本轮允许修改范围：`src/renderer/src/features/state/assistantState.ts`、对应 `assistantState.test.ts` 与本账本；不改备册识别、远端草稿发现、绑定或恢复分支、B 站删除 API、左侧收藏库删除行为、草稿删除、扫描、批阅、整理收藏或回收站。

1. `R001` / `R002`：在 `assistantState.test.ts` 覆盖默认系统启用时，带 `managedFolderDeletedByUser` 的默认收藏夹仍保持 `enabled: false`，不进入整理、批阅和同步的有效目标集；未删除的默认收藏夹仍按既有规则自动启用。风险是误改变默认系统总开关语义；验收是新增失败回归先证明现状会重启用删除项，再以最小条件修复并运行关联删除、状态和应用运行时测试。右侧已删除默认卡仍输出 `已删除 · 未备册`，沿用现有 `data-binding-state="unbound"` 红色样式。
2. `R003` / `R004`：不修改备册识别、远端草稿发现、绑定或恢复分支；从实施计划排除，依据为 R004 的明确替代。
3. 按 `R001`、`R002`、`R004` 回读，运行关联 Vitest、`npm run build`、`git diff --check`；在不触发删除或备册写入的前提下尝试真实 Electron 只读界面验收。逐项记录代码位置和证据后提交本轮账本及代码。

## 实施与验收记录

- `I001`（R001）：已在 `src/renderer/src/features/state/assistantState.ts` 修复有效册目投影。默认系统开启时，只有未带 `managedFolderDeletedByUser` 的默认收藏夹才会自动启用；右侧删除后的默认收藏夹保持 `enabled: false`，不再被整理、批阅或同步流程重新作为自动目标。左侧收藏库删除、右侧删除入口、备册识别、远端草稿发现、绑定和恢复分支均未修改。
- `I002`（R002）：未修改现有右侧状态映射或 CSS；`已删除 · 未备册` 仍使用既有 `data-binding-state="unbound"` 红色编码。代码改动不会把“未备册”改成其他颜色。
- `I003`（R003、R004）：明确不做。未修改备册识别、远端草稿发现、绑定或恢复逻辑，依据为 R004。
- 先失败后通过的新增回归：`src/renderer/src/features/state/assistantState.test.ts` 的 `keeps a default folder deleted from the sidebar out of automatic targets`。修复前断言收到 `enabled: true`；修复后该文件 31 项通过。
- 关联自动化验证：`src/shared/favoriteLedgerDeletion.test.ts`（1 项）、`electron/main/managedFavoriteLedgerDeletionPersistence.test.ts`（4 项）、`src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`（82 项）、`src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`（139 项）、`electron/main/oldFavoriteWorkspaceClassification.test.ts`（11 项）均通过。收藏库套件输出既有 React `act(...)` 警告，但没有断言失败。
- 构建验证：`npm run build` 于 2026-08-14 通过。
- 真实界面验收：已发现运行中的 bilimi Electron 窗口；只读读取窗口状态时桌面自动化服务返回 `node_repl exec context not found`，未执行删除、备册或其他写入操作。因此本轮自动化和构建证据齐全，真实 Electron 界面验收待该服务恢复后补做。
