# 本轮需求账本：DeepSeek 取消进度与收藏夹详情备册状态

## 原文区

### R001

原文消息：

```text
# Files mentioned by the user:

## codex-clipboard-ad304f48-ae90-43e6-a694-1952978182fc.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ad304f48-ae90-43e6-a694-1952978182fc.png

## My request:
讨论明细只有20，怎么进度一口气700了，我是先取消了一次再点击的
```

截图目标区域：右侧整理收藏面板的 DeepSeek 区域，用户圈定/描述的目标是“查看整理明细（20 条）”与“已应用 784 / 1061 条视频”的进度口径不一致；截图中整理批次为“本轮总览”，显示第 2 批部分整理、请求组 1 / 69 已结算、277 条等待处理。截图路径：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ad304f48-ae90-43e6-a694-1952978182fc.png`。

### R002

原文消息：

```text
整理收藏阶段还是看不到收藏夹详情页备册情况
```

### R003

原文消息：

```text
DeepSeek进度 784 / 1061绝对不正常，真正只处理了20
```

### R004

原文消息：

```text
检查以上的bug 实际修改好开始
```

## 逐项索引表

| 状态 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|
| 已实施待验证 | R001, R003, R004 | DeepSeek 取消后只把真实已应用的视频计入成功进度；截图场景真实只处理 20 条时不能显示 784。取消的批次不能被标记完成；恢复后从真实成功数继续。整理明细与成功 AID 集合保持同一口径。 | `electron/main/oldFavoriteWorkspaceDeepSeekService.ts:257-293` 全批次组织、取消、检查点和进度回调；右侧整理收藏 DeepSeek 进度/明细。 | 取消中的请求未返回有效结果时不得计入成功；已结算并应用的结果才计入；本轮总览显示累计真实成功，当前批次按批次筛选。 | 检查点的 `successfulAids`、`pendingAids`、`completedSegmentIds` 必须保留真实状态；不得重复调用已成功 AID；不触碰收藏库/B站写入之外的流程。 | 不重置正常的“取消后继续”语义；不改变 DeepSeek 请求大小、失败重试策略或普通整理收藏入口。 | `organize` 的 settled 结果、`organizeAllSegments` 的取消分支、`OldFavoriteWorkspaceDeepSeekRunCheckpoint`、渲染进度合并。 | `oldFavoriteWorkspaceDeepSeekService.test.ts` 新增“does not count unprocessed all-batch aids after cancellation”，并通过全文件 `47/47`；新增用例验证 1-20 成功、21/22 待处理、取消段未完成，恢复只请求 21/22。 |
| 已实施待验证 | R002, R004 | 整理收藏阶段打开收藏夹详情页时，必须按实际状态显示备册情况（已备册/未备册/未绑定；有本地改动时可显示未保存组合）；不能因为整理引导展开而把详情页状态隐藏。列表卡片在整理引导展开时仅显示未保存的既有规则不扩大。 | `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:327-344,1027-1051` 收藏夹列表与“当前收藏夹”详情编辑区；`ControlledFavoriteLedgerPanel` 传入整理状态。 | 列表卡片可按既有规则隐藏备册标签；详情编辑区始终显示实际备册状态。无绑定且已保存的收藏夹显示未备册；未绑定显示未绑定；本地有改动追加未保存。 | 点击收藏夹打开详情时状态立即可见，整理期间刷新/切换批次不丢失实际状态。 | 只读显示，不改变收藏夹保存、备册、绑定或B站副作用。 | 不改变列表卡片在整理引导展开时只显示未保存的既有设计；不增加新的状态文案或额外提示。 | `FavoriteLedgerOverview.test.tsx` 新增“keeps the actual backup state in a requested detail editor while organizing”，并通过全文件 `87/87`；新增用例验证详情显示“已备册”、列表卡片仍隐藏“已备册”、外部刷新后详情不消失。Electron 已打开“掌库”面板并看到真实卡片备册状态；未点击“整理收藏”，因此整理中详情的真实界面验收仍待用户数据安全条件下完成。 |

## 实施核对记录

- R001/R003：`npm test -- --run electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`，`47/47` 通过；定向取消用例 `1/1` 通过。
- R002：`npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`，`87/87` 通过；定向详情用例 `1/1` 通过。
- 工作树检查：`git diff --check` 通过；本轮改动仅限两处服务/测试和两处详情渲染/测试，账本与计划文件一并纳入本地提交。
- 真实 Electron：已连接开发版并打开“掌库”，看到“知识学习/游戏专区/影视动漫/创意美学/生活日常/音乐舞台/搞笑杂谈/暂存”为“已备册”，“服务二”为“未备册”。没有启动“整理收藏”、备册、删除或同步，避免改变用户数据；因此 R002 的“整理进行中打开详情”仍标记待界面验收。

## 待用户决定

无。若真实界面中“详情页”指的不是右侧“当前收藏夹”编辑区，而是其他页面，需在界面验收时补充截图定位；在此之前不改变其他页面。

## 被明确替代

无。

## 明确不做

无。
