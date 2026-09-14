# 需求账本：弹窗滚动布局复查

> 主题起始：2026-09-14
> 当前阶段：已实施，待用户在真实 Electron 窗口做最终视觉验收

## 原文区

### R001

时间：2026-09-14

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-068ffa14-e687-4905-814d-b3b1408ab416.png`

截图目标区域：以截图所示“删除 bilimi 收藏夹”弹窗为设计参照；用户指出的结构是“只有中间部分可上下移动”。需核对标题、底部操作区与中间可滚动内容区的边界；截图文字、尺寸、颜色、字重、间距在后续界面验收时待逐项核对。

用户原文：

> 复查整个项目还有哪些弹窗没有用这个设计，只有中间部分可上下移动，确认同步到b站按钮的弹窗好像是老版本

## 逐项索引

| 编号 | 状态 | 精确目标 | 目标界面／数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化／迁移／B站副作用 | 明确不改边界 | 上下游依赖 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001（R001） | 已实施，真实 Electron 视觉验收受环境限制 | 复查全项目仍未使用“仅中间部分可上下移动”结构的应用内弹窗 | 所有 renderer 自定义 Modal／Dialog 及其样式；原生系统窗口不纳入 | 按各弹窗既有触发、关闭条件核对 | 保留既有触发、关闭、busy、焦点、Escape 与遮罩状态；标题／关闭区和 footer 固定，正文单独滚动 | 未变更数据持久化、迁移或 B 站调用 | 不修改 Electron 原生窗口、B 站网页弹窗、`CommentChooser`／`CommentIntentDialog`／`CoinPrompt` 浮动短卡 | 共用 `BilimiModal`、`OldFavoriteModal`、收藏库确认入口 | 代码：`BilimiModal.tsx`、`styles.css`；收藏库、文稿档案、模型设置和本地数据确认均已接入。测试：`npm test` 255 文件／4687 项通过；`npm run build` 通过。实机窗口：Computer Use 认证不可用，未能验收截图中的字号、颜色、间距、滚动和鼠标手感，见 A004。 |
| I002（R001） | 已实施，真实 Electron 视觉验收受环境限制 | 重点确认“确认同步到b站”按钮触发的确认弹窗是否为旧版结构 | 整理收藏／收藏库的“确认并同步到 B 站”触发链及最终弹窗 | 点击该按钮后显示；按既有取消、确认、失败状态核对 | 预检列表归入共用正文滚动区，`确认备册并继续`／`确认并同步` 继续由固定 actions 承载 | 未变更预检、精确 ID 绑定、备册、暂存、保存收藏库或 B 站同步调用；未触发真实 B 站操作 | 不修改同步策略、数据写入、任务状态 | `OldFavoriteConfirmationStep`、`ControlledFavoriteLedgerPanel`、`OldFavoriteModal`、`BilimiModal` | 代码：`ControlledFavoriteLedgerPanel.tsx`、`styles.css`；测试：`ControlledFavoriteLedgerPanel.test.tsx` 和全量 `npm test` 通过。真实 B 站／窗口流程未执行，见 A004。 |

## 本轮实施前清单

用户已于 2026-09-14 明确说“开始”。实施前已重新通读本文件全部原文区、逐项索引及审计证据，并在 Git 基线 `main...origin/main [ahead 1205, behind 1]`、除本账本外无未提交改动、最近提交 `bdf84731 fix: isolate local save and preserve deleted folders` 的前提下，形成如下实施计划。

### 已确认实施条目

1. I001（R001）：对应用内覆盖式确认弹窗统一为固定标题／关闭区、唯一可纵向滚动正文区、固定底部操作区；不改 Electron 原生窗口、B 站网页弹窗和既有业务副作用。
2. I002（R001）：将“确认并同步到 B 站”实际显示的“同步前备册确认”接入上述结构，保留原有预检、精确 ID 绑定、备册、暂存与同步流程。
3. A001 已确认范围：收藏库确认弹窗的取消／确认区移入固定 footer；文稿档案删除、转写模型下载／删除、本地数据清理这三类语义确认界面接入同一共用弹窗。
4. A001 明确不改：浮动助手短交互卡不新增标题、不改写文案；评论候选已有独立滚动，保持现状。

### 待用户决定

无。

### 被明确排除

1. Electron 原生关闭确认和文件打开／保存窗口（A001.5）：系统窗口不纳入 renderer 弹窗改造。
2. B 站网页自身弹窗（A001.5）：非 bilimi UI，不纳入本轮。
3. 已无 JSX 使用点的遗留 CSS（A001.5）：不以本轮界面改造之名清理，避免扩大范围。

### 实施计划

1. **共用弹窗骨架（I001、I002）**
   - 允许修改：`src/renderer/src/components/BilimiModal.tsx`、`src/renderer/src/styles.css`、`src/renderer/src/components/BilimiModal.test.tsx`、`src/renderer/src/styles.test.ts`。
   - 结果：共用弹窗改为纵向三段 flex/grid 布局，外层隐藏溢出；正文为唯一的可滚动区域，标题／关闭与 actions 不参与滚动。保留 portal、焦点管理、Escape、遮罩、busy 和现有按钮语义。
   - 风险与回归：小窗口、无 actions 弹窗、长正文、嵌套弹窗和滚动锁可能受影响。先写 CSS／DOM 契约失败测试，再运行 `BilimiModal.test.tsx` 与 `styles.test.ts`；随后在 Electron 开发版检查滚轮、点击、关闭、缩放、最小化和关闭窗口。
2. **收藏库及同步前备册确认（I001、I002）**
   - 允许修改：`src/renderer/src/features/favorites/FavoriteLibraryDialogs.tsx`、`src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`、`src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`、`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`、相关 assistant 测试、`src/renderer/src/features/favorites/FavoriteLibraryApp.css`、`src/renderer/src/styles.css`。
   - 结果：收藏库所有确认弹窗把取消／确认等操作传给 `BilimiModal.actions`；“同步前备册确认”使用可滚动的预检主体，底部“确认备册并继续／确认并同步”固定。预检、勾选、精确 ID、暂存开关和所有 IPC 调用保持原样。
   - 风险与回归：确认按钮的 disabled/busy、关闭行为、复选／单选状态和远端副作用。先写失败测试证明 footer 不在正文内及同步预检存在独立滚动容器；运行收藏库、整理收藏相关测试，不执行真实 B 站操作。
3. **其余覆盖式确认窗口（I001）**
   - 允许修改：`src/renderer/src/features/notes/VideoNoteArchivePanel.tsx`、其测试、`src/renderer/src/features/assistant/TranscriptionModelSettings.tsx`、其测试、`src/renderer/src/features/assistant/LocalDataSettings.tsx`、其测试以及必要的样式。
   - 结果：档案删除、模型下载／删除、本地数据清理均复用 `BilimiModal` 的固定三段结构；保留原有标题、确认／取消文案、回调和禁用状态。
   - 风险与回归：破坏性操作意外触发、关闭路径、模型下载／删除及本地数据清理文案。逐项先写失败测试并运行各组件测试。
4. **集成验证与提交（I001、I002）**
   - 允许修改：本账本索引中的实施证据字段；不修改业务数据、迁移或 B 站状态。
   - 结果：运行 `npm test`、`npm run build`、开发版和 `npm run preview` 的关键路径检查；按截图逐项核对标题、正文滚动条、footer、关闭、窄窗、busy、键盘焦点，以及不触发 B 站操作。仅在工作树预期干净、检查通过且无无关改动时提交本轮代码与账本。

## 审计证据

### A001：应用内弹窗结构盘点（只读）

审计标准：截图所示的长内容弹窗应当由固定标题／关闭区、唯一可纵向滚动的正文区、固定底部操作区组成；滚动条不得落在整张对话框上。短内容不一定出现滚动条，但结构仍须在内容变长时保持上述边界。

1. 共用基座 `src/renderer/src/components/BilimiModal.tsx:103-136` 已在 DOM 中分出 `header`、`body`、`actions` 三段；但 `src/renderer/src/styles.css:188-260` 让 `.bilimi-modal__dialog` 整体 `overflow: auto`，`.bilimi-modal__body` 没有自己的滚动和弹性剩余高度。故所有未额外覆盖的 `BilimiModal` 使用方在内容超高时都会令标题、关闭按钮和底部操作区随整张弹窗一起滚动。
2. 已正确实现局部滚动的明确例外：
   - 右侧规则“删除 bilimi 收藏夹”：`FavoriteLedgerOverview.tsx:1982-2012` 的 `.favorite-ledger-panel__deletion-list`，`styles.css:4941-4961`；这是截图中红框对应的列表。
   - 右侧规则“确认绑定 bilimi 收藏夹”：`FavoriteLedgerOverview.tsx:2091-` 的 `.favorite-ledger-panel__rebind-scroll`，以及 `styles.css:8579-8614`；该变体明确锁定外层、标题和底部操作区。
   - 收藏库内各工作夹列表：`FavoriteLibraryApp.tsx:2731-2811` 的 `.favorite-library__managed-folder-preview`，`FavoriteLibraryApp.css:295-297`；列表本身会滚动，但底部操作仍在通用正文内，不能保证固定。
   - 导出文稿完成结果：`VideoNoteBatchExportDialog.tsx:170-205` 的 `.video-note-export-dialog__result-list`，`styles.css:3840-3862`；结果列表本身会滚动，但仍受通用外层整卡滚动缺陷影响。
   - 小咪推荐评论：`CommentChooser.tsx:54-89` 与 `styles.css:10-82`；候选列表独立滚动，取消按钮定位在底部。这是助手内的紧凑浮层，不是带标题栏的居中应用弹窗。
3. 未符合或无法保证符合目标结构的正式弹窗：
   - 全部常规 `OldFavoriteModal`：规则删除、远端发现处理、同步前备册确认、结束整理、停止同步、恢复／重扫和 DeepSeek 确认；除“确认绑定”专用变体外均受共用基座影响。
   - 全部 `FavoriteLibraryConfirmationDialog`：批量／单项本地删除、B 站移除、备册、改名、绑定、工作夹删除和冲突处理。其确认按钮由子内容中的 `.favorite-library__dialog-actions` 提供，而非 `BilimiModal.actions`，故即使基座修正也需要将操作区移到固定 footer。
   - 直接 `BilimiModal`：多 P 转写选择、导出文稿、DeepSeek／全部设置重置、无限制批次确认、备册新增分区确认；均需随基座一并回归。
4. 另外发现三类不应静默遗漏的旧式确认界面：
   - `VideoNoteArchivePanel.tsx:953-969`：底部固定位置的“确认删除”小弹窗，不是居中三段式窗口。
   - `TranscriptionModelSettings.tsx:195-214`、`LocalDataSettings.tsx:110`：设置页内嵌确认卡，带 `role=dialog/alertdialog` 但并非覆盖式应用弹窗，当前没有独立滚动与固定页脚；是否纳入统一弹窗改造需用户决定。
   - `CommentIntentDialog.tsx`、`CoinPrompt.tsx`、`CommentChooser.tsx`：浮动助手内部短交互卡；其中评论候选已经局部滚动，其余两项无可滚动长内容。
5. 未计入改造范围：Electron 原生关闭确认和文件打开／保存窗口（`electron/main/index.ts:1455,2255,2315,3437,3441`）、B 站网页自身弹窗，以及下列已无 JSX 使用点的遗留 CSS：`.favorite-ledger-panel__incremental-dialog`、`__modal-backdrop`、`__centered-modal`、`__execution-dialog`、`__sync-dialog`。

### A002：“确认并同步到 B 站”实际链路（只读）

1. 入口按钮位于 `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx:386`，调用 `onConfirmAndSync(false)`。
2. 父级 `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:1673` 传入 `confirmAndSync`；该函数在 `:1330-1333` 进入 `continueConfirmAndSync`。
3. 该流程在存在未备册／未绑定／分册容量／暂存范围时于 `:1281-1296` 生成预检并显示 `bilibiliBackupPreflight`。
4. 最终呈现为 `:1539-1565` 的 `OldFavoriteModal title="同步前备册确认"`，并沿用通用 `BilimiModal` 整卡滚动；原有 `.favorite-ledger-panel__sync-dialog`、`__sync-backup-targets` 样式当前没有 JSX 使用点，未接入该弹窗。因此用户判断成立：这个确认弹窗仍是旧结构。

### A003：审计限制

本轮未获“开始”授权，未修改 UI、未启动真实 B 站同步，也未执行 Electron 实机截图验收；结论来自完整 renderer 组件、CSS、触发链和截图结构比对。实施后需分别验证短内容、长列表、窄窗口、键盘焦点、关闭、取消和 busy 状态，确保固定区域不遮挡正文且不改变现有 B 站／本地业务副作用。

### A004：实施与验收证据

1. **I001 共用结构**：`src/renderer/src/components/BilimiModal.tsx` 保留 header／body／actions 三段 DOM，新增 `ariaLabel` 兼容既有稳定无障碍名称；`src/renderer/src/styles.css` 将 `.bilimi-modal__dialog` 改为 `flex` 纵向容器且 `overflow: hidden`，将 `.bilimi-modal__body` 设为唯一 `overflow-y: auto` 的伸缩正文，并固定 header/actions。`BilimiModal.test.tsx`、`styles.test.ts` 覆盖 DOM、可访问名称与 CSS 契约。
2. **I001 收藏库确认弹窗**：`FavoriteLibraryDialogs.tsx` 新增 `actions` 转传；`FavoriteLibraryApp.tsx` 将批量删除、备册、改名、绑定、工作夹删除、冲突处理以及视频详情本地／远端删除的最终操作移入 `BilimiModal.actions`。正文中“全选”仍留在正文。`FavoriteLibraryApp.css` 的 hover/focus 范围调整为对话框内 footer／正文均生效。`FavoriteLibraryApp.test.tsx` 覆盖按钮位于 footer 而非正文。
3. **I002 同步前备册确认**：`ControlledFavoriteLedgerPanel.tsx` 对实际的 `同步前备册确认` 使用 `old-favorite-modal__dialog--sync-preflight`，预检列表使用 `favorite-ledger-panel__sync-backup-targets`，去掉该列表自身的高度／滚动限制，由共用正文承担唯一滚动。未改确认回调、disabled 条件或任何 B 站 IPC。`ControlledFavoriteLedgerPanel.test.tsx` 覆盖该布局钩子与保留的确认流程。
4. **I001 其余正式确认窗**：`VideoNoteArchivePanel.tsx` 的档案／版本删除、`TranscriptionModelSettings.tsx` 的模型下载／删除、`LocalDataSettings.tsx` 的本地数据删除均迁移到 `BilimiModal`；对应三个测试文件验证标题、按钮、危险语义和 footer。迁移时移除了本地数据旧内嵌卡对 `display:grid` 的继承，避免覆盖共用三段 flex shell；该冲突由 `styles.test.ts` 锁定。
5. **源码复查**：重新搜索 renderer 正式 `role="dialog"`／`role="alertdialog"`、`BilimiModal`、`OldFavoriteModal` 和 `window.confirm`。剩余 `role="dialog"` 仅为掌库主容器及明确排除的浮动短卡；其余居中确认窗口通过 `BilimiModal`／`OldFavoriteModal` 共用结构。未改 Electron 原生系统窗口、B 站网页自身弹窗或浮动短卡。
6. **自动化与构建**：最终 `npm test` 于 2026-09-14 运行完成，`255 passed`、`4687 passed`；`npm run build` 成功（仅有既有 dynamic/static import 警告）；`npm run preview` 成功完成构建并记录 `start electron app...`。全量测试第一次运行出现与本轮无关的收藏库滚动时序断言波动，单测立即通过，最终完整重跑通过。
7. **真实界面限制**：尝试 Computer Use 时返回 `unsupported Codex auth method: apikey`，无法读取或操作 Electron 窗口。因此没有声称已完成截图文字、颜色、字号、字重、间距、窄窗滚动条、鼠标移动／点击／滚动／缩放／最小化／关闭的实机验收；也没有点击确认同步、备册、删除或其他真实 B 站操作。
