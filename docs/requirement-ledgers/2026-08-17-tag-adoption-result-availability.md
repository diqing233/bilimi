# 本轮需求账本：采用当前标签后的结果与执行资格

## 原文区（不可改写）

### R001

原文消息：

```text
采用当前标签你没写好项目书吗，不是说点击后展示推荐收藏夹，归档预览，确认执行的按钮可点击吗
```

## 逐项索引表

| 状态 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|
| 已实施待验证 | R001 | `采用当前标签`成功后，必须以该标签截止版本完成完整本轮重算，并展示/刷新推荐收藏夹与归档预览；满足完整执行资格时，`保存本轮到收藏库`和`确认并同步到 B 站`必须可点击。 | 整理收藏：采用当前标签后的当前批、本轮总览、推荐收藏夹、归档预览和确认执行区。 | 基础扫描完整结束、采用成功、全范围重算完成、标签补取已安全暂停且 DeepSeek 未运行时展示可执行结果并启用写入按钮。标签补取仍在运行、完整范围重算中或 DeepSeek 运行时，写入按钮保持置灰并说明原因。 | 主进程 `acceptCurrentTags`（`electron/main/oldFavoriteWorkspaceCoordinator.ts:4113`）先构造候选截止版本，完成推荐重建和完整范围分类后以一次 `tagEnrichment` overlay 发布；失败时保留旧采用事实。`createSnapshot`（`:6137`）从同一截止事实投影结果；确认区从 `wholeRunTagCutoffAccepted`、批次 readiness、分类准备度和 DeepSeek 状态共同计算两个写入按钮。 | 采用、重算、推荐和预览只改变本地工作区；直到用户点击保存或同步前不写收藏库或 B 站。失败回归验证重启后只恢复为安全暂停，不泄漏采用状态。 | 保留人工分类和已勾选推荐；未补取标签不伪造为无标签，也不从本轮范围删除；不因为多批而隐藏已就绪或采用后的结果。 | 标签截止版本、完整范围重算、推荐投影、归档预览投影、DeepSeek 运行状态、执行资格。 | 项目书第 5.3、5.4、5.5、5.6、5.8 节已写明同一结果链。主进程 `oldFavoriteWorkspaceCoordinator.test.ts` 294/294 通过，覆盖 `keeps whole-run saving disabled when an already claimed tag result changes the adopted cutoff` 与 `does not publish an adopted cutoff when the complete reclassification fails`；确认区 `OldFavoriteConfirmationStep.test.tsx` 34/34，覆盖启用及标签/DeepSeek 阻塞；向导 `OldFavoriteGuide.test.tsx` 覆盖采用后的推荐和归档预览；控制面板相关投影测试包含在全量 3841/3841 中。`npm run build` 通过，`git diff --check` 通过。自动化测试工作区未触发真实收藏库、DeepSeek 或 B 站写入；真实 Electron 手动截图验收尚未执行。 |

## 待用户决定

无。

## 被明确替代

无。

## 明确不做

不触发真实 DeepSeek、收藏库写入、B 站同步、删除或扫描；仅在测试工作区/自动化测试中验证本轮本地状态链。
