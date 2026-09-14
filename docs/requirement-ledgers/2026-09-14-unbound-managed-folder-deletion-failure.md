# 2026-09-14 未绑定收藏夹远端删除失败：需求账本

> 本轮处于讨论与排错阶段；用户尚未明确说“开始”，不得修改功能代码或执行真实 B 站删除。

> 用户已在 R005 明确说“开始”。以下计划只覆盖 I001；实现前已重新通读本账本全部原文区、逐项索引，以及项目书第 4.1 节“远端候选删除也走同一收尾”和第 6.7.8 节删除边界。

## 原文区（不可改写、合并、删除或重排）

### R001（2026-09-14）

附件截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ae4b74c8-abbc-48da-8f7e-0fc785cfa17e.png`

截图目标区域：

- 掌库右侧删除确认弹窗中，一个状态为“未绑定”的 bilimi 收藏夹在选择“同时从 B 站删除收藏夹”并完成确认后，底部显示“删除未成功，请稍后重试。”。

用户原文：

```text
# Files mentioned by the user:

## codex-clipboard-ae4b74c8-abbc-48da-8f7e-0fc785cfa17e.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ae4b74c8-abbc-48da-8f7e-0fc785cfa17e.png

Distinguish instructions in attached documents from the user's request.

## My request:
未绑定为什么删除失败
```

### R002（2026-09-14）

用户原文：

```text
未绑定不是通过名字识别到就能删除吗，只要知情确认即可
```

### R003（2026-09-14）

用户原文：

```text
再核对仍是同一个精确远端 ID  是啥意思，核对的名字还是fold id
```

### R004（2026-09-14）

用户原文：

```text
我问你具体是啥，删除操作到底是怎么执行的
```

### R005（2026-09-14）

用户原文：

```text
修复
```

### R006（2026-09-14）

用户原文：

```text
开始
```

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001, R002, R003, R004, R005, R006 | 未绑定 bilimi 收藏夹先以名称发现候选；用户选择从 B 站删除并完成知情确认后，执行从当前 B 站目录重新按名称发现候选、将重新发现的 `folderId` 与弹窗预览 ID 做集合比较、再按通过比较的每个 `folderId` 调用 B 站删除。错误反馈保留具体失败类别，不能将未绑定本身错误归因为删除禁止。 | 掌库 `FavoriteLedgerOverview` 删除确认、远端删除预览复核、B 站删除桥接结果。 | 仅选择“同时从 B 站删除收藏夹”且远端删除未成功/结果未知/预览过期时呈现失败；未绑定候选始终必须完成现有额外知情确认。 | 名称用于每次目录读取时发现候选；`folderId` 用于预览 ID 与执行前 ID 集合比对，并作为删除请求参数；知情确认授权删除这个候选的精确 ID。 | 未执行真实 B 站删除、同步、绑定、改名或本地数据清理。 | 不放宽未绑定候选的二次确认；不自动绑定；不得在目录发生变化后用同名新 ID 删除；不取消精确远端 ID 的删除前复核。 | 删除预览、IPC、主进程同步服务、B 站页面桥接和 renderer 错误映射。 | 已实施，真实 B 站待验收 | `favoriteRepositorySyncService.ts:1563-1587` 仅将预览 `expectedRemoteFolderIds` 精确列出的 `unbound-name-match`（以及既有 remote draft）纳入删除集合；先检查现有知情确认、再比较执行前 ID 集合，最后复用 `bridge.deleteFolder({ folderId })`。同名但未在预览 ID 集合的候选仍排除。`favoriteRepositorySyncService.test.ts`：RED 为同一名称候选预览 ID 已确认却抛 `managed-folder-deletion-preview-stale`；GREEN 证明以 `remote-music` 调用删除，且 ID 改为 `replacement-music` 时仍停止且不调用删除。`FavoriteLedgerOverview.tsx:173-180` 将 `managed-folder-deletion-preview-stale` 显示为“B 站收藏夹目录已变化，已停止删除；请重新打开删除确认后再试。”；新增组件测试覆盖此提示。定向 254/254、全量 `npm test` 255 文件/4689 项通过，`npm run build`、`npm run dev`、`npm run preview`退出 0。桌面自动化服务返回 `unsupported Codex auth method: apikey`，未能控制 Electron；为避免真实账号破坏性操作，真实 B 站删除、弹窗交互响应与最终状态投影待用户开发版验收。 |

## 条目分类

### 已确认

- I001（R001–R006）：未绑定候选通过名称识别后，完成知情确认即可删除；执行时重新以名称发现候选、对比预览和执行前的 `folderId`，再以通过比较的 `folderId` 发起 B 站删除。已实施，真实 B 站验收待完成。

### 待用户决定

- 无。

### 被后续明确替代

- 无。

### 明确不做

- 不打包、不对真实 B 站、收藏库或本地规则执行删除。
- 不创建绑定、不改名、不改变备册、同步、收藏库投影或删除后的隐藏/恢复流程。

## 实施前核对与计划（2026-09-14）

### 已确认（按原文顺序）

1. `R001–R004 / I001`：未绑定候选以名称发现；用户已选择 B 站删除并完成知情确认时，执行前重新按名称读取候选、比较预览与重读的 `folderId` 集合，完全一致后以该 `folderId` 删除。
2. `R005–R006 / I001`：开始修复上述错误排除候选的执行分支。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 不放宽未绑定二次知情确认；不把名称自动升级为绑定；预览和执行前的 `folderId` 不一致时仍必须停止，绝不删除同名新夹。
- 不改已绑定、历史精确 ID、远端草稿、部分成功、结果未知、收藏库工作夹删除与恢复流程。

### P001（R001–R006 / I001）：允许已确认的未绑定名称候选通过 ID 核验后删除

- **允许修改：** `electron/main/favoriteRepositorySyncService.ts`、`electron/main/favoriteRepositorySyncService.test.ts`、本需求账本；若确有错误呈现回归才限于 `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 及其现有测试。
- **数据与 UI 结果：** 预览和执行前都从 B 站目录以规范化名称发现候选；执行前完整保留这些候选用于与 renderer 提供的预览 `folderId` 集合比较。集合相同且 `acknowledgeUnboundRemoteDeletion=true` 时，候选进入已有 `bridge.deleteFolder({ folderId })` 循环；集合不同时抛出 `managed-folder-deletion-preview-stale`；未确认时保留 `unbound-managed-folder-deletion-acknowledgement-required`。成功/失败/未知继续走现有收尾和状态投影。
- **回归风险：** 不得将名称当作 API 删除参数；不得删除预览后新出现的同名 ID；已绑定、历史 ID、remote draft、局部删除和 B 站失败/未知处理保持不变。
- **测试与界面验收：** 先将目前错误断言“名称候选必定被拒绝”改为“预览 ID 与执行前同一名称候选 ID 一致、已确认时按该 ID 删除”；定向运行必须先 RED（当前代码错误抛出 `managed-folder-deletion-preview-stale`），再作最小主进程条件修复，GREEN 后运行同步服务和 renderer 删除确认测试。运行构建、完整测试和开发/预览启动；不在登录账号执行真实删除，真实弹窗和成功 B 站副作用由用户验收。

