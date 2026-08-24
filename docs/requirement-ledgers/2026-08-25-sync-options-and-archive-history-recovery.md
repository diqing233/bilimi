# 需求账本：同步选项与归档预览改动记录恢复

> 状态：代码与自动化验证完成，真实界面验收仍有安全限制。用户已于 2026-08-25 明确说“开始”；实施只覆盖 I001–I004，仍不得执行真实 B 站创建、绑定、删除、移动或视频写入操作。
>
> 前置工作树：`main...origin/main [ahead 988, behind 1]`；最近提交：`3eccff28 fix: unify deleted favorite rule projections`。工作树含前轮收藏夹、DeepSeek、文档、锁文件与临时文件改动，保持原样。

## 原文区

### R001

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-bf867eb8-98c6-484e-b82d-12989872bc9f.png`

截图目标区域：`整理收藏`→`确认执行`→`确认并同步到 B 站`后出现的第一层`同步选项`弹窗。弹窗显示“本次将整理 2572 条视频”、“同步前将备册：收藏夹：bilimi·原神（未备册）”，以及“同步 bilimi·暂存（196 条）”复选框与`确认同步`按钮。

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-c38d58a3-b326-4a84-b2d8-45e830923168.png`

截图目标区域：第一层`同步选项`确认后出现的第二层`同步前备册确认`弹窗。弹窗显示`收藏夹：bilimi·原神（未备册）`、创建前再次读取清单说明和`确认备册并继续`按钮。

原文：

```text
讨论为什么还是先弹窗确认同步，第二个弹窗确认备册并继续
归档预览的改动记录不能恢复收藏夹吗
```

