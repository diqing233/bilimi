# 整理结束后收藏库操作失效讨论需求账本

## 原文区（不可改写）

### R001

时间：2026-09-07

```text
# Files mentioned by the user:

## codex-clipboard-654dbe28-7787-4d9b-8e8b-30d3fdb197b7.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-654dbe28-7787-4d9b-8e8b-30d3fdb197b7.png

Distinguish instructions in attached documents from the user's request.

## My request:
讨论同步按钮，删除按钮，移动按钮在结束整理收藏后都不能正常运行，整理收藏过程中可以正常为什么
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-654dbe28-7787-4d9b-8e8b-30d3fdb197b7.png">哔哩哔哩 (° - °)つロ 干杯~-bil...

 [screenshot content omitted from original message rendering]
</image>
```

截图目标与待界面验收：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-654dbe28-7787-4d3fdb197b7.png`：收藏库抽屉、整理结束后的列表/工具栏、同步提示和同步/删除/移动入口；截图中批量工具栏显示“已选 0 项”，同步完成提示为“同步完成：36/36”，另有“2 个视频同步待确认”。

## 逐项索引表

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / B站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 整理收藏结束后，单视频/批量“同步到 B 站”仍按实际收藏库数据正常执行；不能因整理已结束而失效。 | 收藏库详情同步按钮、批量工具栏同步入口、主进程同步命令与状态投影。 | 选中有效视频且存在正式可写 B 站目标时可用；无目标、失败或未知按事实反馈，不伪造成功。 | 单视频正常收束；批量进入既有可暂停同步阶段；完成后立即刷新列表、详情和状态。 | 仅对正式绑定目标写 B 站；成功/失败/未知持久化真实结果。 | 不重新分类、不新增绑定、不改变整理中已有流程。 | 收藏库 UI、favoriteLibraryCommands、favoriteRepositorySyncService、B 站页面桥。 | 已实施待验证 | `FavoriteLibraryApp.tsx:1205-1258,1395-1439,1458-1548`；`favoriteRepositoryIpc.ts:485-501`；批量同步/单项同步既有回归测试通过。仍需真实 Electron + B 站账号验收。 |
| I002 | R001 | 整理收藏结束后，从收藏库删除仍可执行；本地删除不受备册、整理或 workspace 结束状态限制。 | 收藏库详情“从收藏库 bilimi 收藏夹删除”、批量删除、工作夹删除入口。 | 有本地 bilimi 归属时可执行；无本地目标显示已跳过/事实提示。 | 删除后立即收束本地成员、列表、选择和详情；不因结束整理进入无效状态。 | 本地删除只改收藏库归属；按用户选择的远端删除另行执行。 | 不删除档案、转写、普通 B 站来源或整理草稿。 | FavoriteLibraryApp、favoriteRepositoryBatchOperationService、managed folder deletion。 | 已实施待验证 | `FavoriteLibraryApp.tsx:1395-1439,1592-1667,2740-2805`；删除服务回归测试通过；刷新与选择收敛自动化通过。仍需真实 Electron 界面验收。 |
| I003 | R001 | 整理收藏结束后“移动至”仍可执行；移动后立即更新源/目标列表、数量、选择和详情。 | 收藏库详情与批量“移动至”入口、位置变更服务。 | 有合法本地 bilimi 来源和目标时可用；不由整理/备册状态禁用。 | 只改变本地 bilimi 归属；后续保存本轮可覆盖，暂不同步/结束本轮不覆盖。 | 不自动写 B 站、不创建绑定或对账。 | 不改变普通 B 站来源和已有整理流程。 | FavoriteLibraryApp、favoriteRepositoryBatchOperationService、权威快照刷新。 | 已实施待验证 | `FavoriteLibraryApp.tsx:1458-1548,2740-2805,2995-2999`；移动服务与整理结束操作回归测试通过。仍需真实 Electron 界面验收。 |

## 讨论状态

- 用户已进入讨论模式，尚未明确说“开始”；本轮禁止修改功能代码、启动真实同步或删除。
- 已确认：I001、I002、I003。
- 待用户决定：无。
- 被后续明确替代：无。
- 明确不做：无。

## 只读诊断记录

待补：整理中与整理结束的 workspace 状态、UI 禁用条件、主进程资格门控和刷新链路对照。

### R002

时间：2026-09-07

```text
对列表没刷新这个问题很致命
```

## 逐项索引表（追加）

| I004 | R002 | 任何同步、删除、移动或整理结束导致的收藏库 revision 变化，都必须及时刷新摘要、列表、详情和选择状态，避免旧 revision 继续执行。 | 收藏库抽屉的摘要、列表、详情、选择状态，以及主进程 revision 事件与 UI 订阅。 | 每次本地或远端操作产生新 revision 时触发；刷新期间不得继续提交旧快照；项目不存在时从选择和详情中清除。 | 统一收束到最新快照后再允许下一次操作；保留仍存在的选择，清除已删除/移出的项目；详情与列表使用同一 revision。 | 仅反映已持久化的本地与 B 站实际结果，不伪造状态；不引入新的绑定或对账语义。 | 不改变同步、删除、移动的既有业务语义和整理中流程；不永久禁用操作。 | FavoriteLibraryApp refresh/subscription/action runners、favoriteRepository IPC revision events、batch operation services。 | 已实施待验证 | `FavoriteLibraryApp.tsx:808-818,1089-1104,1210-1260,1395-1439`；`favoriteLibrarySelection.tsx:51-65`；页面 revision、详情刷新、选择收敛、IPC 进度标记专项测试通过。仍需真实 Electron 中验证鼠标移动/点击/滚动和操作后即时收敛。 |