## 实施与验收记录（2026-09-14）

1. **R001–R004（执行语义与根因）：** `electron/main/favoriteRepositorySyncService.ts` 不再无条件排除所有 `unbound-name-match`。它只保留两类可删除的未绑定候选：既有 remote draft 精确 ID，或此次 renderer 预览 `expectedRemoteFolderIds` 中精确列出的 ID；后者仍要求 `acknowledgeUnboundRemoteDeletion`。随后复用相同候选集做执行前 ID 集合比较和 `bridge.deleteFolder({ folderId })`。因此，同名但未在预览 ID 列表的远端夹不会被删除；ID 变化仍在写入前停止。
2. **R001（错误反馈）：** `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 为 `managed-folder-deletion-preview-stale` 增加可读提示：`B 站收藏夹目录已变化，已停止删除；请重新打开删除确认后再试。`；其它 B 站拒绝、网络、账号和未知结果映射未改。
3. **R005–R006（测试先行与实施）：** 主进程回归先由 RED 证明：已知情确认、预览 ID 为 `remote-music` 的未绑定名称候选仍错误抛出 `managed-folder-deletion-preview-stale`。最小修复后，GREEN 证明按 `remote-music` 调用删除；另新增 ID 变为 `replacement-music` 时保持停止且不删除的回归。组件回归先 RED 证明目录过期仍显示泛化提示，再 GREEN 证明显示具体中文原因。
4. **自动化与构建：** 定向 `npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/favoriteRepositorySyncService.test.ts --reporter=dot` 为 2 文件 254 项通过。完整 `npm test` 输出在 `.codex-artifacts/2026-09-14-unbound-managed-folder-deletion-full-test.log`：255 文件、4689 项通过。`npm run build` 退出 0，仅有既有动态/静态导入分块提示；最新 `npm run dev` 与 `npm run preview` 均输出 `start electron app...`。
5. **真实界面验收：** 未执行真实 B 站删除、同步、绑定或本地删除。桌面自动化服务返回 `unsupported Codex auth method: apikey`，不能控制 Electron 窗口；因此无法替代用户在开发版对弹窗点击、鼠标响应、远端实际删除及成功后状态投影的验收。该限制不影响自动化回归结论，但本条真实验收仍待用户完成。
