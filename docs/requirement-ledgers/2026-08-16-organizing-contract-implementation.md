# 整理收藏契约实施需求账本

> 主题：按已合并的《项目功能项目书》修复整理收藏期间已定位的行为问题，并以小批次、可回归的方式完成远端收藏夹与 bilimi 本地工作区的分层、标签循环和绑定边界。
>
> 本文件的原文区永久保留本轮用户原话；此前两份账本的原文仍是对应产品规则的唯一原始证据。本账本只追加“开始实施”的授权和本次实施索引，不能改写或替代历史原文。

## 原文区（不可改写）

### R001

根据当前这个项目书，你有把握改好整理收藏期间的操作以及上个对话观察到的问题吗

### R002

合并到main之后，直接在main上施工

## 实施前确认清单

### 已确认

1. **R001：按当前项目书修复整理收藏操作和此前已定位的问题。** 范围覆盖 `2026-08-16-organizing-scan-button-contracts.md` 的 I-01 至 I-06，以及 `2026-08-16-remote-source-local-workspace-separation.md` 的 I-01 至 I-03；前者的 R001–R002、后者的 R001–R003 是精确行为和界面规则的原文依据。
2. **R002：在合并后的本地 `main` 直接施工。** 仅对本轮允许的代码、测试、账本和实施计划作改动；每个安全批次经过定向测试和完整回归后创建本地提交。不得推送、rebase、发布、删除分支或删除工作树。

### 待用户决定

无。真实 B 站账号上的绑定、同步、对账、412/网络恢复和 Electron 窗口交互将在代码完成后逐项验收；验收本身不授权写入用户的 B 站数据或修改已有应用数据。

### 被后续明确替代

无。本账本实施此前两个账本已经确认的规则，不替代其原文。

### 明确不做

- 不修改、暂存、提交或删除既有未跟踪文件 `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`；它属于其他主题。
- 不以名称、`bilimi` 前缀、扫描或同步选择隐式绑定远端收藏夹。
- 不在未取得单独授权时发起真实 B 站写入、推送、发布、rebase、删除分支或删除工作树。

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I-01 | R001；扫描账本 R002/I-05 | 任一批 ready/saved 后，本轮总览立即显示已就绪部分，其他批补取标签不得遮住结果。 | `OldFavoriteGuide.tsx:242-248`、本轮总览/预览步骤。 | 有 ready/saved 批即显示；没有任何可汇总批才显示等待。 | 切换总览或当前批不改变分类、勾选或执行范围。 | 只改变前端展示；不写本地持久化或 B 站。 | 不把部分汇总标成整轮完成。 | 批次状态、聚合投影。 | 已实施待 Electron 验证。 | 新增 `OldFavoriteGuide.test.tsx` 回归用例先在全局标签 `running` 时失败、修复后通过；`npm test` 234 文件 / 3810 测试通过。多批真实窗口验收未做。 |
| I-02 | R001；扫描账本 R002/I-06 | 取消未备册推荐仅在权威本地删除成功后同步移除推荐勾选和上方投影；失败时完整保留。 | `ControlledFavoriteLedgerPanel.tsx:320-335`、`FavoriteLedgerOverview.tsx:854-895`。 | 删除进行中保留卡片；成功后移除；失败显示重试且不移除。 | 取消已备册/绑定项仅取消本轮勾选。 | 由真实本地删除结果驱动；不删除远端实体。 | 不对已删除 ID 二次删除、不留幽灵卡片。 | 推荐候选映射、收藏夹删除回调。 | 已实施待 Electron 验证。 | `ControlledFavoriteLedgerPanel.test.tsx` 复现“删除成功后外部刷新又出现卡片”并先失败，修复后通过；`npm test` 234 文件 / 3810 测试通过。真实删除/重开验收未做。 |
| I-03 | R001；远端/本地账本 R002–R003/I-01–I-02 | 远端展示位置、本地关系状态和扫描资格拆开建模。 | shared 类型、扫描服务/协调器、扫描概览、收藏库。 | 所有远端夹在“用户收藏夹（B 站）”；本地工作区显示草稿/规则/关系卡；已绑定或待对账远端夹默认不可扫描。 | 仅显式确认绑定改变关系；同步独立执行。 | 增加兼容迁移；不改远端关系、不自动绑定。 | 名称相似远端夹仍是普通可扫描来源。 | 旧工作区持久化、账号隔离、收藏库模型。 | 已实施待 Electron 验证。 | 实际位置：`src/shared/oldFavoriteWorkspace.ts`（关系/资格兼容读取）、`electron/main/oldFavoriteWorkspaceStore.ts`（旧持久化规范化）、`oldFavoriteWorkspaceScanService.ts`（由本地绑定关系投影）、`oldFavoriteWorkspaceCoordinator.ts`（来源过滤与本地工作区投影）、`OldFavoriteScanOverviewStep.tsx`（两区渲染）；收藏库既有模型以 `bilimi-logical`/`local` 与普通远端夹分开，已核对未改。定向测试：shared/store/scan/coordinator/scan-overview 共 407 项通过，`ControlledFavoriteLedgerPanel` 138 项通过；完整 `npm test` 234 文件 / 3814 测试通过，`npm run build` 通过。真实 Electron 分区、鼠标/点击/滚动/缩放/最小化/关闭及真实 B 站关系流程尚未验收，且不会因本轮自动测试而宣称完成。 |
| I-04 | R001；扫描账本 R001/I-02；远端/本地账本 R001/I-03 | 标签采用按版本/内容变化循环；继续补取可产生待再次采用结果，旧结果不重复重算。 | shared 类型、store、coordinator、扫描概览。 | 当前批已采用可继续；仅出现新增/变化标签才显示采用。 | 再次采用仅重算系统分类、推荐、预览，保留人工分类和已勾选推荐。 | 增加可迁移持久化字段；不写 B 站。 | 无变化维持 accepted；不暂停其他批。 | 标签索引、批次状态、推荐/分类投影。 | 已实施待 Electron 验证。 | 实际位置：`src/shared/oldFavoriteWorkspace.ts`（快照状态）、`electron/main/oldFavoriteWorkspaceStore.ts`（旧数据兼容读取与增量回放）、`electron/main/oldFavoriteWorkspaceCoordinator.ts`（版本比较、当前批重新排队、按需恢复推荐索引）、`OldFavoriteScanOverviewStep.tsx`（继续/再次采用显示条件）；`oldFavoriteWorkspaceScanService.ts` 已由现有扫描资格与当前批读取边界满足，未为 I-04 修改。定向 coordinator/store/scan/UI 共 4 个测试文件、400 项通过；完整 `npm test` 234 文件 / 3824 测试通过，`npm run build` 通过。开发版仅验证应用、掌库和“整理收藏”入口可打开且关闭现有草稿弹窗；为不改变用户正在使用的实际草稿，未执行继续、合并、重扫或放弃，也未操作 B 站。多次标签循环、鼠标/点击/滚动/缩放/最小化/关闭仍待受控 Electron 验收。 |
| I-05 | R001；远端/本地账本 R001/I-02 | 显式绑定、同步和对账分开，且真实 B 站写入只由对应确认动作触发。 | 收藏库、确认执行、IPC/协调器。 | 关系不明显示待对账；同步入口只在绑定完成后显示。 | 确认绑定先显示账号、规则、远端夹、容量和副作用；成功后才可同步。 | 真实调用须在单独确认后发生；失败保留可恢复状态。 | 不能因扫描/同步选择隐式绑定。 | I-03、远端 API、错误恢复。 | 待实施。 | IPC/协调器测试与真实账号受控验收；该验收须用户另行授权。 |

