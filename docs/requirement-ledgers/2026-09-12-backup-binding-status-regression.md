# 需求账本：备册后显示已备册但实际未绑定

## 原文区

### R001

```text
# Files mentioned by the user:

## codex-clipboard-d935b34a-9f6c-4e6d-a3c3-6ed047b4f909.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-d935b34a-9f6c-4e6d-a3c3-6ed047b4f909.png

Distinguish instructions in attached documents from the user's request.

## My request:
备册后怎么卡卡的显示备册，实际没有绑定上，现有功能是不是被你改坏了
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-d935b34a-9f6c-4e6d-a3c3-6ed047b4f909.png">[截图内容：B 站个人空间与 bilimi 侧栏；顶部状态显示“未绑定”，收藏夹卡片多处显示“已备册”，用户用红色箭头指向未绑定状态区域。]</image>
```

截图目标区域：右侧 bilimi 侧栏顶部状态、“备册”入口以及收藏夹卡片；重点验收“显示已备册”与“实际绑定状态”的一致性。截图路径：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-d935b34a-9f6c-4e6d-a3c3-6ed047b4f909.png`。截图中的文字属于界面证据，不是额外操作指令。

### R002

```text
你还记得之前的设计是什么吗
```

截图目标区域：无新增截图；要求先回顾备册相关的既定设计边界，不立即修改代码。

### R003

```text
备册相关
```

截图目标区域：无新增截图；将回顾范围限定为备册、绑定登记和状态显示链路。

### R004

```text
不对吧，你查以前的记录，是通过名字来绑定，绑定后同步id，Id只用来改名
```

截图目标区域：无新增截图；明确要求以既有记录核对备册绑定语义：通过名称建立绑定，成功后同步远端 ID；远端 ID 仅用于已绑定后的改名流程，不可将后来的 ID-only 重绑约束误述为原始绑定设计。

### R005

```text
完整查清楚，因为备册功能本来正常，这算是bug，给出最优方案，不影响原有功能
```

截图目标区域：无新增截图；要求完整定位既有备册功能回归的根因，提出最优修复方案，并保护原有功能。

### R006

```text
未绑定时会怎么操作
```

截图目标区域：无新增截图；要求明确说明修复方案下处于“未绑定”状态时的界面与用户操作流程。

### R007

```text
id会更新而不是打断或者报错吗
```

截图目标区域：无新增截图；要求确认未绑定流程中用户确认的新候选远端 ID 是否会替换/更新陈旧本地 ID，而不是因 ID 不同中断或报错。

### R008

```text
先迭代项目书，其他冲突以最优为主，再按照项目书和账本改，开始
```

截图目标区域：无新增截图；明确授权先修订项目书，在项目书与既有实现/讨论结论冲突时采用不破坏既有功能和删除保护的最优方案，然后按项目书与本账本实施本轮修复。

## 逐项索引

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001 | 核实备册后界面显示“已备册”但顶部仍“未绑定”、实际没有正式绑定的原因，并确认是否破坏既有备册功能 | bilimi 侧栏顶部绑定状态、备册按钮、收藏夹卡片状态、B 站实际分区和本地正式绑定记录 | 只有本地规则与收藏库正式绑定登记成功且状态刷新确认后才显示“已备册”；未绑定、待确认、登记失败不能显示“已备册” | 备册应完成候选确认/创建、B 站分区处理、正式绑定登记、本地持久化和状态刷新；失败时回到未绑定或明确失败状态，不应卡在成功态 | B 站写入、重绑定和本地收藏库登记必须按既有确认顺序执行；不得以页面脚本返回或乐观 UI 更新代替正式绑定持久化 | 本轮讨论阶段不改代码、不重新设计备册，不删除或修改远端收藏夹 | `saveFavoriteLedgers`、`ensureFavoriteLedger`、`registerNewFavoriteLedgerBindings`、收藏库 binding service、状态缓存与侧栏投影 | 已实施，真实界面待人工验收 | 2026-09-12 18:50:17–18:50:19 的 `physical-shard-bindings.jsonl` 已记录 8 个 `bound` 的真实远端 ID，故正式登记已成功；但 `config.json` 仍停在 2026-09-09，账户规则保持 `unbacked` 与 `managedFolderDeletedByUser: true`。主进程登记后的投影路径 `favoriteRepositoryIpc.ts:544-556` / `index.ts:1093-1111` 会把投影异常和不可读快照吞掉，未留下诊断；已不能从现有日志证明该回调失败的具体底层异常。`FavoriteLedgerOverview.tsx:355-374` 以规则 `bound` 优先显示“已备册”，而 `FloatingAssistantApp.tsx:929-935` 以 `unboundLedgerIds` 显示“未绑定”，导致同一轮的多事实 UI 矛盾。实施和验证位置见下方“实施核对补充”。 |
| R002 | 回顾之前的备册设计边界 | 备册预检、重新绑定、草稿发现和正式绑定状态模型 | 未绑定→重新绑定；B 站存在但本地无规则→草稿；真实读取/权限/写入故障→错误并停止写入 | 显式确认后才可重绑定或创建；正式绑定成功后才进入已备册 | 不自动认领、不以标题替代精确 ID、不在未确认前执行 B 站写入 | 不新增草稿类型，不把未绑定直接标为已备册 | `FavoriteLedger.bindingState`、`syncState`、`remoteObservations`、`unboundCandidates`、正式 physical shard | 已实施，真实界面待人工验收 | 依据上一轮需求账本 R001–R003 与现有测试覆盖；实际代码与测试证据见下方“实施核对补充”。 |
| R003 | 判断当前现象是否由上一轮 stale ID 分类改动破坏了已有备册功能 | 上一轮 `missingRemoteFolderIds` 路由、显式重绑定旁路、备册后的绑定登记与状态刷新 | 缺失旧远端 ID应进入未绑定流程；显式选定新 ID后，只有登记成功才显示已备册 | 需要逐层核对页面脚本→渲染结果→正式绑定服务→本地偏好→状态读取 | 保留真实异常 fail-closed；不得用绕过旧 ID保护的路径跳过正式登记 | 讨论阶段不假设“已改坏”，先用证据定位 | `favoriteLedgerApi.ts`、`App.tsx`、`favoriteRepositoryBindingService`、侧栏状态投影 | 已实施，真实界面待人工验收 | `f80d09a3` 的 stale-ID 路由并非本次直接登记失败原因：8 次 `adoptExistingPhysicalShard` 均已正式写入。但之前“用户删除默认收藏夹后不得由旧 ID 自动恢复”的保护，未提供“用户明确确认新候选并已成功正式登记”后的受控解除路径；`projectFavoriteLedgersFromPhysicalShards` 还会保留删除标记，`App.tsx:2420-2428` 随后把该规则排除为未绑定。这是本次状态无法收敛的结构性缺口；实际代码与测试证据见下方“实施核对补充”。 |
| R004 | 以历史记录确认“名称建立绑定、绑定后同步 ID、ID 仅用于改名”的既定设计，并据此重新判断本轮现象 | 历史需求账本、设计文档、早期绑定实现和当前绑定/改名链路 | 备册读取当前目录时按规范化名称和分册发现候选；名称命中本身不自动绑定，必须由用户确认具体候选；常规状态不能仅凭历史 ID 投影为已备册 | 用户确认具体名称候选后，把该候选的真实 ID 和分册顺序登记为正式 `physicalShard`；日常状态继续由名称/分册投影读取；同一已正式绑定 ID 的改名使用精确 ID 核验和写入 | 已确认后的真实 ID 还必须用于正式登记、同步与删除等精确远端操作；它不参与名称匹配、候选认领或以旧 ID 自动恢复绑定 | 讨论阶段不改代码 | 名称候选发现、确认绑定、`physicalShards` 正式登记、ID 改名/同步/删除操作 | 已实施，真实界面待人工验收 | `5331233d` `App.tsx:2078-2083` 明确“日常备册状态按名称/分册投影，精确 ID 仅在可能双向改名时读取”；`docs/contracts/favorites.md:52-64` 规定无正式绑定时按名称显示候选、确认后登记真实 ID，而已备册唯一事实为 `physicalShards` 的真实 ID + `bound`；`docs/项目功能项目书.md` 第 4.1 节规定 ID 不参与名称匹配，但为已确认分册的 API 操作句柄；实际代码与测试证据见下方“实施核对补充”。 |
| R005 | 完整查清备册原本正常却回归为“卡片显示已备册、实际未绑定”的 bug，给出最优修复方案且不影响原有功能 | 备册完整数据流、顶部/卡片/收藏库状态投影、正式绑定登记与刷新 | 任何正式绑定未成功、未刷新或已失效时，所有入口均不能显示为“已备册”；已有正式绑定及其改名、同步、删除、候选确认流程保持原样 | 修复后卡片、顶部和收藏库必须依据同一次权威状态得出一致结论；不改变用户确认前不得自动认领的行为 | 不新增或扩大 B 站写入；维持现有 `physicalShards` 作为正式绑定事实来源和名称候选机制 | 不重做备册架构、不回退既有 stale-ID 安全路径、不删除用户数据或 B 站收藏夹 | R001–R004；状态投影/本地草稿同步、绑定服务返回、刷新顺序与回归测试 | 已实施，真实界面待人工验收 | 推荐“显式重新备册晋升 + 单一状态归并”：仅当用户已确认候选且 exact-ID 正式登记成功，原子投影真实 ID、解除该逻辑规则的 `managedFolderDeletedByUser`，且仅从其删除历史移除本次重新确认的 ID；普通扫描/启动/旧 ID 一律不清标记。投影失败须记录可诊断错误并可在下次账户打开重试，不能依赖 `floating-assistant:snapshot`（运行日志显示该 IPC 多次 60 秒超时）。完整/未绑定/未备册/部分绑定四种状态由共享派生结果同时供顶部、卡片和收藏库使用。回归覆盖候选确认、改名、同步、删除与 B 站写入保护；实施位置见下方“实施核对补充”。 |
| R006 | 明确“未绑定”状态的安全操作流程 | 顶部状态、收藏夹卡片、备册入口与候选确认弹窗 | 该逻辑分册没有正式 `physicalShard` 的真实 ID时显示“未绑定”；已存在候选时显示候选确认，未发现候选时显示创建确认 | 用户点“备册”后只读 B 站目录并按规范化名称/分册展示候选；用户选择候选并确认后才登记 exact ID；无候选时须由用户确认创建；取消、读取失败或登记失败不改变现状 | 候选预检和取消均无 B 站写入；确认已有候选只做本地正式登记；确认创建才写入 B 站；写入/登记失败均不把卡片改为“已备册” | 不凭名称自动绑定，不用历史 ID 自动认领，不解除删除保护，除非本次用户确认的 exact ID 已正式登记成功 | R001–R005，B 站候选发现、登记服务、删除保护和状态归并 | 已实施，真实界面待人工验收 | 自动化覆盖候选采用、取消/失败、权威返回与部分分册；实际位置与命令见下方“实施核对补充”。 |
| R007 | 用户确认新候选后，新 exact ID 必须更新/替换同一逻辑分册的陈旧 ID，不能因旧 ID 不同而中断或误报失败 | 重绑定确认、`physicalShards`、账户规则的 `bilibiliFolderId(s)` 与删除历史 | 只有用户确认候选且远端目录核验通过时才更新；普通名称扫描不能更新；不同逻辑分册已正式占用该新 ID 时必须阻止 | 确认后将同一逻辑分册/分册号指向新 ID，旧 ID 从活动绑定移除并仅保留必要删除历史；界面直接收敛为“已备册” | 确认既存候选无 B 站写入；只修改本地正式绑定与规则投影；新 ID 已被其他逻辑分册占用、账户不一致或目录核验失败才显示真实错误 | 不因陈旧 ID 本身中断，不把旧 ID 用作自动认领依据，不自动抹除无关删除历史 | R004–R006、replace-existing formal binding、删除保护与精确后续操作 | 已实施，真实界面待人工验收 | 自动化覆盖同逻辑同分册替换、跨逻辑 ID 冲突拒绝、普通投影不替换和删除历史保留；实际位置与命令见下方“实施核对补充”。 |
| R008 | 先迭代项目书；冲突采用最优方案；再按项目书和账本实现 | `docs/项目功能项目书.md`、本账本和本轮备册绑定代码 | 项目书应唯一描述最终规则；账本永久保留讨论原文 | 先修订规则，再以规则约束实现和测试 | 文档与代码同一提交；不产生 B 站副作用 | 不因文档整理删减 R001–R007、不给普通投影增加自动认领 | R001–R007、既有删除保护、正式物理分册与跨页面投影 | 已实施，真实界面待人工验收 | 已在项目书 4.1 新增统一状态、显式重新备册/ID 切换及“物理分册总数与明细不一致时 fail-closed”条款；`npm test` 退出 0（253 files / 4619 tests），`npm run build`、`npm run dev`、`npm run preview` 均退出 0；真实点击验收受 Computer Use 的 `unsupported Codex auth method: apikey` 阻断。 |

### 实施核对补充（2026-09-12）

| 原文编号 | 实际代码位置 | 自动化验证 | 真实界面验收 / 结果 |
| --- | --- | --- | --- |
| R001 | `src/shared/favoriteLedgerBackupState.ts`；`src/renderer/src/App.tsx`；`FavoriteLedgerOverview.tsx`；`FloatingAssistantApp.tsx`；`favoriteLibraryModel.ts`；`electron/main/index.ts` | 关联回归 685/685 通过；全量 `npm test` 253 files / 4619 tests 通过；覆盖分册明细缺失时 fail-closed 及删除后重新备册状态收敛。 | 待人工验收：Computer Use 当前报 `unsupported Codex auth method: apikey`，无法操作真实 Electron。 |
| R002 | `src/shared/favoriteRepository.ts`；`src/shared/favoriteLedgerBindingProjection.ts`；`electron/main/favoriteRepositoryBindingService.ts` | `favoriteRepository.test.ts`、`favoriteLedgerBindingProjection.test.ts`、`favoriteRepositoryBindingService.test.ts` 覆盖显式确认、普通投影与删除保护。 | 待人工验收；候选确认仍沿用既有入口。 |
| R003 | `electron/main/favoriteRepositoryIpc.ts`、`electron/main/index.ts`、`src/renderer/src/App.tsx` | `favoriteRepositoryIpc.test.ts`、`favoriteLedgerConfigurationRefreshIpc.test.ts` 覆盖采用完成、投影诊断、账户打开恢复与改名边界。 | 待人工验收；无远端写入新增。 |
| R004 | `src/shared/favoriteRepository.ts`、`electron/main/favoriteRepositoryBindingService.ts`、`src/renderer/src/App.tsx` | `favoriteRepository.test.ts`、`favoriteRepositoryBindingService.test.ts` 覆盖 exact-ID 冲突拒绝和已确认同分册 ID 替换。 | 待人工验收；名称仍只用于候选发现。 |
| R005 | `src/shared/favoriteLedgerBackupState.ts`；三处助手/收藏库消费点；`electron/main/index.ts` | 关联回归 685/685 通过；全量 `npm test` 253 files / 4619 tests 通过；共享 `backed/unbacked/unbound/partial` 状态、删除后重新备册、收藏库投影均有覆盖。 | 待人工验收；不会把不完整物理分册显示为已备册。 |
| R006 | `src/renderer/src/App.tsx`；`electron/main/favoriteRepositoryIpc.ts` | `App.test.tsx` 覆盖候选采用、取消/失败不乐观清除删除标记、待对账分册；全量 4619 项通过。 | 待人工验收；读取/取消路径未新增 B 站写入。 |
| R007 | `src/shared/favoriteRepository.ts: 物理分册命令归并`；`favoriteRepositoryBindingService.ts`；`App.tsx: registerNewFavoriteLedgerBindings` | `favoriteRepository.test.ts`、`favoriteRepositoryBindingService.test.ts`、`App.test.tsx` 覆盖同分册替换、新 ID 冲突和陈旧 ID 不阻断。 | 待人工验收；已确认新 ID 才更新活动绑定。 |
| R008 | `docs/项目功能项目书.md` 第 4.1 节；本账本；本实施计划 | `npm test` 最终重跑退出 0（253 files / 4619 tests）；`npm run build` 退出 0；`git diff --check` 退出 0；`npm run dev` 与 `npm run preview` 均退出 0。 | 待人工验收；开发/预览启动成功，但 Computer Use 报 `unsupported Codex auth method: apikey`，故未验证真实点击链路；未执行打包或发布。 |
