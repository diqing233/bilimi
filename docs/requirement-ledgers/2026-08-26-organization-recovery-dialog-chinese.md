# 2026-08-26 整理收藏恢复弹窗中文化与状态按钮

> 本账本保留本轮讨论原文。用户已于本轮明确说“开始修复”；以下原文保持不变，实施证据仅追加在原文与索引之后。

## 原文区

### R001

附件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-b55c2ea1-f9fa-4626-898c-22ff38510259.png`

原文：

```text
讨论这个是什么bug，按照项目书应该只有三种按钮，没有英文
```

截图目标区域：

- 右侧“整理收藏”上方出现模态框，正文泄露英文技术错误：`Error invoking remote method 'old-favorite-workspace-v1:prepare-recovery': Error: Old favorite workspace requires rebuild.`；右下只有“重试暂停”按钮。
- 用户指出：按项目书，此处应仅出现既定的三种按钮/状态，不应显示英文技术异常。

### R002

附件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-f56608f4-2683-4d1d-b34b-2d413908299c.png`

原文：

```text
还有这个网页已经打开了还有这种提示，以前从来没有的
```

截图目标区域：

- 第二个 B 站网页标签已显示视频页正文、播放器和右侧推荐列表，但整页仍被半透明加载遮罩覆盖，中央显示“正在加载 B 站页面…”。
- 用户指出该提示以前从未出现，要求讨论其原因。

## 逐项索引表

| ID | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明“整理收藏”恢复/重试弹窗泄露英文 IPC/主进程错误、且只出现“重试暂停”而非项目书既定恢复状态操作的原因；后续若实施，错误必须中文化并按既定三种恢复选择投影。 | 右侧“整理收藏”恢复准备与错误模态框。 | 仅在工作区恢复准备失败或恢复状态需要用户决策时显示；普通健康工作区不得显示。 | 必须区分真实需重建、可恢复草稿与短暂读取/调用失败，不能将底层错误字符串直接作为用户文案。 | 本轮讨论不执行任何 B 站创建、绑定、删除、移动或视频写入。 | 不改备册、统一同步确认、DeepSeek、转写、删除确认、视频同步执行或无关页面。 | `prepare-recovery` IPC、恢复摘要、渲染器错误映射、项目书中的恢复选择契约。 | 已实施待真实故障镜像验收 | 代码：`electron/main/index.ts`、`electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`、`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`。自动化：`oldFavoriteWorkspaceCoordinatorIpc.test.ts` 的结构化重建摘要、`ControlledFavoriteLedgerPanel.test.tsx` 的英文错误屏蔽；聚焦回归 231/231 通过。为避免制造/损坏真实工作镜像，Electron 未实操此路径；无 B 站副作用。 |
| I002 | R002 | 查明已可见的 B 站视频页仍被“正在加载 B 站页面…”整页遮罩覆盖、且此退化此前未出现的原因；后续若实施，加载反馈只能覆盖尚未可用的主页面加载。 | 第二个 B 站网页标签的 `BiliWebview` 页面级加载反馈。 | 主页面已可用后必须隐藏；真实主框架导航开始时可显示；子框架、站内异步内容、陈旧导航事件不得永久遮罩页面。 | 导航状态须与当前标签、当前主框架导航 epoch 对应；不能因一个旧/子框架事件覆盖已完成的新页面状态。 | 无 B 站写入副作用。 | 不改收藏夹、DeepSeek、转写、删除确认、同步执行或网页内容本身。 | WebView 的 `did-start-loading`/`did-stop-loading`/`did-finish-load` 事件、主框架识别、导航 epoch 与 React loading 状态。 | 已实施并已 Electron 只读验收 | 代码：`src/renderer/src/features/browser/BiliWebview.tsx`。自动化：`BiliWebview.test.tsx` 覆盖 `dom-ready` 无 finish 和 `did-stop-loading` 收束；聚焦回归 231/231 通过。Electron 开发版打开视频页并只读刷新后，正文可见时遮罩已消失；截图：`.codex-artifacts/2026-08-26-webview-ready-without-veil.png`。未进行收藏、备册、绑定、删除、同步或视频写入。 |

## 条目分类

### 已确认

- I001（R001）：诊断英文技术错误泄露与恢复按钮状态偏离项目书。
- I002（R002）：诊断已打开网页仍被整页加载遮罩覆盖的回归。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 讨论期间不修改功能代码，不执行任何真实 B 站操作。

## 诊断记录（2026-08-26）

