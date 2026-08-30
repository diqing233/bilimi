# 收藏夹删除刷新与收藏库工作夹投影（2026-08-30）

## 原文区

### R001

附件截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-f701055a-3b7e-4100-89e0-d874b5817bf3.png`：删除确认窗口中显示“B 站已删除，本地状态待保存，请刷新或重试”，右侧仍显示删除前的收藏夹卡片。
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-43fe3fa8-87d2-403b-981a-911a6a3d7879.png`：删除后仍残留多个“未绑定”和“未保存 · 未绑定”卡片的现状。
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-f36cd35e-cc65-47c5-9ce3-dcc104fce239.png`：期望结果，只剩默认收藏夹且状态为“未备册”。

> 讨论图一删除模式为什么显示已删除，本地状态待保存呢，变成图二的样子，正常情况应该只剩下默认收藏夹，变成未备册的状态（图三），当前没有设计这个刷新，应该自动刷新

### R002

附件截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-63e273aa-c539-4134-a9fe-b277e9ea2955.png`：点击“保存到收藏库”后，左侧多个`bilimi·…`收藏夹显示在“其他收藏夹”区域，红框和箭头圈定这些项目；`bilimi 工作夹`区域仅显示`bilimi·暂存`。

> 点击保存到收藏库的时候这些bilimi收藏夹都在其他收藏夹区域，应该是无论有没有备册，绑定，哪怕是草稿，也应该放在bilimi工作夹区域吧，你看看项目书怎么设计的

### R003

> 修复讨论的这两个，先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）

## 逐项索引

| 编号 | 状态 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | 已实施 / 真实远端验收受限 | B 站删除按精确 ID确认成功后，自动完成本地收尾与权威刷新；删除后只保留默认收藏夹并显示`未备册`，已删除远端草稿消失。 | 右侧掌库删除模式、删除确认窗口、收藏库/整理草稿投影。 | 远端删除全部确认成功且本地收尾可完成时，关闭确认和错误提示；部分失败、结果未知或本地重读仍失败时保留相应检查点与事实。 | 自动按已确认 ID收敛绑定、草稿和默认规则，随后重投影，不要求用户手动刷新或再次删除。 | 不重发 B 站删除；只持久化已确认 ID的本地收尾。无 B 站创建、绑定、移动、视频写入。 | 不改变删除范围、双确认、未绑定知情同意、DeepSeek、转写、视频同步、整轮分类或单个备册入口。 | `FavoriteLedgerOverview` 删除计划；本地规则保存/删除 IPC；账户权威快照和远端草稿投影。 | 自动化：`FavoriteLedgerOverview.test.tsx` 118/118，新增 8 默认规则 + 2 远端草稿、首个本地保存暂失败的收敛回归；全量 `npm test` 4169/4169。Electron 只读截图：`.codex-artifacts/2026-08-31-favorites-readonly-ledger-dev.png`。未验证：真实 B 站删除及删除后的真实远端目录回读，因本轮不执行真实删除。 |
| I002 | 已实施 / 真实保存验收受限 | 本地保存产生归档成员的已保存 bilimi 规则，无论备册/绑定状态或推荐来源，均进入`bilimi 工作夹`；旧稳定规则 ID对应的本地投影也自动修复。 | 整理收藏“保存本批/本轮到收藏库”、收藏库左侧导航及仓库文件夹/成员/归属记录。 | 有成员的已保存规则显示在工作夹；未保存无成员输入草稿不显示正式导航；纯远端观察草稿不因名称进入导航；普通 B 站夹继续在“其他收藏夹”。 | 保存后使用最新权威快照刷新导航，不按名称猜测；旧`local:<ruleId>`迁移为`bilimi-logical:<ruleId>`。 | 仅本地仓库迁移，保留成员、归档记录和本地期望归属；不创建、绑定、改名、移动或删除 B 站收藏夹/视频。 | 不改变普通 B 站来源、扫描选择、整理分类结果、同步预检、DeepSeek、转写和已冻结计划。 | `OldFavoriteWorkspaceCoordinator` 两条本地保存路径；`FavoriteRepositoryService` 迁移/验证；`FavoriteLibraryApp` 分组。 | 自动化：当前批和整轮保存、显示名解析、旧 local 投影精确迁移、普通 `bilibili:*` 文件夹不迁移、未备册状态渲染，聚焦组合 571/571、全量 `npm test` 4169/4169。Electron 只读截图：`.codex-artifacts/2026-08-31-favorites-readonly-ledger-dev.png`。未验证：对当前账号执行新的“保存到收藏库”后导航实际分组，因本轮不写入本地整理数据或 B 站。 |

