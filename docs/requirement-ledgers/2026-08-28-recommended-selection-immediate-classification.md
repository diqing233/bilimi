# 推荐收藏夹勾选后即时分类需求账本

> 讨论开始：2026-08-28。讨论模式仅登记用户原文、阅读证据与分析原因；不修改功能代码。

## 原文区

### R001

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-63c97431-ad55-4c05-a06f-8dc7d6514f82.png`

截图目标：`整理收藏 → 推荐收藏夹`的分类结果区。图中 `bilimi·王者荣耀北笙` 显示 `10 条适合`，而 `bilimi·杨颜同学` 显示 `0 条适合`；用户指出推荐项勾选后没有直接出现匹配，必须到上方已保存收藏夹取消勾选再重新勾选，才会被正常识别。

原文：

```text
讨论勾选推荐没有直接出现适合，而是我点击收藏夹取消勾选再重新勾选才能正常识别
```

### R002

原文：

```text
继续讨论查清楚
```

### R003

原文：

```text
继续讨论查清楚
```

### R004

原文：

```text
你确定·查清楚了，已经改了很多次了
```

### R005

原文：

```text
先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R005 | 推荐收藏夹勾选后应立即得到真实分类归属和“适合”数；不能必须额外取消、再勾选上方已保存收藏夹才生效。 | 整理收藏 → 推荐收藏夹、归档预览、当前轮分类快照。 | 已采用推荐项应即时显示它在当前轮实际归属的视频数；未采用项不进入目标。 | 勾选推荐项后产生本轮分类结果；上方规则的后续切换不应是首次结果产生的前提。 | 不触发 B 站创建、绑定、删除或视频写入；持久化草稿仍保留`recommendation-draft / local-draft / unbacked`。 | 不修改 DeepSeek、转写、删除确认、视频同步或单个备册入口；不得以同步遍历造成点击卡顿。 | 推荐采用状态 → 仅分类投影 → 分类器 → 分类 journal / 概览快照 → 归档预览 / 同步预检。 | 自动化已验证；界面部分已验证 | `electron/main/oldFavoriteWorkspaceCoordinator.ts:1003,4181,4332`；RED/GREEN 与 Electron 截图及未验证项见“实施证据与状态回写”。 |
| I002 | R002、R003、R005 | 以真实分类器复现并验证首次采用显示 0 的根因；修复后首次快速路径与上方参与状态变化的完整重分类保持同一分类结果。 | 推荐卡片计数、主进程候选匹配集合、分类与归档快照发布顺序。 | 首次采用的新推荐应无需页面刷新或上方切换即可显示命中；索引不可用时允许降级为完整重分类。 | 测试先证明带`local-draft`代理的快速路径被能力层排除，再只替换分类输入投影。 | 不触发任何 B 站副作用；测试中断言不调用远端创建、绑定、删除或视频写入接口。 | 不改渲染器的既有快照失效逻辑，除非 RED 证明主进程修复后仍有独立覆盖问题。 | I001；协调器队列、能力层、`videoClassifier`、持久化草稿与快照投影。 | 自动化已验证；界面部分已验证 | `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:6054`；根因、RED/GREEN、回归与 Electron 证据见“实施证据与状态回写”。 |
| I003 | R004、R005 | 以可验证证据复核修复，不把单一观察误称为已解决；同时保持按钮点击流畅和既有上/下稳定 ID 联动、取消、历史恢复、备册/同步边界。 | 首次推荐采用、上方参与切换、真实分类快照、持久化规则目录、渲染快照接收。 | 不适用。 | 生产修改仅限推荐快速路径的分类输入；不扩大为远端状态或生命周期改造。 | 不触发 B 站副作用。 | 不改 DeepSeek、转写、删除确认、视频同步、单个备册入口和无关文件。 | I001、I002；主进程队列、持久化偏好、渲染器快照顺序、Electron 交互响应。 | 自动化已验证；界面部分已验证 | 不改渲染器或远端服务；相关回归与 Electron 限制见“实施证据与状态回写”。 |

