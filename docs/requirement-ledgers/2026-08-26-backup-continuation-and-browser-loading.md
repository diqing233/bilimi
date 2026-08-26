# 2026-08-26 备册继续执行与新网页加载遮罩

> 本账本保留本轮讨论原文。2026-08-26 用户已说“开始”；本轮仅实施 I001、I002，始终不执行真实 B 站写入。

## 原文区

### R001

附件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-92ff8300-0341-4e7f-b5de-e934b3e420d2.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-7f091c5e-6a26-4957-b584-83bf1d2b217a.png`

原文：

```text
保留之前所有的效果，检查这两个bug是为什么
图一点击同步到b站，出现了弹窗，点击备册并开始后变成了这样
图二打开新网页都会有遮罩
```

截图目标区域：

- 图一右侧“整理收藏 → 扫描概览”显示“工作镜像损坏，已完成的收藏库结果不会丢失”及“重建工作镜像并重新扫描”。
- 图二新打开的 B 站网页被整页半透明遮罩覆盖，中央显示“正在加载 B 站页面…”。

### R002

原文：

```text
先提交一下再继续，一定要保留好效果
```

### R003

原文：

```text
开始，做完休眠电脑
```

## 逐项索引表

| ID | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 修复统一同步前备册确认中开始执行时，工作区的短暂 journal 读写交错被误显示为“工作镜像损坏”；保留此前备册、统一确认、分类、归档预览和同步效果。 | `确认并同步到 B 站` → `同步前备册确认` → `备册并开始`，以及工作区持久化恢复。 | 仅在当前工作区真实无法恢复时才显示重建；不能把可校验的工作区误显示为损坏。 | 恢复读取排在已提交写入后；若渲染器已拿到短暂 recovery 快照，作一次有界后台重读，只有健康快照才替换它。 | 不执行 B 站创建、绑定、删除、移动或视频写入；不得改写用户草稿。 | 不改 DeepSeek、转写、删除确认、视频同步执行、单个备册入口或无关功能。 | 统一备册确认、偏好保存、工作区 journal/manifest、恢复投影、冻结/同步。 | 已实施，真实 B 站路径待安全验收 | RED→GREEN：`oldFavoriteWorkspaceStore.test.ts` 新增 in-flight overlay→recover 回归，旧代码读到空分类、实现后读到已提交分类；`useOldFavoriteWorkspace.test.tsx` 新增 recovery→健康快照回归，旧代码停在 recovery、实现后 331ms 恢复。两文件与 `BiliWebview` 聚焦回归共 145/145 通过。未点击备册并开始，因该动作会产生真实 B 站副作用。 |
| I002 | R001 | 修复新网页已完成初始加载却永久显示整页“正在加载 B 站页面…”遮罩的问题，并保留真实网络失败提示与已有网页交互。 | `BiliWebview` 新建标签初始加载、导航开始、完成/失败事件及加载样式。 | 加载反馈不能在页面已可用后持续遮住页面；网络失败卡片仍应保留。 | 监听器安装后若 guest 已分配 webContents 且 `isLoading() === false`，收束初始加载；普通导航仍由开始/完成/失败事件控制。 | 无 B 站写入副作用。 | 不改收藏夹业务、DeepSeek、转写、删除确认、同步执行或其他无关页面。 | 新标签挂载时序、Electron WebView 事件、`loading` 状态和遮罩 CSS。 | 已实施，Electron 已验收 | RED→GREEN：`BiliWebview.test.tsx` 新增“已就绪 guest 错过 did-finish-load”回归，旧代码遮罩不消失、实现后通过；三份聚焦测试 145/145 通过。Electron 只读：主页打开“热门”新标签，加载遮罩在完成后消失；截图`.codex-artifacts/2026-08-26-webview-loading-cleared-read-only.png`。未触发网络失败卡，失败卡由既有 26 项 WebView 回归覆盖。 |
| I003 | R002 | 在继续当前轮诊断前，选择性提交已验证的上一轮收藏夹历史恢复改动；继续排查时必须保留已完成的统一备册确认、规则恢复、分类投影、归档预览、同步链和 B 站页面既有效果。 | 本地 `main` 提交边界与后续诊断/实现范围。 | 只暂存上一轮 I015 的代码、测试、账本和计划；不将当前诊断账本、锁文件或其他主题文件混入。 | 提交后继续诊断；后续任何修复均须以回归保护既有效果。 | 提交不产生 B 站副作用。 | 不使用 reset、stash、clean、revert 或 checkout；不改写用户草稿。 | I001、I002 的根因定位以及上一轮 I015 历史恢复提交。 | 已实施 | 本地提交 `3e8787cc fix: restore favorite rule history`，仅含 I015 相关 6 文件；提交前 `npm test` 为 240 文件、4079 测试全通过，`npm run build` 与 `git diff --cached --check` 通过。 |
| I004 | R003 | 本轮代码、文档和验证全部完成且本地提交后，让电脑休眠一次。 | Windows 电源状态。 | 仅在通过最终测试、构建、差异检查并提交后执行。 | 休眠前保留当前工作树与本地提交。 | 不执行 B 站副作用。 | 不删除文件、不重置/隐藏改动。 | I001、I002 的最终验证与本地提交。 | 待提交后执行 | `npm test`（240 文件、4082 测试）和 `npm run build` 均已通过；提交前差异检查与本地提交后才安排休眠。 |

## 条目分类

### 已确认

- I001（R001）：仅诊断“备册并开始”后工作镜像误报损坏，并保护既有效果。
- I002（R001）：仅诊断新网页整页加载遮罩，并保护网页交互和失败提示。
- I003（R002）：先选择性提交已验证的上一轮收藏夹历史恢复改动；继续时保护既有效果。
- I004（R003）：最终验证并提交后，休眠一次电脑。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 在用户明确说“开始”前不修改功能代码、不执行真实 B 站写入。
- 不执行真实 B 站创建、绑定、删除、移动或视频写入。

## 诊断记录（2026-08-26）

- I001：截图中的文字只会在渲染器收到 `recovery: 'rebuild-required'` 时显示；对应投影位于 `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`。该状态由主进程 `OldFavoriteWorkspaceStore.recover()` 的完整恢复失败、缺少扫描事件/当前分段等多种条件共用。`recover()` 当前将所有恢复异常捕获后统一返回同一状态，不保留失败类别、文件或原始错误，因此截图发生后的现有代码无法反查当时究竟是哪一项失败。
- I001：对开发用户数据中当前工作区进行只读校验：`manifest.json` 校验通过；一个基线分段校验通过；`overlay.journal.jsonl` 的 2,611 条已提交记录、18,383,293 字节 cursor 和链式 SHA-256 校验一致；当前仓库标记仍指向同一工作区且处于 `executing`。这证明截图后的持久化工作区目前可完整读取，不能把截图直接等同于真实数据损坏或已完成结果丢失。
- I001：恢复投影一旦在某次读取中拿到 `rebuild-required`，前端没有自动用后续成功读取替换该快照；而后台刷新又刻意忽略 recovery 返回值。因此一次短暂恢复失败会持续显示“工作镜像损坏”。这解释了“当前已可校验、界面仍要求重建”的矛盾；具体瞬时失败来源仍需在实施前补可观测性和失败回归后才能定论。
- I001：已定位到与截图时机一致的失败边界：同步确认进入执行意图时，协调器会持久化 `executionIntent` overlay；`OldFavoriteWorkspaceStore.appendOverlayUnsafe()` 对链式 journal 先 `truncate(journalPath, manifest.journalCursor)`，再 `appendFile()`。与此同时 `recover()` 没有进入同一个写入队列，若恰在两步之间读到旧 manifest 的 cursor，就会因 journal 长度暂小于 cursor 抛出 `journal cursor exceeds content`，并被无差别 `catch` 映射为 `rebuild-required`。这与“点击备册并开始后立即出现、稍后磁盘又可完整校验”相符。现有测试只验证真实损坏 journal 应重建，未覆盖这个可恢复的读写交错。
- I001：因此后续修复边界是区分“临时未提交/写入中的 journal”与真正校验损坏，读写必须共享一致边界或采用可重试的稳定读；渲染器还必须允许后续成功恢复替换短暂的 recovery 快照。不能删除真正的损坏保护，也不能把异常直接当作成功。
- I002：整页遮罩来自提交 `fc2fd926` 新增的 `BiliWebview` 初始 `loading=true` 和 `.browser-loading { position: absolute; inset: 0; z-index: 4; }`。新标签的 WebView 在 React effect 安装 `did-finish-load` 监听器前即可完成缓存页面加载；此时完成事件丢失，`loading` 永远不会清除。已有 `dom-ready` 监听器只上报目标状态，并不清除 `loading`。截图符合这一事件先后顺序。
- I002：`BiliWebview` 现有 25 条自动化测试均在监听器安装后主动派发 `did-finish-load`，所以覆盖正常开始/结束，未覆盖“首次完成事件先于监听器”的新标签路径。`electron/main/oldFavoriteWorkspaceStore.test.ts` 的 36 条测试也全部通过，证明通用存储案例未复现这一次时序/恢复组合。

## 实施证据（2026-08-26）

- I001：`electron/main/oldFavoriteWorkspaceStore.ts` 将 `recover()` 排入既有 store 写入队列，原恢复逻辑移入私有 `recoverUnsafe()`；这避免了链式 journal 的 `truncate` 与 `appendFile` 之间被恢复读取。`src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts` 对 recovery 快照仅安排一次 250ms 后台健康重读；健康快照才替换错误页，连续 recovery 不循环重读，真实损坏仍显示重建。
- I002：`src/renderer/src/features/browser/BiliWebview.tsx` 在完成监听器安装后，于已有零延迟 target probe 中检查 webContents id 和 `isLoading()`；只有 guest 已存在且明确未加载时才调用已有成功收束，不改导航开始、`did-finish-load`、`did-fail-load`、失败卡或页面会话逻辑。
- 自动化：I001/I002 的三份聚焦回归为 145/145；统一备册确认、归档预览、历史恢复、协调器和扫描概览保护回归为 636/636。`npm test` 完整运行结果为 240 文件、4082 测试通过（350.62 秒）；`npm run build` 通过。提交前的 `git diff --check`、差异统计、工作树核对与选择性暂存仍待执行。
