# bilimi 工作夹删除与收藏库删除语义需求账本

本账本记录本主题从首次讨论到用户明确说“开始”为止的全部用户原文。用户已明确说“开始”；原文区保持不变，后续实施与验收信息记录在逐项索引补充中。

## 原文区

### R001

截图文件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8aea7b62-d4eb-47e8-ac19-24e9cfefcd3e.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-18727d46-b2ca-46a9-b887-5a90fe6448b0.png`

截图目标区域：第一张左侧“bilimi 工作夹”中 `bilimi·创意美学` 的三点菜单及其“删除”项；第二张“删除 bilimi 收藏夹”弹窗中的“仅从 bilimi 删除（保留 B 站收藏夹）”单选项及其说明文字。用户未提供额外圈定文字；以该消息指向的上述区域为准，待界面验收。

用户原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-8aea7b62-d4eb-47e8-ac19-24e9cfefcd3e.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8aea7b62-d4eb-47e8-ac19-24e9cfefcd3e.png
>
> ## codex-clipboard-18727d46-b2ca-46a9-b887-5a90fe6448b0.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-18727d46-b2ca-46a9-b887-5a90fe6448b0.png
>
> ## My request:
> 讨论这个按照之前设计不是之前删除收藏库吗

### R002

用户原文：

> 之前不是两把分开，各管各的吗

### R003

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6fa88883-9252-4e64-8066-604551000310.png`。

截图目标区域：左侧“收藏库”区域中 `bilimi 工作夹` 的三点菜单，绿色框选“删除工作夹”；右侧助手面板“收藏夹”区域中删除位置。用户用该截图区分两个删除入口；具体删除范围和最终文案仍待确认。

用户原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-6fa88883-9252-4e64-8066-604551000310.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6fa88883-9252-4e64-8066-604551000310.png
>
> ## My request:
> 左侧是收藏库右侧是收藏夹位置删除

### R004

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-4bcfc648-780b-42ec-9295-db646f04d183.png`。

截图目标区域：右侧“收藏夹”位置删除自建、已保存收藏夹后打开的“删除 bilimi 收藏夹”弹窗。对象显示“当前 0 个视频”，已勾选“我已确认”，弹窗提示“删除收藏夹未完成；请重新打开确认窗口核对当前账号和工作夹后再试。”；用户要求查询不能删除的原因。

用户原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-4bcfc648-780b-42ec-9295-db646f04d183.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-4bcfc648-780b-42ec-9295-db646f04d183.png
>
> ## My request:
> 是的，查询当前这个我自建保存后的怎么不能删除，

### R005

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-cc2f26cf-9c82-4c9f-8c7b-460739b93788.png`。

截图目标区域：用户转发的诊断记录中对两张删除界面的对比，尤其是“图一”右侧收藏夹列表里变成禁止点击的红色删除/选择按钮，以及“图二”编辑区可执行的“删除”按钮；截图下方明确区分了“加入同步/删除模式中的选择按钮”和“草稿直删入口”。截图同时记录了 Electron 主进程重启后，图二本地草稿删除可执行的结论；待按当前代码界面重新验收。

用户原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-cc2f26cf-9c82-4c9f-8c7b-460739b93788.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-cc2f26cf-9c82-4c9f-8c7b-460739b93788.png
>
> ## My request:
> 把这个也加上

截图中被用户纳入本轮的行为边界：未保存、未绑定且已有 B 站文件夹 ID 的草稿属于可直接删除对象；删除只移除本地草稿与绑定记录，不删除 B 站文件夹、视频或收藏库。图一的禁用按钮只是加入同步/删除模式的选择按钮，不应被当作草稿直删入口；是否需要在图一增加直删入口，作为本条的界面待确认项。

### R006

用户原文：

> 允许勾选，删除时只有草稿，那就删除草稿

### R007

用户原文：

