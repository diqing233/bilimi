# 收藏库远端删除与暂存同步反馈需求账本

## 原文区（不可改写）

### R001

时间：2026-09-07

```text
# Files mentioned by the user:

## codex-clipboard-6b854175-cb7f-41a2-b376-b1ea69bff30e.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6b854175-cb7f-41a2-b376-b1ea69bff30e.png

## codex-clipboard-590f3bda-118c-44bf-bd40-d629c06aacbb.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-590f3bda-118c-44bf-bd40-d629c06aacbb.png

Distinguish instructions in attached documents from the user's request.

## My request:
图一从b站删除，这里也应该变成未同步
图二bilimi暂存是不是有点特殊，我点同步，提示成功，实际并没有，状态也没变化
```

截图目标与待界面验收：

- 截图一：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6b854175-cb7f-41a2-b376-b1ea69bff30e.png`。目标为收藏库详情面板的“状态”区域；用户圈定从 B 站 bilimi 收藏夹删除后仍显示“已同步”的状态标签，要求改为“未同步”。
- 截图二：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-590f3bda-118c-44bf-bd40-d629c06aacbb.png`。目标为工作夹 `bilimi·暂存` 的详情面板“同步到B站”操作、其操作提示和同步状态；用户描述点击后提示成功、实际没有 B 站写入、状态没有变化。

## 逐项索引表

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / B站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 从 B 站 bilimi 收藏夹删除成功后，同一视频的同步状态显示“未同步”。 | 收藏库详情状态标签、列表状态投影和位置事实。 | 仅当实际受管 B 站 bilimi 收藏关系已确认删除时；失败或结果未知不得伪造未同步。 | 成功删除后立即按更新后的实际远端位置刷新；同步状态由已同步变为未同步。 | 以远端删除成功回执及回读/本地位置投影为事实；不得影响普通 B 站收藏夹、本地档案或转写。 | 不将普通来源删除、远端失败或未知结果误报为“未同步”。 | 受管远端删除、位置同步服务、`libraryMirrors`/位置状态投影、收藏库刷新。 | 已确认，待实施 | 截图一待真实界面验收；自动化回归待补。 |
| I002 | R001 | `bilimi·暂存` 无实际可写的受管 B 站目标时，点击同步不得提示成功，也不得显示已同步；状态应保持未同步。 | `bilimi·暂存` 工作夹中的单项/批量同步入口、顶部操作提示、详情同步状态。 | 仅在无正式绑定的物理 B 站 bilimi 收藏夹、或无可执行远端写入操作时。 | 同步预检应阻止空执行，显示无可同步目标的事实性反馈；不创建“成功”记录。 | 不调用 B 站写入；不凭本地暂存或备册标签持久化远端成功状态。 | 不改变已拥有正式受管远端目标的其他工作夹同步流程。 | 同步资格预检、物理分片/绑定、同步运行器、成功结果判定、收藏库刷新。 | 已确认，待实施 | 截图二待真实界面验收；自动化回归待补。 |

## 讨论状态

- 用户已明确说“开始”；本轮仅实施 I001、I002，未执行真实 B 站同步或删除。
- 已确认：I001、I002。
- 待用户决定：无。
- 被后续明确替代：无。
- 明确不做：无。

## 诊断记录（讨论期只读证据）

1. 远端删除后状态未变：`favoriteRepositoryBatchOperationService.ts` 的受管远端删除会先改本地期望位置、再调用 `synchronizePlacements()`；状态收束依赖同步服务刷新 `remoteObserved*` 与 `positionState`。截图显示删除后仍保留旧的“已同步”投影，需进一步用定向回归追踪删除成功后的最终位置提交，确认是观察值未清除、镜像未重算，还是渲染器未刷新权威快照。
2. 暂存空同步误报成功：`FavoriteLibraryApp.tsx` 单项“同步到B站”目前直接调用 `synchronizeFavoriteLibraryPlacements(accountMid, { kind: 'aids', aids: [aid] })`，没有在界面层阻止 `local:inbox` / `bilimi·暂存` 的无正式远端目标情况。截图中该工作夹为本地暂存，且页面确认区也写明“同步暂时不上B站”；需追踪主进程在零个可写操作时为何返回成功，并使成功只代表实际远端写入完成。

## 实施记录

### I001（R001）

- 状态：已实施待真实界面验收。
- 代码位置：`electron/main/favoriteRepositoryBatchOperationService.ts:255,341-344,369-379,721-744`。
- 实现结果：受管 bilimi 来源从 B 站删除成功或对账确认删除后，保留本地 `localDesiredFolderIds`，清空对应 `remoteObservedPhysicalFolderIds` / `remoteObservedLogicalFolderIds`，写入 `positionState: 'local-only-change'`，不进入回收站；普通 B 站来源仍走原有本地删除/回收逻辑。
- 自动化证据：`npm test -- electron/main/favoriteRepositoryBatchOperationService.test.ts` 通过；全量测试 249 个测试文件、4449 个测试通过。
- 未验证条件：尚未使用真实 B 站账号执行删除并在 Electron 收藏库详情/列表中验收“未同步”展示。

### I002（R001）

- 状态：已实施待真实界面验收。
- 代码位置：`electron/main/favoriteRepositorySyncService.ts:1265-1272`。
- 实现结果：本地暂存无任何正式 bound bilimi 目标且无远端观察目标时，标记 `target-missing` / `logical-target-unbound`，同步返回 `failed`，分类同步状态记为失败；不调用 B 站 append/remove，不生成成功同步回执。已有正式目标的同步分支未改变。
- 自动化证据：`npm test -- electron/main/favoriteRepositorySyncService.test.ts` 通过；新增回归断言无 B 站写入、无成功回执；全量测试 249 个测试文件、4449 个测试通过。
- 未验证条件：尚未在真实 Electron 的 `bilimi·暂存` 工作夹点击“同步到B站”并核对提示、状态和远端收藏夹。

## 本轮验证汇总

- 定向回归：通过（`favoriteRepositoryBatchOperationService.test.ts`、`favoriteRepositorySyncService.test.ts`）。
- 全量测试：通过（249 个测试文件，4449 个测试）。
- 构建：`npm run build` 退出码 0。
- 真实 B 站副作用与真实 Electron 界面：待用户验收，未在本轮代执行。
