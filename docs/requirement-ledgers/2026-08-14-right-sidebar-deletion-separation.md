# 右侧收藏夹删除与左侧收藏库菜单彻底分离：需求账本

本账本记录本主题从用户提出问题到用户明确说“开始”为止的全部原文。原文区永久保持不变；实施与验收只追加在逐项索引表与实施记录中。

## 原文区

### R001

截图文件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-928dbc1d-865b-43b6-a7a3-bbe0e4ae7591.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2b9df945-ed65-4c0e-9394-2839ce71175a.png`

截图目标区域：图一为右侧边栏“收藏夹”开启删除模式后的“删除 bilimi 收藏夹”弹窗；图二为左侧收藏库“bilimi 工作夹”的三个点菜单触发的“删除 bilimi 收藏夹”弹窗。两图都显示“删除范围”及“仅从 bilimi 删除（保留 B 站收藏夹）／同时从 B 站删除收藏夹及其中分类视频”。用户以两图要求核对两个入口是否已经分开；未提供额外圈定标注。本轮需在真实 Electron 界面再次验收。

用户原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-928dbc1d-865b-43b6-a7a3-bbe0e4ae7591.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-928dbc1d-865b-43b6-a7a3-bbe0e4ae7591.png
>
> ## codex-clipboard-2b9df945-ed65-4c0e-9394-2839ce71175a.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2b9df945-ed65-4c0e-9394-2839ce71175a.png
>
> ## My request:
> 图一是右边侧边栏打开的，图二是收藏库三个点菜单，你确定这两现在分开了吗

### R002

用户原文：

> 开始

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001-R002；并延续 `2026-08-14-managed-folder-delete-semantics.md` 的 I001/I003 | 右侧边栏“收藏夹”的 × 删除模式只处理右侧的自建收藏夹配置和草稿；不得再进入收藏库工作夹删除、收藏库分类关系删除或 B 站实际删除流程。 | `FavoriteLedgerOverview` 的删除模式、编辑器内删除按钮及其本地 IPC。 | 自建已保存收藏夹、远端草稿和瞬态新建草稿可按既有规则选择/删除；系统默认收藏夹不再可在右侧删除模式中选中，避免落入左侧删除语义。 | 右侧删除后自建已保存项/草稿从右侧列表移除；瞬态草稿不调用 IPC；默认项不能触发弹窗或远端删除。 | 已保存自建项仍使用账户范围的本地配置删除 IPC；远端草稿仍保留“备册可重新发现”的标记；不读写收藏库成员关系，不调用 B 站删除 API。 | 不改左侧收藏库的三个点菜单、收藏库视频详情/批量删除、回收站规则、B 站远端数据，也不新增“待对账”提示。 | `favoriteLedgerDraftDeletion` 本地删除契约、Electron 本地 IPC、左侧 `FavoriteLibraryApp` 已有删除入口。 | 已确认，待实施。 | 截图 R001；组件定向测试；构建；真实 Electron 仅验收不写入用户/B 站数据。 |
| I002 | R001-R002 | 两个入口的文案与结构不得再伪装成同一个删除功能：右侧不显示“删除范围”或“同时从 B 站删除收藏夹及其中分类视频”；左侧菜单保留自己的收藏库/B 站删除语义。 | 右侧删除模式帮助文字与弹窗；左侧 `FavoriteLibraryApp` 菜单。 | 右侧只在存在可删除的自建项/草稿时完成删除；默认项在右侧删除模式下保持不可选。 | 右侧混选自建项和草稿时一次完成本地删除；不出现左侧的确认弹窗。 | 右侧不预览/执行收藏库工作夹删除令牌，不调用远端删除。 | 左侧弹窗现有“删除范围”与确认流程属于受保护子系统，除非测试证明被右侧改动牵连，否则不修改。 | I001；现有 `FavoriteLibraryApp.test.tsx`。 | 已确认，待实施。 | 右侧测试断言无 `alertdialog`、无 managed-folder/B 站调用；左侧回归测试保持通过。 |

## 实施计划（按原文讨论顺序）

### P001 — 右侧删除路径彻底隔离（覆盖 I001）

- 允许修改：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`、`src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`。
- 结果：删除模式仅收集非默认项；删除时只执行既有草稿/本地配置删除路径。移除右侧到 `previewManagedFavoriteFolderDeletion`、`previewFavoriteLibraryManagedFolderDelete`、`deleteFavoriteLibraryManagedFoldersLocal` 和 B 站删除路径的调用。
- 风险：默认项此前会显示确认弹窗；改后它在右侧删除模式不可选。草稿、本地配置删除、批阅选择和备册不能退化。
- 测试与界面验收：先把“默认项触发旧弹窗”的测试改为失败测试，断言默认项不可选且右侧无收藏库/B 站 API 调用；再运行组件定向测试。真实 Electron 只检查文案、按钮可用性与弹窗缺失，不点击会写入数据的删除确认。

