# 删除模式视觉状态与弹窗提示讨论账本

本账本记录本轮主题从用户首次提出到明确说“开始”为止的全部用户原文。当前处于讨论阶段，不修改产品代码。

## 原文区

### R001

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-327e9ed8-de25-497a-84b8-f94526888827.png`、`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-b5a68d0e-ce88-4a63-986b-c4bcd3b6aee2.png`、`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-95a88d6b-ad01-491d-aee0-c6522d2ee3c9.png`。

截图目标区域：图一右侧助手“收藏夹”区域及右上角 `x`；图二进入删除模式后的“全选/取消全选、删除、x”操作区和下方收藏夹卡片；图三收藏库详情页“其他操作”中的红框勾选项及提示位置。截图视觉目标均需界面验收。

用户原文：

> 讨论图一点击x前保持不变，点击后进入删除模式，
> 图二删除模式下，全选取消全选，删除，x，变成红色字体，框框不变，下面的收藏夹变成勾选后变成红框
> 图三的红框勾选提示不用放在外面，保持在弹窗里即可

### R002

用户原文：

> 不用

### R003

用户原文：

> 可以从 B 站 bilimi 收藏夹删除，要点击可以出现弹窗，如果没有实际B站bilimi收藏夹，在弹窗里提示

### R004

用户原文：

> 可以，还有要讨论的吗

### R005

用户原文：
> 可以，别忘了从删除模式退出时恢复正常

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001 | 图一在点击 `x` 前保持现有收藏夹区域外观、文案、颜色、边框和交互；点击后仅进入删除模式。 | 右侧助手 `FavoriteLedgerOverview` 的收藏夹标题栏与卡片区域。 | 非删除模式不显示删除模式红色状态；点击 `x` 后显示删除模式。 | `x` 负责进入/退出删除模式，不改变收藏夹数据。 | 不触发删除、备册、同步或 B站副作用。 | 不改图一现有正常模式布局和功能。 | `deletionModeActive`、`enterDeletionMode`、`cancelDeletionMode`。 | 已实施待人工界面验收 | `FavoriteLedgerOverview.test.tsx` 删除模式状态测试通过；Electron 自动化受阻。 |
| I002 | R001、R004 | 删除模式下“全选/取消全选、删除、x”文字改为红色；外层按钮框保持现有尺寸、形状和边框不变。“重置”不在红色范围，保持原样。 | 右侧助手收藏夹标题栏操作按钮。 | 仅删除模式变红；正常模式保持原有样式。 | 全选/取消全选、删除、退出删除模式行为不变。 | 仅视觉样式变更，不改选择状态持久化和删除语义。 | 不改变重置按钮、按钮位置、尺寸、边框和正常模式颜色。 | 标题栏操作按钮 JSX 与 `styles.css` 类选择器。 | 已实施待人工界面验收 | `FavoriteLedgerOverview.test.tsx` 与构建通过；截图待人工核对。 |
| I003 | R001、R004 | 删除模式下，下方收藏夹卡片在被勾选后变成红框；未勾选卡片保持原有框样式。卡片名称、备册/绑定状态文字和布局不改色、不变位。 | 右侧助手收藏夹卡片及其勾选按钮。 | 仅删除模式渲染红色选择态；选择前和正常模式不显示红框。 | 点击卡片右侧勾选控件加入/取消删除选择；不提前执行删除。 | 不改变现有删除计划、默认收藏夹规则和草稿/绑定逻辑。 | 不改变卡片文字、状态标签、布局或正常勾选功能。 | `deletionStore`、`FavoriteLedgerEnableButton`、`.favorite-ledger-panel__chip-item` 样式。 | 已实施待人工界面验收 | `FavoriteLedgerOverview.test.tsx` 覆盖未选、选中、退出状态；截图待人工核对。 |
| I004 | R001、R003、R004 | 图三“红框勾选”对应的“同时从其他 bilimi 工作夹移除”及解释不再放在页面外部，保留在 B站删除确认弹窗内部；无实际B站目标时仅在弹窗显示无目标提示，不显示该勾选项。 | 收藏库详情页删除操作确认弹窗及其外部提示。 | 详情页外只保留B站删除按钮；仅有实际B站 bilimi 目标的确认弹窗显示范围勾选与说明。 | 勾选项仍可操作，提示跟随弹窗内容展示。 | 不改变两个 bilimi 删除入口、其他工作夹勾选语义和B站副作用。 | 不改详情页其他处理记录、来源、分类和操作区域。 | `FavoriteLibraryApp.tsx` 删除确认弹窗、外部提示渲染。 | 已实施待人工界面验收 | `FavoriteLibraryApp.test.tsx` 覆盖范围控件位置；截图待人工核对。 |
| I005 | R002 | 不使用浏览器视觉对照工具；采用文本与现有截图核对。 | 本轮讨论流程。 | 不涉及产品界面显示。 | 不产生产品交互。 | 不产生数据副作用。 | 不创建视觉对照页面。 | 讨论流程。 | 已确认，明确不做 | 无需界面验收。 |
| I006 | R003、R001 | “从 B 站 bilimi 收藏夹删除”在详情页始终可点击以打开确认弹窗；复选框与说明在弹窗内。没有实际已备册的 B 站 bilimi 收藏夹时，弹窗显示真实无可删除目标提示。 | 收藏库详情页“其他操作”的 B站删除入口与确认弹窗。 | 外部仅显示删除按钮；每次点击打开弹窗。弹窗内依实际远端绑定显示可删除范围或“没有实际B站 bilimi 收藏夹”的提示。 | 用户可在弹窗内勾选“同时从其他 bilimi 工作夹移除”；有实际目标时才可继续预览/确认删除，无目标时不得执行远端删除。 | 无实际目标不修改收藏库、B站、回收站、档案或处理记录；有目标时沿既有B站删除、失败和回收站语义执行。 | 不隐藏入口；不把无远端目标误报成成功；不改收藏库本地删除弹窗。 | 详情远端归属快照、远端预览、确认弹窗、跳过与失败反馈。 | 已实施待人工界面验收 | `FavoriteLibraryApp.test.tsx` 覆盖初始无目标及预览确认无匹配；Electron 自动化受阻。 |
| I007 | R005 | 点击“从 B 站 bilimi 收藏夹删除”后，如果因网络、登录失效或接口异常而无法核验远端状态，弹窗显示“暂时无法核验 B 站收藏夹，请稍后重试”，不显示确认删除入口。 | 收藏库详情页的 B 站删除确认弹窗。 | 仅在远端核验异常时显示；真实不存在远端目标仍显示 I006 的无目标提示。 | 用户只能关闭或重试；不能执行确认删除。 | 不修改收藏库、B 站、回收站、档案或处理记录。 | 不将“核验失败”误报为“没有实际 B 站 bilimi 收藏夹”；不改本地删除和批量删除弹窗。 | 远端归属快照、异常分类、确认弹窗。 | 已实施待人工界面验收 | `FavoriteLibraryApp.test.tsx` 覆盖预览异常；Electron 自动化受阻。 |
| I008 | R005 | 从右侧收藏夹删除模式退出时，恢复进入删除模式前的正常界面。 | 右侧助手 FavoriteLedgerOverview 收藏夹区。 | 点击删除模式的 x / 取消删除时立即恢复。 | 清空删除选择；“全选/取消全选”“删除”“x”恢复正常颜色；卡片红框消失、未勾选或曾勾选卡片都恢复正常边框。 | 不改变收藏夹数据、备册/绑定状态、草稿、收藏库或 B 站。 | 不保留删除模式的选择、红色文字或红框；不改正常模式布局和普通选择功能。 | deletionModeActive、deletionStore 与视觉状态类名。 | 已实施待人工界面验收 | `FavoriteLedgerOverview.test.tsx` 定向测试；Electron 自动化受阻，见 `.codex-artifacts/2026-08-15-deletion-mode-electron-verification.md`。 |

## 索引实施记录

| 条目 | 实际代码位置 | 自动化验证 | 界面验收与结果 |
|---|---|---|---|
| I001 | `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 的标题操作区 `data-deletion-mode` 与既有 `enterDeletionMode`。 | `FavoriteLedgerOverview.test.tsx` 的 `shows deletion visual state only for selected cards and clears it when deletion mode exits` 通过。 | 已实施待人工界面验收；正常模式无属性、进入模式有属性由测试覆盖，真实 Electron 自动化无法激活窗口。 |
| I002 | `src/renderer/src/styles.css` 的 `.favorite-ledger-panel__category-actions[data-deletion-mode] > button:not(:first-child)`。 | 同上；构建通过。 | 已实施待人工界面验收；CSS 只覆盖文字颜色，未改尺寸、圆角、内边距或“重置”。 |
| I003 | `FavoriteLedgerOverview.tsx` 卡片的 `data-deletion-selected` 与 `styles.css` 的卡片红色边框覆盖。 | 同上；已覆盖未选、选中、退出后的属性变化。 | 已实施待人工界面验收；名称、状态文字和布局未被 CSS 覆盖。 |
| I004 | `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx` 的详情远端删除弹窗渲染。 | `FavoriteLibraryApp.test.tsx` 范围选择测试通过；外部提示断言已更新。 | 已实施待人工界面验收；本地删除和批量删除弹窗未改。 |
| I005 | 未创建浏览器视觉对照页。 | 不适用。 | 已确认明确不做，仍使用文本、自动化测试和 Electron 验收记录。 |
| I006 | `FavoriteLibraryApp.tsx` 的 `openRemoteUnfavoriteDialog`、`isMissingRemoteUnfavoriteTarget` 与 `missing-target` 阶段。 | `opens the detail Bilibili deletion dialog for an unbound work folder without previewing a missing remote target`、`shows the missing-target dialog when remote preview finds no matching Bilibili placement` 通过。 | 已实施待人工界面验收；初始无目标和权威预览确认无目标均不调用确认或执行 API。 |
| I007 | `FavoriteLibraryApp.tsx` 的 `beginRemoteUnfavorite` 异常分类与 `unverified` 弹窗阶段。 | `keeps a failed detail remote verification inside the deletion dialog without confirming removal` 通过。 | 已实施待人工界面验收；接口异常不会写页面外错误或显示确认删除。 |
| I008 | `FavoriteLedgerOverview.tsx:576-580` 的 `cancelDeletionMode` 重置与新增视觉数据属性。 | `FavoriteLedgerOverview.test.tsx` 的退出断言通过，且 `onSaveLedgers` 未被调用。 | 已实施待人工界面验收；选择、红字与红框均在退出时由同一状态重置移除。 |

## 讨论检查记录

- 当前分支为本地 `main`；现有工作树只有上一轮未跟踪账本 `docs/requirement-ledgers/2026-08-15-local-only-deletion-binding-state-persistence.md`，本轮不混入其产品代码改动。
- 现有删除模式入口在 `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`；标题栏按钮共用 `.favorite-ledger-panel__category-actions`，`x` 使用 `.favorite-ledger-panel__mode-toggle`。
- 现有卡片选择控件共用 `.favorite-ledger-panel__chip-action` 与 `deletionStore`；当前 CSS 只有蓝色选择态，没有删除模式的红色选择态。
- 图三外部提示与弹窗内确认项需要在实施前再次按当前代码定位，不能把详情页已有的删除入口或其业务文案一并删除。