### R002

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-63a9abab-c7f8-4f0e-91db-37236f3943d7.png`

截图目标区域：`整理收藏`→`归档预览`→`改动记录`展开菜单。当前记录与多条记录直接展示内部规则 ID，例如`custom-new-ledger-178…`；多条记录、目标收藏夹与变更方向被按钮单行省略，用户无法读全。

原文：

```text
两个同步弹窗合成一个&nbsp;&nbsp;
归档预览不恢复收藏夹的话会更乱吧，而且这里有英文字母，有的改动还没显示全
```

### R003

原文：

```text
可以，改动记录长内容不要换行，悬浮显示完整即可
```

### R004

原文：

```text
增加减少收藏夹时还是鼠标会卡
```

### R005

原文：

```text
还有什么要补充吗
```

## 逐项索引表

| ID | 原文 | 精确目标 / 讨论问题 | 目标界面 / 数据位置 | 当前观察 | 显示与交互边界 | 持久化 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002 | 将暂存同步选择、未备册目标、精确候选 ID 与容量分册合成一个最终确认窗口，消除“同步选项”后再弹“同步前备册确认”的两次确认。 | `整理收藏`→`确认执行`→`确认并同步到 B 站`。 | 已移除局部`同步选项`；父级统一持有只读预检和暂存选择。 | 有暂存或备册缺口时仅显示一个窗口；窗口中勾选暂存、逐项明确选择候选精确 ID后一次确认。两者都没有时直接进入既有冻结同步。关闭不改变草稿。 | 确认前重读预检；创建前二次读取；仅处理窗口列出的目标。真实 B 站创建/绑定/写视频本轮未执行。 | 不修改 DeepSeek、转写、删除确认、视频同步执行或单个收藏夹备册入口；不隐式认领同名远端夹。 | `OldFavoriteConfirmationStep`、`ControlledFavoriteLedgerPanel`、`FavoriteLedgerOverview`。 | 已实施，界面待完整路径验证 | 代码：`OldFavoriteConfirmationStep.tsx`、`ControlledFavoriteLedgerPanel.tsx`；测试：`ControlledFavoriteLedgerPanel.test.tsx`覆盖暂存、逻辑册候选、分册候选、预检变更及无缺口直达，`OldFavoriteConfirmationStep.test.tsx`回归；定向 RED（候选自动预选）后 GREEN：两个候选路径均断言未选即禁用。现有 Electron 草稿处于“B 站同步已暂停”，未安全进入最终确认窗。 |
| I002 | R001、R002、R003 | 归档预览恢复到任一历史位置时，同时恢复该位置精确引用、后来已删除的本地收藏夹规则及其本轮参与状态，避免视频分类指向不存在的收藏夹。 | 整理草稿的分类 history、归档预览、右侧收藏夹规则/卡片及其绑定/分册。 | 游标移动现在收集该历史位置分类的精确 ID并只恢复对应删除记录。 | 仅恢复所选历史位置所需、可精确复原的已删除本地规则；恢复 ID 从本轮排除集移除；前进/后退到不再引用的位置不自动删除规则。 | 只写本地偏好/工作区 overlay；不创建、绑定、删除 B 站夹，不恢复成员、不写视频。 | 不把分类历史误当作远端补偿；不改变既有独立删除知情同意。 | 工作区 history、删除记录、本轮排除和权威快照。 | 已实施，真实界面待有历史数据验证 | 代码：`oldFavoriteWorkspaceCoordinator.ts:moveHistoryCursor`、`index.ts:restoreDeletedFavoriteLedgerRulesForHistory`；测试：`oldFavoriteWorkspaceCoordinator.test.ts`精确 ID/同名隔离/排除恢复，`favoriteLedgerConfigurationRefreshIpc.test.ts`断言不触发重分类或远端服务。现有草稿未显示历史条目，未触发恢复操作。 |
| I003 | R002、R003 | 改动记录只显示可读中文来源与收藏夹显示名，且每条变更能完整查看，不能泄漏`custom-new-ledger-…`等内部 ID；长内容不换行，悬浮显示完整文字。 | `归档预览`→`改动记录`下拉菜单与当前记录行。 | 全部本地规则加入名称映射；未知规则采用中文占位。 | 条目保留单行截断；当前记录、菜单项和恢复入口具有完整 native `title`。 | 纯展示与本地 history 读取；不修改历史、不触发收藏夹或 B 站副作用。 | 不改变分类结果、撤销/重做语义、DeepSeek、删除确认或同步执行。 | 历史快照、规则显示名、菜单布局。 | 已实施，真实界面待有历史数据验证 | 代码：`OldFavoriteArchivePreviewStep.tsx`；测试：`OldFavoriteArchivePreviewStep.test.tsx`覆盖已停用规则、已删除规则、暂存中文名和完整`title`；同时修正旧断言从内部`inbox`改为`bilimi·暂存`。现有草稿无可见改动记录，无法真实悬浮验收。 |
| I004 | R004、R005 | 定位并消除在整理收藏中新增、删除或改变收藏夹参与状态时鼠标仍卡顿的根因，并补齐连续操作、失败、过期结果、执行资格与 Electron 验收边界。 | 右侧收藏夹卡片、推荐收藏夹、归档预览与确认执行联动的规则变更路径。 | 主因是规则 IPC 等待整轮重分类。现改为配置版本后台调度，并在跨批处理、聚合和发布间让出事件循环。 | 本地规则先保存；更新中显示“正在按最新收藏夹规则更新”并禁用保存/同步。连续变更仅最新版本可发布；失败保持失败屏障。 | 只写本地规则/工作区持久化与快照；本轮不做 B 站操作。 | 不改变 DeepSeek、转写、删除确认、视频同步执行、备册/绑定语义或单个备册入口；不以跳过重分类换取流畅。 | 规则目录 IPC、协调器版本队列、快照、渲染器轮询。 | 已实施，性能界面验收受安全状态限制 | 代码：`oldFavoriteWorkspaceCoordinator.ts`、`index.ts`、`oldFavoriteWorkspaceCoordinatorIpc.ts`、`oldFavoriteWorkspace.ts`、`useOldFavoriteWorkspace.ts`、`OldFavoriteConfirmationStep.tsx`；测试：`oldFavoriteWorkspaceCoordinator.test.ts`验证版本 1 失效、版本 2 唯一发布且保存/预检阻塞；`favoriteLedgerConfigurationRefreshIpc.test.ts`验证 IPC 立即返回运行快照；渲染器测试验证提示/禁用。Electron 仅只读确认暂停草稿在页面交互可打开；未安全触发规则变更，无法声明鼠标/缩放/最小化的更新中实测。 |

## 本轮最终自动化验证

- `npx vitest run electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`：50/50 通过；该回归覆盖 IPC 立即返回后台调度快照，而非沿用已移除的同步重分类 mock。
- `npm test`：238 个测试文件、4,075 个测试通过（2026-08-25）；输出仍有既有的 React `act(...)` 与一个渲染期 state-update 警告，但无测试失败。
- `npm run build`：通过（Electron main、preload、renderer 均已构建）。
- `git diff --check`：通过。

## 条目分类

### 已确认

- I001（R001、R002）：两个同步弹窗合成一个最终确认窗口。
- I002（R001、R002、R003）：归档预览恢复历史时，恢复精确引用的已删除本地规则及其本轮参与状态，不恢复远端实体。
- I003（R002、R003）：改动记录不泄漏内部英文 ID，保持单行截断，悬浮显示完整内容。
- I004（R004）：新增、删除或改变收藏夹参与状态时，鼠标不能卡顿；须先找到根因，不能牺牲全轮重分类和同步预检一致性。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 本讨论阶段不改功能代码、不触发本地撤销/重做、不执行 B 站创建、绑定、删除、移动或视频写入。

> 本账本随本轮代码一同提交，作为 I001–I004 的审计依据。