## 实施前核对

已确认：I001（R001、R003）、I002（R002、R003）。

待用户决定：无。

被明确替代：无。

明确不做：不执行真实 B 站创建、绑定、删除、移动或视频写入；不修改 DeepSeek、转写、普通 B 站来源关系、同步流程或单个备册入口。

## 实施记录

- 实施前代码核对：`FavoriteLedgerOverview.tsx` 把远端确认后的多个本地收尾步骤置于同一异常边界，任一失败会跳过本地卡片更新；`oldFavoriteWorkspaceCoordinator.ts` 两条本地保存路径在无既有逻辑工作夹时写入`local:<ruleId>`，且未携带`logicalLedgerId`，导致收藏库导航归入“其他收藏夹”。
- 项目书/契约已于本轮实施前更新。

## 实施证据

### I001

- 代码：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1188` 的已确认删除收尾仅对本地偏好写入重试一次；远端删除不会再次发起。`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1339` 在远端精确 ID 全部确认后调用收尾投影。
- 测试：`src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx:725` 覆盖 8 个默认规则和 2 个远端草稿，首个本地保存失败、第二次成功，断言仅一轮远端删除、两个草稿消失、8 个卡片均为`未备册`。
- 自动化结果：`npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx` 为 118/118；四个收藏夹模块组合回归为 571/571（`.codex-artifacts/2026-08-31-favorites-combined-regression.log`）；`npm test` 为 242 文件、4169 测试全通过。
- Electron：只读查看开发版掌库卡片状态，截图 `.codex-artifacts/2026-08-31-favorites-readonly-ledger-dev.png`；未点击删除、备册、绑定、同步或视频写入。无可安全删除的远端样本，所以未验证真实 B 站副作用和完成后远端重读。

### I002

- 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts:4609` 和 `electron/main/oldFavoriteWorkspaceCoordinator.ts:5947` 让当前批与整轮保存统一写入 `bilimi-logical:<ruleId>`；`src/shared/favoriteRepository.ts:1385` 仅接受受控逻辑工作夹输入，`src/shared/favoriteRepository.ts:1876` 只按精确 `local:<ruleId>` 迁移成员、归属和组织记录，不触碰 `bilibili:*`。`src/renderer/src/features/favorites/favoriteLibraryModel.ts:140` 将本地逻辑工作夹显示为`未备册`。
- 测试：`electron/main/oldFavoriteWorkspaceCoordinator.test.ts:8560` 覆盖保存的自定义规则、旧成员迁移和文件夹页读取；`src/shared/favoriteRepository.test.ts:1036` 覆盖稳定 ID 迁移及普通 B 站夹保留；`src/renderer/src/features/favorites/favoriteLibraryModel.test.ts:196` 覆盖逻辑工作夹`未备册`状态。
- 自动化结果：`npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/shared/favoriteRepository.test.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts` 为 453/453；四个收藏夹模块组合回归为 571/571（`.codex-artifacts/2026-08-31-favorites-combined-regression.log`）；`npm test` 为 242 文件、4169 测试全通过。
- Electron：仅完成掌库的只读状态查看，截图 `.codex-artifacts/2026-08-31-favorites-readonly-ledger-dev.png`；未执行“保存到收藏库”来改写当前账号本地数据，故真实导航刷新及 B 站无副作用边界保留待后续人工验收。

### 提交前总体验证

- `npm run build` 通过。
- `git diff --check` 通过；提交前仅暂存本账本、项目书、收藏夹契约、删除投影、收藏库逻辑工作夹投影及其测试，排除无关的 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 和 `.codex-artifacts/`。