### P002 — 右侧文案与左侧回归保护（覆盖 I002）

- 允许修改：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`、`src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`、本账本。
- 结果：右侧帮助文字准确说明只删右侧自建配置/草稿，保留收藏库与 B 站；右侧不再渲染“删除范围”或 B 站删除选项。左侧 `FavoriteLibraryApp` 不改。
- 风险：用户可能将右侧 × 和左侧三个点混淆；测试须锁住入口职责，避免以后重新接线。
- 测试与界面验收：断言右侧没有“同时从 B 站删除收藏夹及其中分类视频”和“删除范围”；运行 `FavoriteLibraryApp.test.tsx` 保护左侧菜单。重新核对 R001 两张截图所对应的文字、位置和显示条件。

## 实施与验收记录

实施前核对（2026-08-14）：分支为 `main...origin/main [ahead 889, behind 1]`，最新本地提交为 `2c82d582 fix: separate right favorite deletion from library folders`。根目录存在不属于本轮的未跟踪文件 `1`（69 字节，2026-08-14 04:57 写入）；不读取其内容、不修改、不暂存、不提交。本轮只暂存 I001/I002 列出的文件和本账本。

实施与验证（2026-08-14）：

- I001 已实施待真实界面验收。`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:192` 让右侧删除模式仅把非默认项视为可操作；`:649-650` 仅把非默认选择交给既有本地配置/草稿删除路径；原先的 `requestManagedDeletion`、`confirmManagedDeletion`、收藏库令牌调用、B 站删除调用和右侧管理删除弹窗均已移除。`:782` 同步禁用默认项的右侧删除选择按钮，保留远端草稿等非默认项可选。自动化：先运行组件测试得到 3 个预期失败（默认项仍可选），再实现后运行 `FavoriteLedgerOverview.test.tsx` 78/78 通过；静态核对确认组件源文件没有 managed-folder、收藏库或 B 站删除引用。
- I002 已实施待真实界面验收。`:70` 的右侧说明改为“只会移除右侧本地收藏夹配置，保留收藏库和 B 站收藏夹；默认收藏夹请在左侧收藏库的工作夹菜单中处理”。组件测试 `:383-410` 断言右侧默认项不可选、无“删除范围”、无 B 站删除单选项、无管理删除 API 调用；左侧受保护回归 `FavoriteLibraryApp.test.tsx` 139/139 通过，未修改 `FavoriteLibraryApp.tsx`。`npm run build` exit 0。
- 真实界面验收未完成：Windows 自动化可枚举标题为 `bilimi` 的 Electron 窗口，但以该窗口读取状态返回 `Error: node_repl exec context not found`。为了不写入本地或 B 站数据，未在真实账户上点击删除确认；需手工检查图一右侧默认项在 × 删除模式为不可点、没有“删除范围”弹窗，图二左侧三个点菜单仍保留原有弹窗。
