# 本轮需求账本：批阅收藏后的收藏库本地登记一致性

> 本账本记录本轮从首次提出主题到用户明确“开始”为止的全部用户原文。原文永久保留；逐项索引只用于实施核对，不替代原文。

## 原文区

### R001

用户附图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-84cbbd79-9c40-43c6-ab68-ef4f27967df1.png`

截图消息原文：

> Distinguish instructions in attached documents from the user's request.
>
> ## My request:
> 还有这个收藏库没记录，什么bug

截图目标区域：右侧助手“批阅”结果反馈区域。截图显示“B站收藏已完成，但收藏库记录未能确认写入，已标记为待核对”，并包含 `Error invoking remote method '收藏按钮-repository:commit-command': Error: Frozen 收藏按钮 workspace plans are reserved for the main process.`；用户指出该次 B 站收藏后收藏库没有完整记录。具体界面文字和布局须在真实 Electron 中验收；若无法复现，标记为待界面验收，不得省略。

### R002

> 可以，还有什么要注意的吗

### R003

> 可以，先迭代项目书，再按照项目书和账本改，开始

## 逐项索引表

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001-R003 | B 站收藏确认成功后，收藏库必须完整登记视频、归属、整理保护和收藏历史；不能出现“B 站成功但本地只写了一半”的半成品。主进程拥有受保护本地状态，渲染器不能通过通用 IPC 直接写入保护记录。 | `src/renderer/src/App.tsx` 批阅收藏确认链路；`electron/main/favoriteRepositoryService.ts` 的 `checkpointConfirmedReviewFavorite`、`commitConfirmedReviewFavorite`、`recoverConfirmedReviewFavorites` 与 `repairLegacyConfirmedReviewFavorites`；`electron/main/favoriteRepositoryIpc.ts` 的专用 IPC 和账号打开顺序；收藏库视频、位置、保护记录、事件和命令结果。 | 正常用户反馈只反映 B 站真实结果：B 站确认成功为“已同步”，失败/未知为“未同步”；本地补齐过程不新增“待核对/部分同步”等第三种用户同步状态。技术失败仅进入内部日志和可恢复任务。 | B 站确认成功后页面先提交受信任的可恢复检查点，再由主进程一次性提交本地四类记录；失败可按同一 `operationId` 幂等重试；账号打开先完成最多 100 条仅本地恢复，再修复旧半记录。多目标收藏夹必须整体校验后再写入；账号、规则绑定和远端 folder ID 由主进程重新校验。 | 新增私有 `confirmed-review-recovery.json` 账号级恢复日志；它只保存确认结果的本地补写资料，不含凭据。原子登记成功后清除对应条目；绑定不合法时保留条目等待后续仅本地重试。保持通用 `favorite-repository:commit-command` 对冻结工作区命令的保护。旧半完成记录只补缺失保护/事件，不重新收藏、不覆盖较完整视频资料、不改变用户后来人工归属。 | 不放宽通用 IPC；不改变 DeepSeek、转写、整理扫描、B 站收藏接口语义；不重复执行 B 站写入；不把本地失败伪装成 B 站失败，也不因本地问题删除已有视频、档案、札记或远端收藏。 | 批阅最终归属与 `favoriteFolderIdsByLedgerId`；当前账号；绑定快照；收藏仓库命令幂等/版本；收藏库 revision 发布；账号切换和应用重启恢复。 | 已实施待验证 | 自动化已通过：`electron/main/favoriteRepositoryService.test.ts` 覆盖原子登记、幂等、无效绑定、旧半记录、重启恢复与延后绑定恢复；`electron/main/favoriteRepositoryIpc.test.ts` 覆盖新/旧恢复顺序、专用 IPC 和通用保护拒绝；`src/renderer/src/App.test.tsx` 覆盖先检查点后登记、登记拒绝仍保留 B 站成功反馈且不提交通用保护命令。聚焦测试 252/252、全量 3905/3905、`npm run build` 通过。开发版 Electron 已观察到批阅页正常加载和`藏/归入内库`入口；窗口显示的旧 `Frozen ...` 提示是修复前历史反馈。未在真实账号上再次点击归库，因为它会写入 B 站；待用户明确授权当前一次真实收藏验收后核对无新 Frozen 提示、收藏库视频/归属/保护/历史与重开恢复。 |

## 条目分类

### 已确认

- R001：修复截图所示“B 站收藏完成但收藏库记录未确认写入”的真实 bug，并以实际数据为准验收。
- R002：补充实现时需要注意的边界，已并入 R001 的原子性、幂等、恢复、安全和状态显示要求。
- R003：先更新项目书，再按项目书和本账本修改代码并开始实施。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 本轮不放宽通用收藏仓库 IPC 的主进程保护；依据 R001-R003 的确认范围。
- 本轮不修改 DeepSeek、转写、多 P、整理扫描或 B 站收藏动作本身；依据 R001-R003 的边界确认。

## 实施记录

| 原文编号 | 代码位置 | 自动化测试 | 真实界面验收 | 结果 | 无法验证条件 |
| --- | --- | --- | --- | --- | --- |
| R001-R003 | `src/shared/favoriteRepository.ts`（专用输入）；`electron/main/favoriteRepositoryService.ts`（原子登记、恢复检查点与旧数据修复）；`electron/main/favoriteRepositoryIpc.ts`、`electron/preload/index.ts`、`src/renderer/src/global.d.ts`（受信任专用边界）；`src/renderer/src/App.tsx`（常规批阅与 DeepSeek 二判先检查点后登记）；`docs/项目功能项目书.md` §2.2、§2.4 | `npm test -- --run electron/main/favoriteRepositoryService.test.ts electron/main/favoriteRepositoryIpc.test.ts src/renderer/src/App.test.tsx`：3 文件 252/252；`npm test`：236 文件 3905/3905；`npm run build`：Electron main、preload、renderer 均完成 | 开发版 Electron：批阅页、`藏/归入内库`和本轮页面没有崩溃；未执行真实归库，避免未经当前授权写入 B 站。窗口内旧 `Frozen` 提示为历史记录，不能作为本轮失败证据。 | 已实施待验证：代码、迁移恢复与自动化回归完整；真实 B 站副作用验收尚未执行 | 需用户明确授权后在开发版执行一次实际`归入内库`，再核对 B 站结果、收藏库视频/归属/保护/`entered`历史、重复动作幂等和账号重开后的本地恢复；不需要也不会再现旧通用保护命令。 |
