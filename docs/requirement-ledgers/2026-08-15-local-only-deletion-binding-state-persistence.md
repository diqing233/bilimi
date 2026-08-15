# 仅删除 bilimi 后绑定状态回写讨论账本

本账本记录本轮主题从用户首次提出到明确说“开始”为止的全部用户原文。当前处于讨论与检查阶段，不修改产品代码。

## 原文区

### R001

截图文件路径：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-666385f6-085a-4303-961f-71df2a2226ae.png`

截图目标区域：右侧助手“收藏夹”删除确认弹窗，选择的是“仅删除右侧 bilimi 收藏夹（保留收藏库和 B 站收藏夹）”。用户描述在删除后，收藏夹状态先变成“未绑定”，页面刷新后又自动变回“已备册”。

用户原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-666385f6-085a-4303-961f-71df2a2226ae.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-666385f6-085a-4303-961f-71df2a2226ae.png
>
> ## My request:
> 删除后当时变成了未绑定，但是我刷新一下自动又变回已备册为什么讨论检查

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001 | 查明“仅删除右侧 bilimi 收藏夹”后，状态从“未绑定”在刷新后变回“已备册”的原因。 | 右侧助手收藏夹卡片的备册/绑定状态，删除完成、持久化和刷新回填路径。 | 删除后由持久化绑定状态决定显示，不添加临时“已删除”提示。 | 删除分支保留真实远端绑定信息；刷新/推荐恢复不会把本地取消状态伪装成已备册。 | 仅修改本地规则/推荐持久化，不删除 B 站或收藏库数据。 | 不改普通备册、绑定和 B 站同步语义。 | `finalizeManagedDeletionPlan`、推荐持久化与刷新投影。 | 已实施待验证 | `oldFavoriteWorkspaceRecommendationPersistence.ts:16-23,66-106`；定向回归 655 项通过；真实 Electron 状态刷新仍待验收。 |

### R002

用户原文：

> 图一当前没有完全实现，对于推荐收藏夹好像没有正确识别到当前状态，打开详情页什么都不显示，未备册执行删除，，已备册，未绑定是取消勾选

### R003

用户原文：
> 还有整理阶段新建收藏夹也要正常，你能理解吗，

### R004

用户原文：
> 还有图二DeepSeek这轮也要改开始

## 追加索引

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I002 | R002 | 推荐收藏夹必须按当前真实本地/远端字段显示状态；打开详情页时保留完整册名、规则和备册/绑定信息。未备册时执行删除；已备册或未绑定时只取消推荐勾选，不删除本地规则、卡片、收藏库成员、逻辑工作夹或 B 站收藏夹。 | 右侧助手推荐收藏夹卡片、当前收藏夹详情编辑区，以及推荐候选投影和推荐持久化。 | 推荐候选临时投影与已持久化规则均须显示实际状态；详情页不得因候选未在 `ledgers` 数组而缺少字段。 | 取消推荐时按实际状态分支：无远端备册的未备册项删除本地推荐草稿/规则；有远端收藏夹但未绑定、或已备册项仅取消推荐勾选并保留数据。 | 删除/保留结果必须写回本地偏好与推荐选择；不得误删 B 站或收藏库数据；后续刷新不能把取消后的状态错误恢复。 | 不改非推荐收藏夹的普通保存、备册、绑定和删除语义；不新增“已删除”等状态文案。 | `projectRecommendedLedgerDrafts`、`asLocalRecommendedLedger`、`reconcileRecommendedLedgers`、推荐候选选择队列、`FavoriteLedgerOverview` 状态与详情渲染。 | 已实施待验证 | `ControlledFavoriteLedgerPanel.tsx:118-151,274-295,634-643`；`oldFavoriteWorkspaceCoordinator.ts:605-614`；`oldFavoriteWorkspaceRecommendationPersistence.ts:16-106`；相关 renderer/main 定向测试包含推荐状态与删除分支，合计 655 项通过；真实 Electron 卡片/详情验收仍待完成。 |
| I003 | R003，关联 R002/I002 | 整理阶段新建收藏夹必须使用与普通收藏夹、推荐收藏夹一致的真实状态和交互链路；创建、编辑、保存、勾选、推荐联动和备册资格不能因整理阶段而失效。 | 整理阶段右侧收藏夹列表、详情编辑区、推荐收藏夹区域和本地偏好持久化。 | 新建未保存时显示草稿状态且不可勾选/备册；保存成功后显示实际保存状态并恢复正常可勾选；若已建立 B 站绑定则显示真实备册/绑定状态。 | 整理阶段新建的收藏夹可保存并参与当前整理规则；与推荐候选的身份映射不重复、不丢失；取消推荐只按实际远端状态执行 R002 的删除或仅取消勾选分支。 | 保存只写本地规则和整理草稿关联；备册或绑定仍由用户显式操作，不因新建自动写 B 站；不得删除收藏库成员、视频成员或已有 B 站收藏夹。 | 不改变非整理阶段的新建、保存、备册和删除语义；不新增特殊状态文案或第二套整理专用规则。 | `FavoriteLedgerOverview` 新建/保存、`ControlledFavoriteLedgerPanel` 整理期间投影、推荐候选身份匹配、启用状态和备册资格。 | 已实施待验证 | 现有整理阶段新建/保存/扫描中保存/备册资格测试随 `ControlledFavoriteLedgerPanel.test.tsx` 与 `FavoriteLedgerOverview.test.tsx` 通过；本轮完整定向回归 655 项通过；真实 Electron 鼠标交互仍待完成。 |
| I004 | R004，关联 `2026-08-15-deepseek-recovery-decision-stale.md` 的 I001-I004、I006-I007 | 本轮同时修复图二 DeepSeek：保留唯一“DeepSeek 整理”入口，范围选择放入弹窗；每次打开默认“整理不确定项和【未分类】（推荐）”，当前批次默认“当前批次”，本轮总览默认“本轮所有批次”；仅当 DeepSeek 自己读取工作区发现旧恢复决策过期时，按当前事实/规则恢复后再执行，不因旧决策错误阻塞。 | `OldFavoriteArchivePreviewStep` DeepSeek 工具区、`useOldFavoriteWorkspace` DeepSeek 调用和主进程恢复调用链。 | 单批次隐藏批次范围；多批次弹窗显示当前批次/本轮所有批次；未开启 DeepSeek 沿用真实不可用提示；恢复选择不在 DeepSeek 操作中重复弹出。 | 点击 DeepSeek 整理才打开范围弹窗，取消不调用 DeepSeek，确认后按选择调用；DeepSeek 发现恢复决策过期时自动按当前规则恢复并重试，保留人工分类；“整理收藏”入口原有恢复弹窗、关闭草稿和合并新分支流程不改。 | 恢复只更新本地整理草稿和分类基线，不扫描或写 B 站；范围参数沿用现有 DeepSeek 处理语义；不改推荐/新建收藏夹之外的 B 站执行。 | 不改变关闭整理后打开草稿、增量/新分支、扫描暂停、备册、删除和非 DeepSeek 普通分类语义；不新增第三个 DeepSeek 入口。 | `OldFavoriteArchivePreviewStep`、`useOldFavoriteWorkspace.organizeCurrentSegmentWithDeepSeek`、`OldFavoriteWorkspaceCoordinator` 恢复决策、`OldFavoriteWorkspaceDeepSeekService`。 | 已实施待验证 | 弹窗实现与样式位于 `OldFavoriteArchivePreviewStep.tsx:68,351,536-640`、`styles.css:8224-8252`；服务恢复位于 `oldFavoriteWorkspaceDeepSeekService.ts:90-121,133-140,755-763`；DeepSeek 服务 46 项、renderer 面板 133 项及完整定向回归共 655 项通过；普通“整理收藏”恢复测试仍通过。真实 Electron 验收未完成。 |

## 只读诊断记录

- `ControlledFavoriteLedgerPanel.tsx:72-104` 为未落入账户 `ledgers` 的选中推荐候选临时创建 `FavoriteLedger`，当前只填名称、关键词、类型、启用、排序和默认标记，缺少 `syncState`、`bindingState`、`bilibiliFolderId`/`bilibiliFolderIds`/`bilibiliFolderTitle`，因此 `FavoriteLedgerOverview.tsx:236-246` 无法投影真实备册/绑定状态，详情状态区为空。
- `oldFavoriteWorkspaceCoordinator.ts:605-614` 的 `asLocalRecommendedLedger()` 同样不带状态字段；`f3f99421` 曾移除新推荐无远端时的 `syncState: local-draft` 投影。
- `oldFavoriteWorkspaceRecommendationPersistence.ts` 的 `matchesGeneratedRecommendation()` 只把 `syncState: local-draft` 且无远端 ID 的项视作可随推荐取消而移除；真实 `asLocalRecommendedLedger()` 产出的新未备册推荐不命中该条件，取消后可能保留本地规则。
- 当前定向验证：`ControlledFavoriteLedgerPanel.test.tsx` 与 `FavoriteLedgerOverview.test.tsx` 合计 217 项通过；`oldFavoriteWorkspaceRecommendationPersistence.test.ts` 9 项通过；`oldFavoriteWorkspaceCoordinator.test.ts` 281 项通过。现有用例没有覆盖真实推荐生成函数产出、详情状态字段缺失或已持久化未备册推荐取消后的回写。

## 实施核对记录（2026-08-15）

- 已确认条目：`I001`、`I002`、`I003`、`I004` 均已实施待验证；没有新增待用户决定、被明确替代或明确不做条目。
- 推荐候选按候选 ID 与规则逻辑解析到唯一本地收藏夹，保留绑定/备册字段；无远端推荐草稿取消时删除，已备册或带远端 ID 的未绑定记录只取消推荐。代码与测试：`ControlledFavoriteLedgerPanel.tsx:118-151,274-295,634-643`、`oldFavoriteWorkspaceCoordinator.ts:605-614`、`oldFavoriteWorkspaceRecommendationPersistence.ts:16-106`。
- 整理阶段新建收藏夹仍沿用保存、规则分析排队、启用和备册资格链路；未保存草稿不可勾选/备册。相关 renderer/main 回归已覆盖。
- DeepSeek 页面只保留一个按钮；范围在 `OldFavoriteModal` 中选择，取消不调用，确认才调用；默认模式为“整理不确定项和【未分类】（推荐）”，批次默认按当前视图。主进程仅在 DeepSeek 读取到 recovery 且摘要提供 `merge-latest` 时确认一次并重新读取，不扫描、不写 B 站；普通整理收藏恢复入口未改。
- 自动化证据：完整定向命令涉及 7 个测试文件，`655 passed`；`npm run build` exit 0；`git diff --check` 通过。测试 stderr 仅有既有 B 站模拟失败日志和 React `act(...)` 警告，无断言失败。
- 真实 Electron 验收：未完成。此前自动化读取窗口曾返回 `Error: node_repl exec context not found`，本轮未能取得可操作的 Electron 上下文，因此推荐详情实际显示、鼠标点击和 DeepSeek 弹窗仍需人工/真实窗口验收；不能据此宣称 UI 全部验收完成。
