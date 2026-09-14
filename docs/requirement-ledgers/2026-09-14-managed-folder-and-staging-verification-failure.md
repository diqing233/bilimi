# 2026-09-14 工作夹远端删除与未匹配暂存验收失败：需求账本

> 主题：核实上一轮“删除并同步到 B 站后工作夹不再刷新出现”和“未匹配项保存后进入正式 `bilimi·暂存`”修复未在真实界面生效的原因。
>
> 已在用户明确说“开始”后实施。真实 B 站删除和真实界面写入未执行，避免触碰现有账号数据；其余实现和自动化验证见下方逐项证据。

## 原文需求区（按对话顺序，永久保留）

### R001

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-51361706-d450-43c8-901f-b9d5535b7502.png`

用户圈定/描述的目标区域：收藏库左侧“bilimi 工作夹”列表未出现 `bilimi·暂存`；右侧“确认执行”黄色提示为“本轮未匹配到合适分类 133 条，将保存到 bilimi·暂存；同步时默认不上 B 站。”，下方存在“重新保存本轮到收藏库”按钮。用户同时反馈“bilimi工作夹删除同步到b站后还是会刷新出来”。截图已读取，待以真实 Electron 操作流验收。

用户消息原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-51361706-d450-43c8-901f-b9d5535b7502.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-51361706-d450-43c8-901f-b9d5535b7502.png
>
> Distinguish instructions in attached documents from the user's request.
>
> ## My request:
> 两个都没实现，bilimi工作夹删除同步到b站后还是会刷新出来，
> 未匹配到合适分类，点击保存到收藏库没有保存在bilimi·暂存里

## 逐项索引表

| 索引 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 找出并修复“删除并同步到 B 站”成功后 bilimi 工作夹仍被刷新重建的真实调用链。 | 收藏库左侧 `bilimi 工作夹`、远端删除后刷新/恢复链、本地隐藏偏好。 | 成功远端删除后的技术刷新、窗口重开和普通读取均不得重建；只有用户已确认的明确业务恢复行为可恢复。 | 删除成功、刷新、恢复与右侧规则投影必须一致。 | 必须核实远端删除结果、本地投影、隐藏标记是否实际写入/被消费；不得误操作 B 站。 | 不新增 B 站读取、写入或删除；远端失败、未知和部分成功不隐藏/删除整批本地投影。 | 删除服务、收藏库刷新协调器、显式业务恢复调度、账号偏好。 | 已实施，真实远端待验收 | 实际 `%APPDATA%\\bilimi-dev` 仓库记录：revision 75 为 `favorite-delete-local:*` 的 `delete-local-managed-folders`，紧接 revision 76 为 `favorite-library:restore-empty-unbacked:entertainment:75`。根因是实际入口 `FavoriteRepositorySyncService.deleteManagedFolders()`（原 `:1377-1448`）没有像另一删除服务一样在本地删除前写入隐藏标记，也没有纳入恢复器账号锁；恢复器遂按仍启用的规则重建空壳。实施：`favoriteRepositorySyncService.ts:296-299,1443-1468` 仅在远端结果为完整 `succeeded` 后，于恢复器账号锁中写隐藏 ID 再提交本地删除；本地提交异常时仅回滚本次新增标记。`index.ts:2672-2679` 接入现有持久化和锁。回归：新增服务测试，`npm test -- electron/main/favoriteRepositorySyncService.test.ts` 为 89/89；全量 `npm test` 为 255 文件、4674 项通过。真实 B 站删除未执行，故技术刷新/重开实际流仍待用户环境验收。 |
| I002 | R001 | 找出并修复点击“保存到收藏库”后，未匹配视频未进入左侧正式 `bilimi·暂存` 的真实按钮/提交路径偏差。 | 整理收藏确认执行区“重新保存本轮到收藏库”、左侧正式 `bilimi·暂存`、本地仓库成员与导航。 | 完成本轮保存后有效未匹配项必须显示于正式 `bilimi·暂存`；扫描期后台暂存不得显示为正式工作夹。 | 按钮实际触发的保存命令必须和黄色提示承诺相符；保存完成后导航须更新。 | 默认不同步暂存至 B 站；不得把扫描期后台数据误显示为正式暂存。 | 保留多批“保存本批”只做局部保存的既有语义；不把扫描期后台暂存展示成正式工作夹。 | 渲染层按钮、IPC、协调器分段/整轮保存、本地仓库 revision 与导航投影。 | 已实施，真实界面待验收 | 实际仓库 revision 73 只有 `old-favorite-workspace:local:*:segment-1:*`，`local:inbox` 有 133 项而 `bilimi-logical:inbox` 为 0；不存在 `old-favorite-workspace:remote-local:*` 提交。根因：单批次界面仍显示“重新保存本轮到收藏库”（原 `OldFavoriteConfirmationStep.tsx:385`），却走 `onSaveLocally` → `saveCurrentSegmentToLocalLibrary()`（`ControlledFavoriteLedgerPanel.tsx:1665`），该接口按设计仅写隐藏 `local:inbox`（协调器 `:4660-4662`）。实施：`OldFavoriteConfirmationStep.tsx:385` 的单批“保存/重新保存本轮到收藏库”现调用 `onSaveWholeRun`，进入既有完整本轮保存链；多批当前批按钮未改。回归：新增渲染测试，`npm test -- src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx` 为 41/41；全量 `npm test` 为 255 文件、4674 项通过。开发版和预览版均启动到 Electron；因本机窗口自动化服务未配置，未点击真实用户工作区，正式 `bilimi·暂存` 的视觉出现待用户环境验收。 |

## 条目分类

### 已确认

- I001（R001）：已实施；真实界面中远端删除后的刷新/重开待验收。
- I002（R001）：已实施；真实界面中保存后正式 `bilimi·暂存` 出现待验收。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 本轮不打包，不对真实 B 站执行删除、同步或测试写入。

## 排查结论与实施前核对

1. I001（R001）：上一轮修复覆盖了 `FavoriteRepositoryManagedFolderService`，但用户实际使用的是 `FavoriteRepositorySyncService.deleteManagedFolders()`。修复必须只在远端删除完整成功后，把本次逻辑工作夹 ID 写入 `hiddenFavoriteLibraryManagedLedgerIds`，并用 `FavoriteRepositoryEmptyManagedFolderRecovery.runWithLocalManagedFolderDeletion()` 将写标记和本地投影删除串行；本地提交失败时只撤回本次新增标记。远端失败、结果未知或部分成功不得把整批本地投影标记为已删除。
2. I002（R001）：不是协调器的正式暂存物化逻辑失效，而是单批次“本轮”按钮调用了错误层级的保存入口。修复应让该按钮调用整轮本地保存入口；保留多批次的“保存本批”语义及后台 `local:inbox`，不把扫描期数据展示成正式工作夹。整轮成功后必须存在正式 `bilimi-logical:inbox`、左侧显示 `bilimi·暂存`，且默认 B 站冻结计划不含该暂存项。

实施时需先增加失败回归：

- 同步删除成功后，普通读取、刷新和重开工作区均不能恢复该工作夹；明确业务恢复才允许消费隐藏标记。
- 单批次界面“保存/重新保存本轮到收藏库”必须经过 UI → hook → IPC → 整轮协调器链路，生成正式 `bilimi-logical:inbox`；单批“保存本批”仍只保持原有局部保存边界。

## 实施与验证记录

1. I001（R001）：`FavoriteRepositorySyncService.deleteManagedFolders()` 现在从实际存在的 `bilimi-logical:*` 投影取得逻辑 ID，只在完整成功远端删除后，在 `runWithLocalManagedFolderDeletion()` 内先调用 `markLocalManagedFoldersHidden()`，再提交 `delete-local-managed-folders`。失败/部分成功/未知结果沿用原提前返回，不会写隐藏标记。`electron/main/index.ts` 复用 `FavoriteRepositoryEmptyManagedFolderRecovery` 账号锁和 `persistLocalManagedFolderHiddenIds()` 持久化事务；无新 B 站调用。新增单元回归精确断言顺序 `lock → hide:music → delete-local`；先验证为 RED，实施后 89/89 通过。
2. I002（R001）：单批“保存本轮到收藏库”只替换点击目标为现有 `onSaveWholeRun`；标签/DeepSeek/可用性禁用条件、文案及多批“保存本批”均未改变。新增渲染回归精确断言它调用整轮处理器且不调用局部处理器；先验证为 RED，实施后 41/41 通过。
3. 联测与发布门禁：全量 `npm test` 于 2026-09-14 结束码 0（255 文件、4674 测试通过）；`npm run build` 结束码 0；`npm run dev` 及 `npm run preview` 均完成 Electron 主进程、预加载与渲染构建并输出 `start electron app...`。构建仅有既存的动态/静态导入分块提示。Windows 窗口自动化服务返回“Trusted RPC service is not configured”，故无法控制 Electron 做无破坏性点击；且为保护用户已登录账号，本轮没有执行真实 B 站删除、同步或保存。因此两项真实界面验收保留为待用户环境验证，不能把自动化测试当作其替代。
