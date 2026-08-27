# 收藏夹新建规则历史恢复回归需求账本

> 讨论开始：2026-08-27。讨论模式仅记录用户原文、读取证据和讨论方案，不修改功能代码。

## 原文区

### R001

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-136b999a-bcc3-4e28-af46-aeba4218b9d8.png`

截图目标：右侧“整理收藏”面板的上方已保存收藏夹卡片与下方“改动记录”。红箭头指向上方出现的`杨颜同学`收藏夹卡；改动记录当前项显示新建`王者荣耀化堂、bilimi·杨颜同学`并参与本轮分类，底部仍提供`恢复初始改动`。

```text
讨论好像问题出现新建了
```

### R002

```text
而且恢复初始后，所有的改动记录都丢失了
```

### R003

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-68249cad-42e1-4524-8cad-e747649bc869.png`

截图目标：右侧助手面板上方已保存收藏夹区域，红箭头指向恢复初始改动后仍显示的收藏夹卡片；同时核对下方改动记录与恢复初始改动入口。

```text
讨论恢复初始改动上面的这个收藏夹没消失
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R003 | 查明“新建”后的本地收藏夹规则为何仍显示在上方卡片：区分当前历史位置本就包含新规则、历史恢复未执行/未到初始游标、主进程规则目录恢复失败，以及渲染器临时投影残留；确认与项目书规定的“恢复初始改动后移除初始快照之后新建的本地规则”是否一致。 | 整理收藏 → 上方已保存收藏夹、改动记录 → 当前记录 / 恢复初始改动；工作区历史与规则目录。 | 仅当规则创建于所选历史位置之后且恢复实际成功时应从上方移除；若当前仍在新建后的历史位置，规则应继续显示，不得误判为幽灵。 | 恢复命令发起时立即封闭被动推荐提升；只有收到同账号、同工作区、同历史游标且推荐选择已完成权威重水合的快照后才解除。恢复前的旧本地选择、缓存或 effect 不会新建草稿；明确的后续用户勾选仍沿用原保存→采用→分类路径。 | 仅本地状态投影；不得创建、绑定、删除 B 站收藏夹或写入视频。 | 不改正常上下联动、备册、删除模式、同步、DeepSeek、转写或无关 UI。 | 项目书 §5.5、§5.6；`ControlledFavoriteLedgerPanel.tsx` 的 `pendingHistoryRestoreRef`、`skipNextPassiveRecommendationPromotionRef` 与 `promoteSelectedRecommendationLedgers()`。 | 已实施，待含真实历史草稿的 Electron 界面验收 | 根因证据：`history-cursor=2` 后出现不应发生的 `favorite-rules cursor=3` 草稿写入，触发 redo 分支截断。RED 已确认：移至基线、权威 `adoptedCandidateIds=[]`、外层旧选择仍短暂存在时，旧实现会调用 `onSaveLedgers` 重建 `recommendation-draft`。自动化：`ControlledFavoriteLedgerPanel.test.tsx` 新增“does not recreate a recommendation draft from the selection that predates restoring history”，先失败后通过；2026-08-27 聚焦回归 `ControlledFavoriteLedgerPanel.test.tsx` + `oldFavoriteWorkspaceCoordinator.test.ts` 为 504/504 通过。Electron 只读截图：`.codex-artifacts/2026-08-27-favorite-history-readonly-no-draft.jpg`；当前账号没有可恢复草稿，未能安全点击验证真实恢复菜单。整个实现及验收未执行任何 B 站创建、绑定、删除或视频写入。 |
| I002 | R002 | 查明并修复“恢复初始改动”后历史菜单中原有改动记录全部丢失的问题；恢复仅移动当前游标至初始基线，历史长度、可重做记录和“恢复本次改动”入口必须保留。 | 整理收藏 → 归档预览 → 改动记录菜单、撤销/恢复按钮；工作区 durable history 与可见历史投影。 | 游标在基线时，当前记录可为初始状态，但基线之后的历史项仍应在菜单中可见，并可逐项恢复；没有真正可见的独立记录时才隐藏。 | 历史恢复只重放现有游标；不发生新的规则保存、推荐采用或分类调整时不新开分支。真正由用户随后明确触发的调整仍使用现有分支截断语义。 | 只读诊断和本地工作区历史；不得触发 B 站副作用。 | 不改正常分类、上/下勾选联动、备册、同步、删除模式、DeepSeek、转写或无关 UI。 | 项目书 §5.6“撤销 / 恢复与改动记录”；`moveHistoryCursor`、`projectVisibleFavoriteRuleHistoryEntries`、`OldFavoriteArchivePreviewStep`。 | 已实施，待含真实历史草稿的 Electron 界面验收 | 根因：恢复本身仅写入游标；后续错误草稿写入被当成恢复后的“新操作”，`recordFavoriteLedgerHistoryChangeUnsafe()` 因此按正确的分支规则丢弃了旧 redo。修复后新回归断言在恢复基线后上方草稿卡片消失、`恢复本次改动`仍启用，且不发生保存调用。自动化：同上 504/504 聚焦回归通过。Electron 截图同 I001，但由于无可恢复草稿，真实菜单的历史长度/redo 项仍待用户已有草稿时做只读验证；未执行任何远端操作。 |

## 实施计划与执行记录

1. **R001（已完成）**：在渲染器历史入口建立轻量“恢复结算屏障”，以主进程同一工作区、同一游标的权威快照和已重水合的采用 ID 作为解除条件；覆盖文件为 `ControlledFavoriteLedgerPanel.tsx` 与其组件回归测试。风险是误阻断用户真正的新勾选，测试同时保留了现有显式勾选、推荐保存和主进程分类回归。
2. **R002（已完成）**：复用现有耐久历史游标与可见历史投影，不改变分支语义；通过阻止 R001 的非用户草稿写入，保护完整历史长度、可见重做项和“恢复本次改动”入口。覆盖文件为同一组件和 `oldFavoriteWorkspaceCoordinator.test.ts` 回归。
3. **验收（部分完成）**：自动化覆盖恢复→权威重水合→不保存草稿→保留 redo；Electron 仅做只读打开与掌库查看。因当前账号没有恢复草稿，不点击创建草稿来人为制造验收数据，也不进行任何 B 站写入。

## 本轮增量执行记录（R003）

- **根因补充**：推荐草稿取消失败时，渲染器先把推荐选择置空，投影清理 effect 可能在推荐队列启动前移除上方临时规则，导致编辑器和错误提示一并消失；同时队列失败原先只返回已提交 ID，调用方无法区分“取消成功”和“取消失败”。
- **代码位置**：`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx` 的推荐投影清理、`setOrganizationRecommendedCandidates`；`src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts` 的推荐队列等待与错误传播。取消失败期间保留待处理规则 ID，队列失败时恢复组织选择引用并向 `FavoriteLedgerOverview` 传播失败；新增推荐仍先由主进程捕获历史基线，再保存规则，避免恢复初始后重建推荐草稿。
- **自动化验证**：`ControlledFavoriteLedgerPanel.test.tsx` 161/161；`oldFavoriteWorkspaceCoordinator.test.ts` 344/344；`FavoriteLedgerOverview.test.tsx` 114/114；新增取消失败回归 1/1。`git diff --check` 通过。
- **全量验证**：`npm test` 240 个测试文件、4115 个测试全部通过；`npm run build` 通过。
- **界面验收**：沿用 `.codex-artifacts/2026-08-27-favorite-history-readonly-no-draft.jpg` 只读截图；当前账号没有可安全恢复的历史草稿，无法点击真实“恢复初始改动”验证上方卡片消失及菜单重做项，标记为待用户提供可恢复草稿后复核。
- **副作用边界**：本轮未执行 B 站创建、绑定、删除、成员移动或视频写入；正常推荐采用、取消成功、上方规则删除模式和同步流程均未改变。
