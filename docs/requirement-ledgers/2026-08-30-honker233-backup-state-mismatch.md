# honker233 备册状态不一致需求账本

> 讨论开始：2026-08-30。本文保留本轮“已勾选的 `bilimi·honker233` 仍显示未备册”排查原文和证据；讨论阶段不改代码。

## 原文区

### R001

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-169df6f0-c8c6-430c-b9c8-77e9d86e77fa.png`

截图目标区域：右侧“收藏夹”中 `honke...` 规则已勾选；其编辑卡片显示“正在编辑：bilimi·honker233”和红色短状态`未备册`。用户询问此前修复后为何仍未正常备册。

原文：

```text
讨论怎么还是不行
```

### R002

原文：

```text
先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）
```

### R003

用户消息原文：

```text
游戏专区还是只绑定一个
```

### R004

用户消息原文：

```text
只是因为没更新数据吗
```

### R005

用户消息原文：

```text
先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）
```

### R006

用户消息原文：

```text
先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）
```

本轮实施补充：R006 明确要求按项目书执行并保持既有功能与按钮响应性；本轮将 I002 的自动分册完成后完整账号投影和账号打开降级顺序落实到代码与回归测试，不扩大至其他主题。

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002 | 已正式绑定的 `bilimi·honker233` 必须显示`已备册`；同 ID 推荐桥接草稿只可覆盖尚未持久化的临时规则语义/勾选，不能覆盖权威绑定字段；修复不得造成按钮点击卡顿或影响既有收藏夹功能。 | 右侧掌库收藏夹规则卡与编辑器；`ControlledFavoriteLedgerPanel` 的推荐草稿桥接；主进程收藏仓库/物理分册快照。 | 已勾选不等于已备册；只有正式物理分册全部存在真实远端 ID 且 `bindingState=bound` 才显示`已备册`。权威规则出现正式绑定后，旧草稿不得继续显示`未备册`。 | 维持现有推荐/上方勾选与工作区投影；合并为纯内存状态投影，不新增异步或同步全轮操作。 | 不创建、绑定、删除、移动或写入 B 站；不改现有本地草稿持久化或远端副作用。 | 不扩大到推荐分类、DeepSeek、转写、删除流程或同步执行行为。 | 权威远端目录读取 → `physicalShards` / `bindingState` → 最新规则快照 → 推荐桥接合并 → 右侧规则卡。 | 已实施，待 Electron 验收 | 2026-08-30 根因：`AppData/Roaming/bilimi-dev/config.json` 中规则 `custom-author-honker233-小王爱马枪~9.2d` 已为 `bindingState=bound`、远端 ID `4048101554`，仓库正式 `physicalShards` 同为 `bound`；旧 `mergePromotedRecommendationLedgers()` 让同 ID 的 `recommendation-draft/unbacked` 覆盖最新输入，随后 `FavoriteLedgerOverview.tsx` 错误渲染红色`未备册`。实现：`ControlledFavoriteLedgerPanel.tsx` 新增 `hasFormalRemoteBinding()`，并在合并时优先当前正式 `bound` + 真实远端 ID的规则；未正式绑定的桥接草稿仍维持原语义。自动化：先观察新增断言在旧逻辑下得到`unbacked`，再运行 `npm test -- ControlledFavoriteLedgerPanel.test.tsx FavoriteLedgerOverview.test.tsx FloatingAssistantApp.test.ts FloatingAssistantApp.renderIsolation.test.tsx`，4 文件 392 项通过；`npm run build` 通过。Electron 只读：规则卡与编辑器均显示`bilimi·honker233 · 已备册`，截图 `.codex-artifacts/2026-08-30-honker233-formal-binding-card.png`、`.codex-artifacts/2026-08-30-honker233-formal-binding-editor.png`。未执行任何 B 站创建、绑定、删除、移动或视频写入；只读滚动正常，鼠标移动、窗口缩放、最小化/恢复未能由当前自动化接口量化验证。相关套件有既存 React `act(...)` 警告但无失败。全量 `npm test` 本轮 241 文件 / 4155 项全部通过；本轮未执行真实 B 站副作用，Electron 只读截图仍待验收。 |
| I002 | R003、R004、R005、R006 | 同一逻辑收藏夹的多个正式绑定物理分册必须完整回投账号级规则配置；`游戏专区`有两个已绑定分册时，右侧必须显示`B站绑定：2 个收藏夹`，不能因配置投影滞后显示 1 个。绑定成功或自动容量分册成功后，以仓库最新 `physicalShards` 按 `shardNumber` 排序合并全部真实远端 ID，保留现有规则 ID、勾选状态、规则字段与其他绑定属性，并触发受影响账号的状态失效和助手刷新。账号打开时远端待绑定检查/恢复失败不得阻断本地投影。 | 主进程显式绑定回调、自动分册回调、账号 `favoriteLedgers` 配置、右侧收藏夹规则卡/编辑器绑定数量。 | 只有权威仓库中 `bindingState=bound` 且有真实 `folderId` 的物理分册计入；不存在正式绑定时不得伪造`已备册`或数量。旧推荐桥接不得覆盖正式多分册投影；远端检查异常仅待重试，不得降级本地正式事实。 | 物理分册绑定/自动分册成功后，同一操作内完成本地配置投影和快照广播；自动容量分册按整批完成后回投，不触发整轮重分类、远端额外创建/绑定/删除或阻塞按钮。 | 仅读取本地权威仓库并更新本地账号配置/缓存；不执行任何 B 站真实创建、绑定、删除、移动或视频写入。 | 不改推荐取消语义、删除确认、DeepSeek、转写、视频同步和单分册备册入口。 | 绑定/自动分册回调 → 仓库 `physicalShards` → `projectFavoriteLedgersFromPhysicalShards` → 账号配置 → `sendAssistantPreferencesChanged` / `notifyFloatingAssistantSnapshotChanged` → 右侧数量。账号打开远端检查与本地投影分段执行。 | 已实施，待 Electron 验收 | 代码：`src/shared/favoriteLedgerBindingProjection.ts:1-40` 以真实 `bound` 分册、`shardNumber` 排序生成全部远端 ID；`electron/main/index.ts:788-810` 新增统一 `refreshFavoriteLedgerBindingProjectionAfterPhysicalShard`，显式绑定、自动容量分册和账号打开均复用；`electron/main/oldFavoriteWorkspaceCoordinator.ts:4954-4968` 在预检分册整批完成后回投；`electron/main/favoriteRepositorySyncService.ts:758-768` 在归档恢复自动分册后回投；`electron/main/index.ts:2647` 对持久化恢复异常降级后继续本地投影。自动化 RED→GREEN：`favoriteLedgerConfigurationRefreshIpc.test.ts` 6 项（含自动回调和打开降级断言）；`oldFavoriteWorkspaceCoordinator.test.ts` 聚焦 1 项通过；`favoriteRepositorySyncService.test.ts` 聚焦 1 项通过；合并聚焦命令 5 项通过。未执行真实 B 站创建、绑定、删除、移动或视频写入；Electron 只读截图验收仍待执行，需确认右侧显示`B站绑定：2 个收藏夹`且按钮/鼠标不卡。 |