## 实施前核对与计划（R001–R005）

### 已确认

1. **I001（R001、R005）**：首次勾选推荐收藏夹必须直接产生真实分类与“适合”数量，且不能因为修复而把未备册草稿提升为有 B 站权限的规则。
2. **I002（R002、R003、R005）**：用真实分类器建立 RED，验证快速采用与上方参与变更后的完整重分类对同一输入一致；不以 mock 返回的目标 ID代替分类器验证。
3. **I003（R004、R005）**：验证范围必须包含既有快照发布、稳定 ID联动和 UI 响应性；不以一次测试通过宣称所有既往现象均已消失。

### 待用户决定

无。本轮不改变任何可见文案、规则类型或 B 站确认流程。

### 被明确替代 / 明确不做

无被后续原文替代的本轮需求。明确不做：DeepSeek、转写、删除确认、视频同步、单个收藏夹备册入口，以及任何真实 B 站创建、绑定、删除或视频写入。

### 实施步骤

1. 已先更新项目书 5.5：明确“推荐草稿远端生命周期”与“本地分类输入投影”分离，快速路径不等待上方切换或刷新，并继续有界异步执行。
2. 在`electron/main/oldFavoriteWorkspaceCoordinator.ts`为已采用推荐创建仅用于分类的投影；保留`asLocalRecommendedLedger()`给草稿持久化与远端边界，不改变其状态。
3. 先在`electron/main/oldFavoriteWorkspaceCoordinator.test.ts`写真实`classifyVideoContent`的首次采用 RED：视频先归`game`，首次采用作者推荐后立即归推荐 ID并更新概览；同时断言持久化规则仍是`recommendation-draft / local-draft / unbacked`，且没有远端调用。
4. 在同一测试或相邻回归中，以相同规则/视频比较快速路径和上方参与状态改变后的完整重分类；两者的分类归属与归档统计必须一致。
5. 运行 RED，确认失败原因是候选代理不能分类；再做最小生产修复并运行 GREEN、协调器/分类器/渲染快照回归。
6. 启动 Electron 开发版做只读验收：新草稿首次勾选即显示真实数量，归档预览与确认执行同数；只观察点击、鼠标、滚动、缩放、最小化/关闭响应，不点击任何备册、绑定、创建、删除、同步或 B 站写入按钮。截图保存至`.codex-artifacts/`。
7. 在索引逐项写入代码位置、RED/GREEN、完整测试、Electron 证据和仍无法验证的远端副作用；确认无无关文件后只提交本轮项目书、账本、协调器与测试。

### 实施证据与状态回写

| 索引项 | 状态 | 代码位置 | 自动化证据 | Electron 只读证据 / 未验证项 |
| --- | --- | --- | --- | --- |
| I001 | 自动化已验证；界面部分已验证 | `electron/main/oldFavoriteWorkspaceCoordinator.ts:1003,4181,4332` | RED 已实际失败：首次采用后两条`UP Alpha`仍归`game`。GREEN 使用真实`classifyVideoContent`通过：首次采用立即迁入候选、`overview.archiveTargets`为 2，并断言持久化草稿仍是`local-draft / recommendation-draft / unbacked`。 | 截图`.codex-artifacts/2026-08-28-recommended-selection-immediate-classification/electron-recommended-candidates-readonly.jpg`显示推荐区的真实计数。为遵守只读验收，未点击新草稿首次勾选；该实际用户工作区动作仍待手工验收。 |
| I002 | 自动化已验证；界面部分已验证 | `electron/main/oldFavoriteWorkspaceCoordinator.ts:4181,4332`；`electron/main/oldFavoriteWorkspaceCoordinator.test.ts:6054` | 该回归先复现能力层排除草稿，再在采用快速路径与`setRoundExcludedLedgerIds()`完整重分类后都断言候选 ID与`itemCount=2`相同。协调器 356/356、分类/能力层 19/19、渲染快照/预览 122/122 通过。 | 开发版推荐页可读到已采用`honker233 34 条适合`、`哈米伦的弄笛者 14 条适合`及未采用`王者荣耀北笙 10 条适合`、`杨颜同学 9 条适合`。没有点击勾选、备册或同步；无真实 B 站副作用。 |
| I003 | 自动化已验证；界面部分已验证 | 同 I001；没有改动渲染器或远端服务。 | 相关渲染快照回归 122/122 通过；协调器全套 356/356 通过。生产修复只建立分类投影，`asLocalRecommendedLedger()`持久化与远端边界保持原样。 | 开发版中只做了导航与滚动，界面即时响应；未进行会改写本地草稿的复选框操作，也未在真实账户执行创建、绑定、删除、备册或视频写入。鼠标移动、窗口缩放、最小化/关闭未作可截图的独立手工步骤，不能把它们声称为已完整验收。 |