## 本轮实施记录

- 开始前：根目录分支为 `main`，HEAD `ac11286f docs: separate remote favorites from local workspace`；`main...origin/main [ahead 914, behind 1]`。不执行 pull、rebase 或 push，本地 `main` 是本任务的事实来源。
- 开始前存在其他主题的未跟踪账本 `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`。本轮仅在同一工作树中追加本账本及实现文件，绝不触碰该文件。
- 已确认实施计划按 I-01、I-02、I-03、I-04、I-05 的原文关联分为四个安全批次：I-01/I-02；I-03；I-04；I-05。每批完成后回填实际代码位置、自动化验证、界面验收和剩余条件。
- 第一批实际改动：`OldFavoriteGuide.tsx` 以批次 `readiness`（`ready` / `saved`）而非全局标签运行状态判定本轮总览是否可用；`ControlledFavoriteLedgerPanel.tsx` 只在实际删除回调和本轮推荐取消都返回成功后清理提升推荐投影。删除本身失败时不会触发该回调，故原卡片和选择保留。
- 第一批自动化证据：两个定向测试文件共 149 项通过；完整 `npm test` 于 2026-08-16 结束，Vitest 报告 `234 passed` 测试文件、`3810 passed` 测试。输出有既有的 `act(...)` 与组件渲染状态更新警告，以及被测试覆盖的远端失败路径日志；没有失败测试。
- 第三批实际改动（I-04）：标签状态新增逐批 `tagVersionsBySegment` 与 `acceptedTagVersionsBySegment`。旧持久化数据仍可读取，旧 `acceptedSegmentIds` 映射为已采用版本 `0`，不会强制再次采用。已完全采用且当前批无待办时，“继续补取标签”会把该批已确认且可读取的条目重新排队；仍有待办时只继续剩余条目。只有读到与已确认内容不同的标签，才递增该批版本、显示“采用当前标签”并在显式采用后重建系统分类、推荐和预览；内容相同（忽略顺序与重复项）不会触发重建。人工分类和已勾选推荐在再次采用后保留。为保证恢复后只读当前批的原有性能边界，推荐索引只在用户实际继续/采用而需要它时恢复。
- 第三批自动化证据：`npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts electron/main/oldFavoriteWorkspaceScanService.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx` 报告 4 个测试文件、400 项通过；完整 `npm test` 于 2026-08-16 报告 `234 passed` 测试文件、`3824 passed` 测试；`npm run build` 退出码为 0。完整测试输出含既有 `act(...)` 警告和覆盖远端失败路径的日志，但无失败测试。
- 第三批开发版验收：开发版窗口、掌库和“整理收藏”入口可以打开；检测到实际未完成草稿后，只关闭弹窗，未选择继续/合并/重扫/放弃，未触发扫描、备册、绑定、同步或任何 B 站写入。该真实草稿不适合作为无副作用的多次标签循环演练，因此 I-04 的按钮状态循环、鼠标移动/点击/滚动、窗口缩放、最小化和关闭仍待使用专门测试草稿的受控验收。