- 项目书第 5.1 节的三项 `恢复草稿`、`重新扫描`、`放弃本轮整理`，只适用于**未结束且可安全恢复**的工作区；该节同时明确“工作镜像损坏/无法校验仍走重建路径，不得伪装为可恢复草稿”。因此截图中的底层 `requires rebuild` 条件本身不应强行显示三选一；正确用户界面应是中文的镜像损坏说明与既有 `重建工作镜像并重新扫描` 入口。
- 截图暴露的实际缺陷有两层。第一层：`electron/main/index.ts` 的 `prepareRecovery` 已从 `getSnapshot()` 得到 recovery/rebuild 状态，却仍无条件调用 `oldFavoriteWorkspaceDeepSeekService.pauseForRecovery()`；后者在没有内存检查点时调用协调器的 `getDeepSeekRunCheckpoint()`，该方法经 `requireWorkspace()` 将 recovery 状态抛为 `Old favorite workspace requires rebuild.`。IPC 仅对“恢复决定过期”降级为摘要，其余异常继续抛出，故 Electron 包装成截图中的 `Error invoking remote method …`。
- 第二层：`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx` 的 `requestOldFavoriteOrganization()` catch 分支直接存入 `error.message`；`resumeDialogOpen && recoveryPreparationError` 分支原样渲染该字符串并提供通用 `重试暂停`。这绕过了同组件正常 recovery summary 的三按钮投影，也绕过扫描概览已存在的中文重建入口。
- 现有测试覆盖可恢复草稿摘要的三选项，以及真实损坏后扫描概览的重建入口；未覆盖“prepare-recovery 因 recovery/rebuild 返回而拒绝时，必须返回结构化重建状态、不得泄露原始 IPC 英文、不得出现重试暂停”的组合。因此该退化未被阻止。
- 后续实施的最小边界应是：已知 recovery/rebuild 状态在主进程安全准备链路短路为结构化 recovery summary 或原 recovery 快照，避免 DeepSeek/同步暂停调用 `requireWorkspace()`；渲染器对不可恢复镜像状态走现有中文重建投影，对其他准备失败走中文、可重试且不误称暂停成功的提示。三选一只保留给可安全恢复的未结束草稿。不得在此路径自动重建、扫描、恢复、调用 DeepSeek 或写入 B 站。

- I002：该遮罩由提交 `fc2fd926 fix: show Bilibili page loading feedback` 新增；在此提交之前没有 `.browser-loading` 覆盖层，因此用户所说“以前从来没有”与版本记录一致。这一功能原本仅为“刷新或导航后页面暂时空白”提供反馈，契约是：当前激活标签在导航开始时显示，成功加载后立即消失，主框架失败时改为错误卡；不能遮挡已经可用的页面。
- I002：截图中的 B 站视频页正文、播放器与推荐列表均已可见，而页面没有代理错误卡。`BiliWebview.tsx` 的遮罩唯一条件是 `active && loading && !proxyConnectionFailed && !loadFailure`，故这不是远端错误投影，而是渲染器 `loading` 未被清除。
- I002：当前实现只在三处收束该状态：`did-finish-load`、`did-fail-load`，以及挂载后**一次**的零延迟 `webview.isLoading() === false` probe。后一次补丁 `e6f0f4e6` 只覆盖“初始 `did-finish-load` 早于 React 监听器”且 probe 时 guest 已经 idle 的情况；若 probe 时仍为 loading，而页面随后先达到可交互状态却没有对应的可观察完成事件，或有后续未配对导航重新置为 loading，页面会停留在截图的永久遮罩。
- I002：现有自动化只覆盖“导航开始 → `did-finish-load`”和“挂载时 guest 已经 idle”两条理想路径；没有覆盖“已显示正文/DOM ready 后仍未取得 finish”或“完成后发生晚到的未配对导航状态”路径。这是本次回归未被测试拦住的直接缺口。
- I002：后续实现不应依赖一个永久布尔状态等待不保证抵达的 `did-finish-load`。应把主页面达到可交互的 `dom-ready`（或同一主导航 epoch 已确认的 ready 信号）作为加载遮罩的收束条件，同时仍用主框架导航失败保留现有错误卡；子框架和旧导航事件不得改变当前主页面可见状态。须先写复现截图所示状态的 RED 回归，再做最小实现和真实 Electron 只读验收。

## 实施记录（2026-08-26）

- I001：`prepareRecovery` 读取到 recovery/rebuild 快照时立即返回结构化 recovery summary，不再进入扫描、DeepSeek 或同步暂停链；暂停过程中若状态转为 recovery 也同样短路。IPC 对 `Old favorite workspace requires rebuild.` 额外降级为结构化 summary，防止竞态或其他入口重新把英文包装错误送往渲染器。渲染器将任何恢复准备异常投影为中文，并把不准确的“重试暂停”改为“重新尝试”。真正 `rebuild-required` 继续使用扫描概览既有的中文重建入口，未被伪装为三选一。
- I002：主文档 `dom-ready` 与 guest `did-stop-loading` 都调用既有的成功收束；`did-finish-load` 继续负责链接捕获、弹幕重绘和归档时间点跳转。主框架导航开始与失败卡逻辑未变。真实 Electron 最初仍暴露 `dom-ready` 单独不足的路径，随后以 `did-stop-loading` 回归覆盖并验证刷新后遮罩消失。