## 讨论排查记录（只读）

### E001：预览中的数字来自当前分类快照，而非推荐候选的原始命中数

- `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx:51-55`只按`classifications[aid].targetLedgerIds`分组；`136-151`只对已发布快照作展示映射；`300`显示该分组的视频数量。
- 因此截图中`0 条适合`的直接含义是：当前快照没有任何视频的目标 ID 指向该规则；它不等于扫描推荐没有找到对应 UP/标签。

### E002：首次推荐采用在本地规则持久化之前进行分类，传入的只是“本地草稿”代理

- `electron/main/oldFavoriteWorkspaceCoordinator.ts:2327-2350`的顺序是：`applyRecommendedLedgerDeltaUnsafe()`（包含分类）先运行，随后才`persistRecommendedLedgersUnsafe()`。因此首次采用时，账号级规则目录中尚未有该推荐的新规则可供分类器继承身份。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts:4156-4164`在这一步为受影响 AID 调用`asLocalRecommendedLedger()`并送入分类命令。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts:981-993`产生`syncState: 'local-draft'`、`ruleOrigin: 'recommendation-draft'`和`bindingState: 'unbacked'`。
- `src/shared/favoriteLedgerCapabilities.ts:28-35`对该组合返回`canClassify: false`；`src/shared/recommendation/videoClassifier.ts:439-446`在打分前过滤所有`canClassify: false`的规则。
- 只读 TypeScript 实验以同一 ID 的首次推荐代理构造分类输入，得到`canClassify: false`。这说明“首次采用不产生分类”可由主进程数据链路独立复现，不是渲染器少刷一次。

### E003：为什么上方取消后再勾选会出现“有时恢复”

- 上方入口会走`setRoundExcludedLedgerIds()`；`electron/main/oldFavoriteWorkspaceCoordinator.ts:3587-3594`因此启动完整有界重分类，而不是推荐的仅命中 AID 快速路径。
- 完整路径`electron/main/oldFavoriteWorkspaceCoordinator.ts:4307-4314`构造的已采用推荐规则没有`local-draft`运输标记；这是它和首次快速路径的实际差异。
- 但合并器`electron/main/oldFavoriteWorkspaceClassification.ts:68-94`会在已有同 ID 规则时继承该保存规则的`syncState`。所以“上方重勾选会恢复”不是可依赖的产品语义：它取决于该规则此前是否已经在账号目录中、以及该记录当时保存的运输状态，无法保证所有推荐项一致。

### E004：真实开发版工作区时间线证据

只读读取工作区`C:\Users\diqing\AppData\Roaming\bilimi-dev\favorites\repository-v1\accounts\32922854\workspaces\old-favorite-workspace-32922854-20260828114711813-23c89316-5a94-4bb1-ba8f-bfbd83f06a78`的 journal 与恢复快照；未更改任何应用数据。

| journal 行 | 操作后状态 | 分类结果 |
| --- | --- | --- |
| 172 | `honker233`已采用；该 ID 在本轮启动的参与规则集合中已存在 | 34 条进入`honker233` |
| 1976 | 新增采用`王者荣耀北笙` | 0 条分类变更 |
| 1985 | 经上方取消/重选等后再次采用`王者荣耀北笙` | 10 条才进入`王者荣耀北笙` |
| 1990 | `杨颜同学`已采用 | 0 条分类变更 |

