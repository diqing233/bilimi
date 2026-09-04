# 收藏夹本地勾选需求账本

## 原文需求

### R001

> # Files mentioned by the user:
>
> ## codex-clipboard-4cc9295d-6cc8-45b6-afe3-e9f24ee1d678.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-4cc9295d-6cc8-45b6-afe3-e9f24ee1d678.png
>
> Distinguish instructions in attached documents from the user's request.
>
> ## My request:
> 讨论最近哪次提交改动，导致新建收藏夹加无法勾选，和取消勾选了

截图目标区域：掌库页“收藏夹”网格中新建的“官方如果”卡片；截图显示状态“未备册”，右侧为 `+`，红色箭头指向该卡片。

### R002

> 回退可以吗

### R003

> 开始

## 逐项索引

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001, R002, R003 | 对正式保存的新建收藏夹，定点回退阻止本地勾选的改动：在 B 站未登录、未备册时，`+` 与 `✓` 都能切换且本地持久化。 | 掌库 → 收藏夹卡片；账号级收藏夹启用覆盖。 | 仅唯一的本地账号下，`saved-rule`、非默认、`unbacked`、无 B 站文件夹 ID 且非未保存草稿的卡片可操作；“未备册”只表示没有远端绑定，不改变这张卡片的勾选资格。 | 点击后乐观更新；本地写入成功保留状态；真实写入失败恢复先前状态并显示错误。 | 不读取 B 站 Cookie 作为该窄写入前置条件；不创建、绑定、同步或删除 B 站收藏夹；仍阻止已登录账号切换期间向错误账号写入。 | 不回退整个 `2d516d3f`；不改推荐收藏夹、整理收藏状态机、备册流程、默认收藏夹规则或其他未提交改动。退出登录时不得借本地账号身份解锁默认体系、规则编辑、新建、备册或整理。 | `FavoriteLedgerOverview` 开关队列 → `ControlledFavoriteLedgerPanel` → `FloatingAssistantApp` → 主进程账号级启用覆盖。 | 已实施待提交 | 代码、自动化和隔离开发版验收见下方实施记录。 |

## 实施前核对

### 已确认

1. `R001–R003`：解除本地收藏夹启用/停用对 B 站登录 Cookie 的阻断，保留账号隔离与现有功能边界。

### 待用户决定

无。

### 被明确替代

无。

### 明确不做

1. 不整笔回退 `2d516d3f`；该提交还包含推荐收藏夹修复，不能一并撤销。

## 实施计划

1. `R001–R003`：在 `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx` 和 `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts` 先写失败用例，覆盖未登录时的账号级本地启用写入与写入失败可见反馈。风险：不能放宽已登录账号切换防护。验收：定向 Vitest 先红后绿。
2. `R001–R003`：仅修改 `FavoriteLedgerOverview.tsx`、`FloatingAssistantApp.tsx` 与必要的主进程测试/实现，使登录状态不是本地写入前置条件，账号错配仍拒绝写入，UI 不再吞掉失败。风险：推荐收藏与整理轮次专用开关路径不可被改动。验收：覆盖普通开关、账号错配、推荐/整理已有用例。
3. `R001–R003`：运行相关测试、类型/构建检查，并在 Electron 开发版未登录状态验证 `+ → ✓ → +`；“未备册”仍显示但不阻止操作。提交前逐项回读本账本并记录代码位置与证据。

## 实施与验收记录

### R001–R003

- 实际代码位置：
  - 审查发现早期实现曾把唯一的本地账号并入全局 B 站账号回读；这会在退出登录后伪装成仍登录，并可能越权解锁默认体系与普通规则保存，故未采用。
  - `src/shared/favoriteAccountFallback.ts` 只在本地收藏规则中恰有一个有效账号时提供候选；其中 `resolveLocalFavoriteLedgerToggleAccountMid` 还逐张检查为 `saved-rule`、非默认、`unbacked` 且没有任何 B 站文件夹 ID。
  - `src/renderer/src/App.tsx` 的 `accountMid` 始终是实际 B 站 Cookie 账号；退出登录时仅以独立的 `localFavoriteToggleAccountMid` 恢复这一张窄本地开关的收藏夹视图，读取异常仍清空账号。
  - `src/renderer/src/features/assistant/FloatingAssistantApp.tsx` 只让 `saveFavoriteLedgerEnabled` 使用该独立字段；默认收藏夹体系、规则编辑、备册和整理仍只取真实 `accountMid`。
  - `electron/main/index.ts` 在已登录时继续拒绝账号错配；未登录时只接受经 `resolveLocalFavoriteLedgerToggleAccountMid` 核准的唯一本地账号和卡片，并只调用 `writeFavoriteLedgerEnabled`。整理收藏工作区尚未开始时仅忽略该历史读取缺失，不吞掉其他读取错误。
  - `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 与 `ControlledFavoriteLedgerPanel.tsx` 只放行这一张卡片的 `+ / ✓`；重置、全选、删除、新建、编辑保存、备册和整理在该本地模式均禁用。`favoriteLedgerEnableStore.tsx` 对真实写入失败只回滚当前卡片，并显示“收藏夹启用状态保存失败，请稍后重试。”
- 自动化验证：
  - 新增 `src/shared/favoriteAccountFallback.test.ts`，覆盖唯一账号、多账号、非法/不完整本地记录，以及只允许已保存未备册自定义卡片。
  - 补充 `src/renderer/src/App.test.tsx`、`electron/main/favoriteLedgerEnabledIpc.test.ts`、`FavoriteLedgerOverview.test.tsx`、`ControlledFavoriteLedgerPanel.test.tsx` 与 `FloatingAssistantApp.test.ts`，覆盖未登录本地恢复、账号隔离、无工作区写入、默认/远端入口不解锁和失败反馈。
  - 2026-09-04 运行 `npm test`：247 个测试文件、4349 项通过；运行 `npm run build`：退出码 0。
- 隔离开发版验收：使用 `BILIMI_TEST_USER_DATA` 隔离 profile 的未登录 B 站页面，已保存的 `55 / 未备册` 卡片完成 `+ → ✓ → +`。其余默认及已备册卡片、`备册`、`整理收藏`、`备册收藏夹`、`新建收藏夹` 均保持禁用。本地 `favorite-ledger-enabled-overrides.jsonl` 记录同一账号、同一收藏夹的 `enabled:true` 与 `enabled:false`；关闭状态后重启隔离开发版，卡片仍为 `+`。未执行创建、备册、同步或删除 B 站收藏夹的操作。
