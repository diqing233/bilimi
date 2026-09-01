# 整理收藏未打开时备册状态投影回归账本

## 原文需求

### R001

截图附件：
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-90fe2fce-259a-45ca-a30a-0bb0f31a8a50.png`

代码怎么又回退了，你项目书咋看的，未打开整理收藏卡片正常显示备册情况，以及详情

### R002

截图附件：
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-6e758157-8fb4-4d85-ad6d-1c79de0a7c26.png`

这是以前做好的能力，你看看是之前哪次提交是正确的，参考去修改，还有批阅未备册的提示也参考原来的改
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-6e758157-8fb4-4d85-ad6d-1c79de0a7c26.png">[截图内容待界面验收]</image>

### R003

截图附件：
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-32ba1e77-94d4-4db8-b453-20514055c189.png`

另外展开后，上下移动条应该在当前展开的完整内容下面，从后台任务开始
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-32ba1e77-94d4-4db8-b453-20514055c189.png">[截图内容待界面验收]</image>

## 逐项索引

| 编号 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002 | 未打开“整理收藏”界面时，掌库收藏夹卡片和打开后的详情都显示权威备册/绑定状态；只有整理收藏界面实际展示期间才按项目书隐藏卡片级远端生命周期标签，详情继续显示真实状态。卡片与详情使用同一规则 ID、远端 folder ID 和主进程快照，不因暂停/恢复工作区残留而误判为界面正在整理。历史正确实现优先参考 `3e8787cc`（卡片仅依据 `hasExpandedOrganizationGuide` 隐藏；详情始终显示真实状态），并复核其批阅未备册提示实现，不能退化为工作区存在即隐藏。 | `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 卡片与详情；`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx` 整理工作区可见性；`src/renderer/src/features/assistant/FloatingAssistantApp.tsx` 掌库/批阅状态提示 | 未打开整理收藏或整理向导已收起：卡片显示“已备册/未备册/未绑定”等真实状态，详情同样显示；整理收藏卡片/向导实际可见时，卡片级生命周期标签隐藏，详情仍显示真实状态。暂停、恢复草稿或后台状态本身不等于整理界面可见。批阅入口的未备册提示须沿用历史中文文案和真实启用/备册统计，不因整理工作区残留误报。 | 切换掌库、批阅、展开/收起整理收藏、打开详情后，状态投影立即与当前权威快照一致；不删除规则、不改变勾选、不重建绑定。 | 只读本地权威状态；不执行 B 站创建、绑定、删除、备册、同步或视频写入。 | 不改整理分类、推荐收藏夹、删除模式、统一同步弹窗、DeepSeek、启动响应和安装向导。 | `organizationActive`、`hasExpandedOrganizationGuide`、`statusLabelForLedger`、`editorStatusLabelForLedger`、`favoriteLedgerStatusSummary`、批阅状态灯/提示、主进程收藏夹状态快照。 | 待讨论确认 | 当前截图显示整理状态“已暂停”且界面未展开；需用自动化回归和真实 Electron 视图分别验证掌库卡片、详情和批阅未备册提示。 |
| I002 | R003 | 展开全局提示时，顶部当前提示的完整内容固定完整显示；垂直滚动区域从`后台任务`开始，仅滚动后台任务与最近提示，不改变顶部内容、顺序或既有提示文案。 | `src/renderer/src/features/assistant/FloatingAssistantApp.tsx` 全局提示展开 DOM；`src/renderer/src/styles.css` 对应滚动容器 | 展开时顶部完整提示不出现截断或省略号，滚动条位于其下方并从后台任务开始；收起时保持原有单行/摘要外观。 | 滚动只影响后台任务和最近提示区域；提示展开/收起、任务点击和状态灯导航保持响应。 | 纯渲染布局调整，不改提示历史、任务状态或持久化。 | 不改备册状态、整理业务、DeepSeek、启动或安装向导。 | `globalFeedbackExpanded`、`globalFeedbackContinuation`、后台任务/最近提示 DOM、滚动 CSS。 | 待讨论确认 | 需自动化验证滚动容器边界与文本完整性，并在真实 Electron 截图验收顶部固定、滚动条起始位置。 |