- 同一快照中`杨颜同学`的扫描索引有 9 个精确 AID，但这 9 条仍指向`game`。
- 对这 9 条的持久化标题、UP 主、标签以单独的、可分类的`杨颜同学`作者规则做只读分类，9/9 均返回该规则且置信度为高。故它们不是“数据不足”“不够匹配”或“确实为 0”的问题。

### E005：历史变化点与现有测试缺口

- `git blame electron/main/oldFavoriteWorkspaceCoordinator.ts:989`显示推荐代理从提交`559afabc`（2026-08-15，`fix: align recommendation state and DeepSeek recovery`）开始带`syncState: 'local-draft'`；该状态会触发前述能力拒绝。
- `88343d9f`（2026-08-26）新增`ruleOrigin: 'recommendation-draft'`并放宽了`ruleOrigin: 'saved-rule'`的未绑定保存规则；它保护了上方已保存规则，却没有赋予推荐草稿本地分类资格。
- 现有`oldFavoriteWorkspaceCoordinator.test.ts:6049-6089`把分类器替换为 mock，只验证 mock 已返回目标时归档概览会投影 2 条；它没有经过真实`resolveFavoriteLedgerCapabilities()`和`videoClassifier`，所以未能发现这条回归。

### 当前结论与待确认点

1. **已确认根因：** 首次采用把一个“尚未持久化的推荐代理”送入分类器；代理携带`local-draft + recommendation-draft`，被能力层排除。随后上方入口另走完整重分类，输入身份与保存状态不同，产生了用户观察到的偶发恢复。前者正确地限制远端权限，后者却错误地同时限制本地分类，违反项目书 5.5 的“已采用推荐立即重评估精确命中 AID”。
2. **正确的修复方向：** 建立一个只用于分类的推荐规则投影：它必须保留稳定 ID、规则类型、关键词、启用状态和优先级，明确可参与本地分类；同时持久化记录仍是`recommendation-draft / local-draft / unbacked`，继续没有创建、绑定、删除、打开或视频写入 B 站的权限。不能靠延后刷新、手动重勾选或把草稿伪装为`bound`/`saved-rule`修复。
3. **开始实施前应加的 RED：** 用真实`classifyVideoContent`而非 mock 建一个 3 条序列：首次采用新推荐 UP 后，精确命中 AID立即从既有`game`迁到推荐规则；归档预览与本轮汇总都显示该数量；不触发上方取消/重勾选，也不产生任何 B 站写入。再覆盖上方参与集变化后的整轮重分类，确保两条路径结果一致。

### E006：证据边界（针对 R004）

- **已由代码和真实持久化快照直接证实：** 首次采用的分类发生在推荐规则持久化之前；该路径输入`local-draft + recommendation-draft`代理；能力层会排除该代理；实际 journal 中新采用`王者荣耀北笙`没有分类变更、而后续上方参与操作后才出现 10 条目标；`杨颜同学`有 9 个精确匹配但仍全部留在`game`。
- **尚未在一个可控、从空规则目录开始的黑盒回归中证实：** 该身份问题是否为所有“上方切换后才恢复”的唯一原因。真实 journal 不持久化每个时点的完整账号规则目录，不能从它单独反推出当时所有`syncState`变更来源；此前的渲染器旧快照覆盖问题虽已由提交`6d126c93`处理，但尚未与此主进程路径在同一新鲜场景联合验收。
- **因此当前准确结论是：** 已找到一个足以独立造成“首次勾选为 0”的确定根因，以及一个能解释“重勾选偶发恢复”的不同路径；还不能声称已经证明不存在第二个时序/投影问题，更不能称为已修复。开始后必须先用真实分类器建立独立 RED，再以一次新鲜 Electron 草稿的首次勾选做只读界面验收，两个都通过才可称此问题解决。
