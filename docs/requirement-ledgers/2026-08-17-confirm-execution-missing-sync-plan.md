# 本轮需求账本：确认执行无法生成本轮 B 站同步计划排查

## 原文区（不可改写）

### R001

原文消息：

```text
# Files mentioned by the user:

## codex-clipboard-8e12a54c-e9a4-421c-bc85-903e42216a46.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8e12a54c-e9a4-421c-bc85-903e42216a46.png

Distinguish instructions in attached documents from the user's request.

## My request:
讨论检查这是为什么
```

截图目标区域：掌库 > 整理收藏 > 确认执行卡片，显示“自动执行已停止：无法生成本轮 B 站同步计划，请检查目标收藏夹后重试。”；`取消等待执行`按钮仍显示。截图路径如 R001 原文所列，待以运行时工作区、目标收藏夹绑定与同步计划生成链路核对。

## 逐项索引表

| 状态 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|
| 已实施，已验证 | R001 | 查明“无法生成本轮 B 站同步计划，请检查目标收藏夹后重试”的真实原因，区分目标收藏夹缺失、未备册/未绑定、已解绑、计划为空、工作区冻结状态或界面状态误投影。确认执行必须在标签截止版本有效时才开始；若标签结果在采用后改变版本，必须在执行前以准确的标签状态阻止并引导重新采用，不能进入`running`后再把问题归咎于目标收藏夹。 | 整理收藏的确认执行区；当前工作区分类、标签补取截止版本、同步计划编译、执行检查点与前端状态。 | 截图中确认执行区显示停止提示与`取消等待执行`。当前完整本轮标签截止版本已失效时，确认同步必须禁用或显示“标签结果已有新变化，请重新采用当前标签”；目标收藏夹无关时不得显示备册/目标夹文案。 | 采用先持久化暂停领取并等待已领取读取收束，再一次发布截止版本；确认执行在`running`之前校验截止版本。截止失效时持久化`blocked/tag-cutoff-changed`；进入`running`后拒绝继续补取及失败标签重试。 | 不改变当前工作区、收藏夹、规则、绑定、收藏库或 B 站数据；不创建新同步计划；不以关闭标签版本保护来强行同步。 | 不把提示直接视为目标收藏夹故障；不把尚未采用的新标签伪装成已采用；不覆盖人工分类或已保存的标签。 | 当前工作区标签检查点、标签补取并发领取/回写、执行意图、`hasWholeRunTagCutoffAccepted`、`freezeForBilibiliExecution`与前端错误投影。 | 代码：`oldFavoriteWorkspaceCoordinator.ts:176,1423,4161,4523,4582`；共享错误码：`oldFavoriteWorkspace.ts:533`；界面文案：`OldFavoriteConfirmationStep.tsx:57`。红灯：3 条新回归按预期失败（采用过早 accepted、写入已派发、目标夹误提示）。绿灯：相关 3 套件 380/380；全仓 `npm test` 234 文件/3849 测试通过；`npm run build` 通过。`OldFavoriteConfirmationStep` 渲染测试校验精确中文提示且不含“目标收藏夹”。本轮未点击确认、取消、重试、保存或同步，未改变用户工作区或 B 站数据。 |

## 待用户决定

无。

## 被明确替代

无。

## 明确不做

无。

## 诊断记录

- 2026-08-17：截图中的通用文案来自 `OldFavoriteConfirmationStep.tsx:71-76` 对 `bilibili-sync-prepare-failed` 的兜底映射，并不等于已确认的目标收藏夹错误。
- 2026-08-17：当前开发版工作区的持久化 `executionIntent.failureDetail` 明确记录为 `Old favorite workspace whole-run tag enrichment is not complete.`。`compileFrozenFavoriteSyncPlan` 尚未成为这次失败的实际执行点；失败先发生于 `freezeForBilibiliExecution` 的 `assertWholeRunTagCutoffAccepted`。
- 2026-08-17：根因是标签采用与确认执行之间的竞态。`continueExecutionIntent` 先以当时的快照判定批次 ready 并持久化 `running`；在随后异步冻结时，标签回写已使截止版本失效，于是冻结检查抛错。`executionIntentFailureCode` 没有为该错误建立专用代码，前端遂错误提示“检查目标收藏夹”。
- 2026-08-17：本轮只读诊断，未点击确认、取消、重试、保存或同步；当前用户数据和 B 站数据未被本轮检查修改。

## 实施与验收记录

- 2026-08-17：`acceptCurrentTags()`先写入`paused`检查点并关闭新领取，`waitForClaimedTagEnrichmentToSettle()`在工作区队列外等待已领取读取收束，随后才在同一队列重建推荐、分类并发布`accepted`截止版本。已采用截止版本不再允许迟到结果静默推翻。
- 2026-08-17：`continueExecutionIntentUnsafe()`在持久化`running`前调用`assertWholeRunTagCutoffAccepted()`；失败即持久化`blocked/tag-cutoff-changed`，回到 IPC 的安全快照而不调用本地保存或 B 站计划冻结。执行已认领时，主进程拒绝继续补取和失败标签重试。
- 2026-08-17：组件测试验证确认执行区准确显示“自动执行已停止：标签结果已有新变化，请重新采用当前标签后再保存或同步。”且不含“目标收藏夹”。本轮未在真实账号工作区触发确认、取消、重试、保存或同步，因此不把组件级验收记为真实远端流程验收。