## 实施回填（2026-09-02）

- I001 已实施：`FavoriteLedgerOverview.tsx:595-621` 仅以 `hasExpandedOrganizationGuide` 控制卡片级远端状态隐藏；暂停/恢复工作区生命周期不再隐藏卡片状态，详情继续使用真实状态。`FavoriteLedgerOverview.test.tsx` 相关回归 125/125 通过。真实 Electron 卡片、详情和批阅提示待用户验收。
- I002 已实施：`FloatingAssistantApp.tsx:5478-5498` 将完整续文放在固定区，`floating-assistant-global-status__menu-scroll` 仅包住后台任务与最近提示；`styles.css:2009-2045` 将外层设为隐藏溢出、内层负责滚动。相关渲染与样式测试 165/165 通过。真实 Electron 顶部固定和滚动条起点待用户验收。

索引状态已同步为“已实施待验证”：I001 的自动化回归 125/125 通过；I002 的渲染与样式回归 165/165 通过。两项均保留真实 Electron 界面验收条件，未以自动化测试替代截图和交互验收。

> 索引表中 I001、I002 原状态“待讨论确认”由本节“已实施待验证”记录明确覆盖；原文区保持不变以满足逐条审计要求。

## 讨论结论

### 历史实现核对（只读）

- `3e8787cc`（2026-08-26，`fix: restore favorite rule history`）的 `FavoriteLedgerOverview` 卡片状态只在 `hasExpandedOrganizationGuide` 为真时隐藏，未打开整理向导时仍显示真实备册状态；详情编辑器始终显示真实状态。后续 `54ede139` 将 `organizationActive` 并入卡片和提示隐藏条件，`21adeef2` 只恢复了详情状态，没有撤销卡片条件，因此当前回归应参考前者的行为而不是整提交回退。
- 截图所示批阅未备册提示的原始中文链路来自 `b1fa3522`（2026-08-10，`fix: block unbound review targets`）并由 `d8e75635` 的强制预检补强：`当前收藏夹尚未备册或未绑定，本次仅完成预分类，未创建或写入 B 站收藏夹；请先去掌库收藏夹备册或重新绑定，完成后可归类到 [目标]。` 普通批阅提示在 `src/renderer/src/features/actions/actionExecutor.ts:54-62`，DeepSeek 二判对应提示在 `src/renderer/src/App.tsx:3447`；两者都不是整理向导的隐藏文案。
- 本轮拟采用最小修复：恢复 `3e8787cc` 的卡片可见条件，保留 `21adeef2` 的详情真实状态；复核批阅提示仍由真实预检状态生成并保持上述中文文案，不改分类、B 站写入或整理业务。
- R003 的当前布局由 `44919f7f` 引入：展开菜单把无标题续文和“后台任务/最近提示”放进同一个 `overflow: auto` 容器，导致滚动条从续文前开始。`0ac841c7` 只调整了续文字体和边界样式，未改变这一 DOM 结构。修复时不回退整提交，而是把续文移到固定区，将“后台任务”及“最近提示”包入独立滚动容器；外层采用纵向布局和 `min-height: 0`，保证滚动条从后台任务内容起始且不影响提示点击。

### 待用户决定

无。

### 被明确替代 / 明确不做

无。

## 实施计划（用户说“开始”后才执行）

1. 对照项目书第 4.1、5.1、全局提示顺序约束和既有状态投影契约，确认“整理界面可见”与“工作区存在/暂停”是否被错误合并，并锁定 `44919f7f` 的滚动 DOM 回归。
2. 先为暂停工作区但整理界面未打开的卡片与详情添加失败回归测试，要求卡片和详情都显示权威备册状态；再测试整理界面实际展开时的既有隐藏语义。
3. 以最小改动拆分界面可见条件与工作区生命周期条件，不改任何 B 站副作用或整理业务。
4. 针对 R003 先验证展开提示的固定续文、滚动容器起点和后台/最近提示顺序，再运行相关 Vitest、全量测试、构建和真实 Electron 界面验收；逐项回填代码位置、测试和截图证据后再提交。