> 点击删除后都可以删

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001-R004 | 左侧收藏库“删除工作夹”与右侧收藏夹位置删除必须是两把独立入口，各自使用独立的范围、确认与数据副作用；右侧删除自建、已保存收藏夹时只删除本地收藏夹配置，保留收藏库和 B 站 | 左侧收藏库 `bilimi 工作夹` 三点菜单；右侧助手面板“收藏夹”删除位置；收藏库视频详情/批量菜单 | 左侧当前工作夹存在时显示；右侧收藏夹配置存在时显示；右侧已保存、自建且未备册对象也必须可删除 | 当前实现会把左侧入口带入“删除 bilimi 收藏夹”确认语义，并让右侧删除依赖左侧工作夹；后续必须拆分。右侧本地删除不得要求收藏库工作夹、账号读取或删除令牌 | 右侧删除只移除本地收藏夹配置；收藏库视频/归属、左侧工作夹、B 站收藏夹和远端数据均保持不变。左侧的最终删除范围仍待用户确认 | 不修改真实 B 站数据、不改视频详情/批量入口，除非后续原文明确纳入 | 第一轮账本 I007、I008、I010；工作夹投影、收藏库成员关系、右侧收藏夹规则与回收站 | 部分已确认：右侧职责已由 R004 确认；左侧最终范围待用户决定 | 已完成截图、第一轮账本、代码及运行终端的只读核对；尚未实施或做真实界面验收 |
| I002 | R004 | 查明右侧“收藏夹”中自建且已保存收藏夹的本地删除失败原因 | 右侧助手面板收藏夹删除弹窗及其本地删除调用 | 自建、已保存对象；用户选择“仅从 bilimi 删除”并勾选确认后 | 当前提示删除未完成；仅诊断，不执行删除 | 当前右侧本地删除错误地要求同名左侧收藏库 `bilimi-logical:<ledgerId>` 工作夹及稳定的删除令牌；右侧配置单独存在或扫描改变版本时均会失败。终端另证实当前 Electron 主进程缺失新 IPC 处理器，需与结构性问题分别处理 | 不改本地、收藏库或 B 站数据；不把本诊断扩大为左侧收藏库入口改造 | 右侧收藏夹配置、账户读取、工作夹投影与删除令牌校验 | 已定位根因，待用户确认实施边界 | 截图：已保存对象显示 0 视频且失败。代码：右侧先预览 `bilimi-logical:<ledgerId>`、主进程要求该工作夹存在并拒绝陈旧版本。运行终端：`assistant:delete-favorite-ledger-draft` 报 `No handler registered`，证明当前主进程未加载新增处理器；该条运行态证据不直接等同于本弹窗的精确 IPC 通道。 |
| I003 | R005-R007、第一轮账本 R005、R008 | 保留并补齐草稿直删边界：未保存/未绑定草稿可勾选；点击删除后所有选中项都可删除，按对象类型分流处理 | 右侧收藏夹列表的删除模式选择按钮；编辑区草稿“删除”按钮；草稿删除 IPC；已保存收藏夹本地删除 IPC | 草稿允许勾选；已保存收藏夹也允许勾选；混合选择不禁用删除 | 草稿走草稿专用删除，只移除本地草稿与绑定记录；已保存收藏夹走右侧独立本地配置删除，只移除本地配置；一次点击按类型分别执行 | 不修改 B 站文件夹、视频、收藏库成员或其他草稿规则；Electron 主进程必须注册对应 IPC | 第一轮账本 I005；右侧收藏夹配置与主进程 IPC 注册 | 已确认：草稿、已保存收藏夹及混合选择都可删除；各类型的本地副作用按本账本 I001/I003 执行 | 截图与前轮诊断记录已核对；主进程曾实际报 `assistant:delete-favorite-ledger-draft` 未注册；真实界面重启后仍待验收 |

## 实施与验收记录（逐项索引补充）

本表覆盖上方索引中 I001-I003 的“状态”和“验收证据”字段；原文区及原索引中的历史诊断不改写、不删除。

| 条目 | 实际代码位置 | 自动化验证 | 真实界面验收 | 状态与仍未验证条件 |
|---|---|---|---|---|
| I001 | `src/shared/favoriteLedgerDraftDeletion.ts:28` 只移除非默认本地配置；`electron/main/index.ts:1316` 新增账号范围本地删除 IPC；`electron/preload/index.ts:652` 与 `src/renderer/src/global.d.ts:308` 暴露契约；`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:671` 将右侧自定义项分流到本地路径，默认项仍进入既有受保护路径。 | `src/shared/favoriteLedgerDraftDeletion.test.ts` 6/6 通过；`electron/main/favoriteLedgerDraftDeletionIpc.test.ts` 6/6 通过；`src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx` 78/78 通过，覆盖已保存自建项、远端绑定项和默认项隔离；`FavoriteLibraryApp.test.tsx` 139/139 通过；`npm run build` 通过。 | 未完成。2026-08-14 桌面自动化可枚举 `bilimi` 窗口，但读取窗口状态返回 `node_repl exec context not found`；为避免写入用户本地/B 站数据，未点击真实删除。 | 已实施待真实界面验收。右侧本地删除不调用收藏库 repository、工作夹删除令牌或 B 站远端删除；左侧收藏库入口未修改。 |
| I002 | `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:679` 只读取右侧当前配置；`electron/main/index.ts:1316` 不读取收藏库工作夹快照，不调用 repository/远端删除；`src/shared/favoriteLedgerDraftDeletion.ts:28` 拒绝删除默认项。 | `electron/main/favoriteLedgerDraftDeletionIpc.test.ts` 6/6 通过，断言可信发送者、当前账号、持久化、备册重发现标记、通知以及禁止 repository/B 站调用；组件测试 78/78 通过，断言自建已保存项不弹旧的工作夹确认框。 | 同 I001，真实 Electron 主进程重启后的可视化点击未能执行。构建产物已含主进程处理器。 | 已实施待真实界面验收。此前“0 视频且无法删除”的根因不再依赖 `bilimi-logical:<ledgerId>` 工作夹或扫描版本。 |
| I003 | `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:207` 允许非默认远端草稿在删除模式勾选；`:679` 统一移除已持久化自定义/草稿配置，未持久化草稿只移除组件草稿；`:935` 编辑区已保存自定义项使用本地路径，原有可直接删除草稿路径保留。 | 组件测试 78/78 通过：远端草稿与已保存自建项可混选、仅草稿可删、瞬态草稿不触发 IPC、失败保留原“删除未成功，请稍后重试。”提示、默认保护流程仍可用。 | 同 I001。 | 已实施待真实界面验收。删除本地草稿/配置不会改 B 站、收藏库、视频或其他草稿；已持久化项的远端 ID 会标记为下次“备册”可重新发现。 |

### 全量测试限制

2026-08-14 执行 `npm test -- --reporter=dot` 在 302.6 秒的外层命令时限处以 exit `124` 中断；截取的日志未出现断言失败，但该命令未完整退出，不能记为全量测试通过。此限制不影响上表列出的定向测试与构建通过证据。
