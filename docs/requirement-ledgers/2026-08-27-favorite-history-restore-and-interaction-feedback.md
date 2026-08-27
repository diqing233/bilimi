# 收藏夹改动记录恢复与交互反馈需求账本

> 讨论开始：2026-08-27。该文件的“原文区”逐条保留本轮从首次提出主题到用户明确说“开始”为止的用户消息；讨论模式不修改功能代码。

## 原文区

### R001

截图一：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-50d9555e-4d74-442c-9b43-c2733e116c56.png`

截图二：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-38858ce8-c8c2-4c36-80e3-85aeac0d3a56.png`

截图目标：截图一为“整理收藏 → 归档预览 → 改动记录”菜单，箭头指向仍存在的“收藏夹规则与勾选已更新”项，以及“恢复初始改动”入口；截图二为“整理收藏 → 推荐收藏夹”中可勾选的推荐项。

```text
讨论收藏夹规则与勾选已更新还是有
另外这些可点击的选项，鼠标放在上面时要加深变成可点击的感觉，
我点击恢复初始改动后上面的收藏夹没有取消勾选，下面确实取消勾选了，改动记录如果是有关收藏夹改动，要按照调用现有设计代码改变，而不是单独的设计
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明并移除仍出现的“收藏夹规则与勾选已更新”泛化记录；收藏夹相关记录必须沿用现有规则选择/恢复调用链生成真实效果，而非另行拼接独立状态。 | 整理收藏 → 归档预览 → 改动记录；`history.entries`、`favoriteRuleState`、历史快照摘要。 | 仅作用于收藏夹规则/勾选造成的历史项；普通自动分类、人工移动、DeepSeek 历史保持原有显示。 | 一次收藏夹操作及其分类结果应由同一现有历史恢复语义驱动；恢复时使用同一事实还原上方、下方与分类投影。 | 只影响本地工作区历史与显示；不创建、绑定、删除 B 站收藏夹，不写入视频。 | 不另建绕过现有规则选择、排除、推荐采用和历史游标的平行状态机；不改 DeepSeek、删除模式、备册或同步执行。 | 上轮 I001/I002、`recordFavoriteLedgerHistoryChangeUnsafe`、`moveHistoryCursor`、上方勾选与推荐投影。 | 已实施待验证 | 实现：`electron/main/oldFavoriteWorkspaceCoordinator.ts` 的 `favoriteRuleHistoryEffect` 从已有 `favoriteRuleState.before/after` 生成新建、删除、勾选、取消、更新语义；`OldFavoriteArchivePreviewStep.tsx` 显示真实动作，旧无摘要项改为可读恢复范围。自动化：`oldFavoriteWorkspaceCoordinator.test.ts`、`OldFavoriteArchivePreviewStep.test.tsx` 已随聚焦组通过。Electron：开发版只读进入掌库；当前账号仅暴露“未完成草稿”恢复窗口，未为验收改写草稿，未能安全进入改动记录菜单。未发生 B 站创建、绑定、删除或视频写入。 |
| I002 | R001 | 恢复初始改动后，上方已保存收藏夹的勾选状态必须与下方推荐投影一致；截图现象为下方已取消而上方仍勾选，需按稳定规则 ID 和现有恢复代码统一恢复。 | 整理收藏 → 改动记录 → 恢复初始改动；掌库上方收藏夹卡、推荐收藏夹卡、账号级 `enabled`、工作区排除/采用集合。 | 仅当历史位置的收藏夹状态与当前不同才更新；上方与下方为同一稳定规则 ID 时必须一致。 | 恢复历史后按该历史位置恢复规则、上方勾选、下方采用状态、排除集合与分类，再发布同一权威快照。 | 仅恢复本地规则和工作区状态；不创建、绑定、删除 B 站收藏夹，不恢复远端成员，不写视频。 | 上方取消仍不删除规则；下方纯推荐草稿的取消语义保持既有设计；不按同名猜测。 | 上轮 I001、`moveHistoryCursor` / `restore`、`favoriteRuleState`、`ControlledFavoriteLedgerPanel` 投影。 | 已实施待验证 | 实现：`ControlledFavoriteLedgerPanel.tsx` 仅在同账号权威 `previewing` 快照到达后，以稳定规则 ID 重水合上方缓存；在途点击保留乐观值，避免回弹。自动化：面板测试覆盖“先上方取消、恢复初始改动、权威排除集合恢复”后上方重新显示“移出同步”，聚焦组通过。Electron：同 I001，当前真实草稿仅显示恢复入口；未点击恢复草稿以避免修改用户本地工作区，故真实历史恢复链待用户已有安全测试草稿时复验。未发生 B 站副作用。 |
| I003 | R001 | 所有截图中可点击的改动记录菜单项与“恢复初始改动”入口，鼠标悬停时应加深，明确提供可点击反馈。 | 整理收藏 → 归档预览 → 改动记录菜单。 | 仅对可点击且未禁用的选项生效；当前记录、分隔符、说明文本与禁用项不伪装为可点击。 | 指针移入时提高可读对比/背景强调；离开时恢复默认；禁用时无可点击暗示。 | 纯渲染样式，无持久化、迁移或 B 站副作用。 | 不改变菜单文字、位置、内容、历史恢复逻辑或其它卡片的颜色层级。 | 现有 `.favorite-ledger-panel__archive-history-entry`、`.favorite-ledger-panel__archive-history-restore` 样式与可用状态。 | 已实施待验证 | 实现：`src/renderer/src/styles.css` 为未禁用历史项、恢复入口和推荐收藏夹卡添加 `cursor: pointer`、hover/focus-visible 的加深边框、背景和焦点反馈；禁用项不匹配选择器。自动化：`src/renderer/src/styles.test.ts` 已断言上述样式片段，聚焦组通过。Electron：开发版只读已到达草稿恢复弹窗，当前状态不允许不改写草稿地展开改动记录；运行时悬停待在安全草稿中复验。无持久化或 B 站副作用。 |

## 诊断证据（2026-08-27）

### I001：泛化历史文案仍出现

- 截图中的“收藏夹规则与勾选已更新”来自 `OldFavoriteArchivePreviewStep.tsx` 的明确兼容分支：当历史项 `source === 'favorite-rules'`、但快照摘要没有 `favoriteRule` 时，`historyLabel` 固定返回该泛化文字。
- `favoriteRule` 摘要只从 `favoriteRuleHistoryEffect` 得出；现有逻辑只把“推荐采用集合、排除集合、规则 `enabled`”的变化视为可读的勾选/取消效果。规则新增、删除、编辑、排序或只产生等价状态差异的恢复历史项没有操作语义，因而走泛化回退。
- 真实账号当前 `previewing` 工作区的只读 journal 也包含 `source: 'favorite-rules'`、`changes: 0`、但没有可归入勾选/取消的有效动作的条目；这证明问题不是截图缓存。该类条目由 `electron/main/favoriteLedgerHistoryWiring.ts` 的 `recordFavoriteLedgerHistoryAroundMutation` 引发：它围绕任意收藏夹首选项变更只捕获 `before/after`，没有传递“用户执行了哪种规则操作”的事实。
- 不能简单在渲染器隐藏这些条目：它们仍是可恢复游标的一部分。也不能从 UI 文案猜测操作；应在现有主进程规则变更/重分类事务中记录准确的稳定 ID 操作语义，并让分类移动与该同一条目合并。普通自动分类、人工移动和 DeepSeek 条目不在本项改动范围。

### I002：恢复初始改动后上下投影不一致

- 主进程 `OldFavoriteWorkspaceCoordinator.moveHistoryCursor` 已先调用现有 `restoreFavoriteLedgerHistoryState(accountMid, state)`，再恢复推荐采用集合、排除集合并重建本地分类；`electron/main/index.ts` 的该回调将历史规则写回原有账号收藏夹首选项并广播 `assistant:preferences-changed`。该路径不接触 B 站。
- 上方不随恢复变化的直接原因位于 `ControlledFavoriteLedgerPanel.tsx`：`organizationSavedLedgerParticipationById` 与 `ledgerEnabledById` 是点击中的乐观缓存，且优先于新 `ledgers[].enabled` 和工作区 `excludedLedgerIds`。它们当前只在账号切换时清空，不会在历史恢复导致的“同账号、新权威规则快照”到达后失效；下方则直接从工作区推荐采用快照投影，因此已经取消。
- 正确修复不是让主进程调用 React 的勾选处理器：那会把恢复操作错误地记成一次新的用户勾选、增加历史项并可能破坏队列顺序。应保持既有主进程恢复调用链，在其权威结果和首选项广播到达后，安全失效/重水合上方乐观缓存；在正在提交的用户点击期间仍保留乐观状态，避免回弹和卡顿。

### I003：可点击反馈缺失

- 现有 `.favorite-ledger-panel__archive-history-menu button` 只有默认白底、边框和文本规则；`.favorite-ledger-panel__archive-history-entry` 与 `.favorite-ledger-panel__archive-history-restore` 没有专属 `:hover` / `:focus-visible` 规则，也没有为可用项设置 `cursor: pointer`。因此截图中菜单项缺少可点击感。
- 应只给未禁用的历史条目及“恢复初始改动”添加更深的背景/边框/文字反馈和键盘焦点样式；“当前记录”、分隔线、说明及禁用项保持原状。

## 实施与验证记录（2026-08-27）

- 已按 R001 的现有主进程恢复链实施；没有建立新的规则、勾选、推荐采用或历史游标状态机。
- 聚焦回归命令：`npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/styles.test.ts --reporter=dot`；最终复跑结果为 4 个测试文件、599 个测试全部通过（74.18 秒）。测试输出存在既有 B 站预检模拟日志与 React `act(...)` 警告，但无失败。`npm run build` 于同一工作树通过。
- Electron 开发版只读验收：已进入“掌库”，观察到账户当前有未完成整理草稿及“恢复草稿 / 重新扫描 / 放弃本轮整理”窗口。为保护现有草稿，未点击恢复、重新扫描、放弃、备册、删除、同步或任何 B 站写入动作；因此无法在不改变用户数据的前提下到达改动记录/恢复初始改动和推荐项 hover 的真实运行时状态。Computer Use 的截图只在工具会话显示，当前接口不提供可安全导出到 `.codex-artifacts/` 的文件句柄；未伪造截图路径。
