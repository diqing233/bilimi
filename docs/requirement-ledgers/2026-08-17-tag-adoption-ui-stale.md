# 本轮需求账本：采用标签后确认区仍显示通用阻塞提示排查

## 原文区（不可改写）

### R001

原文消息：

```text
# Files mentioned by the user:

## codex-clipboard-72ccfdbf-7def-40ed-937a-caf4af4740bf.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-72ccfdbf-7def-40ed-937a-caf4af4740bf.png

Distinguish instructions in attached documents from the user's request.

## My request:
为什么，是不是要重新整理
```

截图目标区域：掌库 > 整理收藏 > 确认执行 > 本轮总览。可见“整体准备度：2563 / 2563 条已分类”“标签结果仍有 0 条待补取或读取失败，完成补取或选择当前结果后才能保存或同步。”、保存/同步按钮置灰，以及“已汇总 2/2 批”“尚未扫描 100 条”。截图路径如 R001 原文所列，待只读核对运行版本、工作区 snapshot/journal、扫描完整性和采用标签持久化状态。

### R002

原文消息：

```text
开始项目书也要同步迭代
```

## 逐项索引表

| 状态 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|
| 已实施待真实草稿验收 | R001 | 查明截图为何仍显示“仍有 0 条待补取或读取失败”，以及是否真的需要重新整理。 | 确认执行区、标签采用状态、扫描概览、本轮总览和工作区 journal。 | 截图中标签待补取/失败为 0、2563/2563 已分类、但写入按钮禁用且另有“尚未扫描 100 条”。 | 重启后采用按完整持久化分段逐批重算；仅当协调器明确标识本次失败已持久化时，IPC 才回传权威失败快照，确认区不再使用点击前旧快照。 | 测试只用临时工作区；未操作真实草稿、收藏库或 B 站。失败保留草稿和分类。 | 不因通用文案直接假定标签有待补取；不把未扫描数量、旧运行版本、旧 journal 或采用重算失败混为同一原因。 | `electron/main/oldFavoriteWorkspaceCoordinator.ts:58,3686,4302`、`electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts:459`、`OldFavoriteConfirmationStep.tsx`既有失败投影。 | 红灯：重启多批测试报`segment is unavailable`；IPC 测试先直接拒绝采用异常，并覆盖旧失败状态不得掩盖本次存储异常。绿灯：`npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts` 为 345/345；确认区 37/37；`npm run build`通过。新增测试：`oldFavoriteWorkspaceCoordinator.test.ts:2323`、`oldFavoriteWorkspaceCoordinatorIpc.test.ts:418,443`。真实用户草稿未点击采用，待重启后由用户验收。 |
| 已实施待真实草稿验收 | R002 | 项目书必须同步写明本轮恢复、失败投影与扫描状态的产品契约。 | `docs/项目功能项目书.md` 第 5.3、5.8 节。 | 多批重启后采用、采用重算失败、确认区按钮禁用，以及“已分类”和“尚未扫描”并存时适用。 | 主进程按持久化完整分段重算；命令失败后界面替换为权威失败快照；独立扫描未完成状态仍按事实显示。 | 仅改变产品契约与本轮代码；不操作现有草稿、收藏库或 B 站。 | 不把内部错误详情显示为用户文案；不把修复作为重新整理或重扫的理由。 | 持久化分段描述符、`tagAdoption` journal、IPC 命令返回和确认区投影。 | 项目书第 5.3 节新增“重启后的多批采用与失败快照”，第 5.8 节新增“已分类”与“已扫描”独立事实；与 R001 同批自动化验证通过。 |

## 待用户决定

无。

## 被明确替代

无。

## 明确不做

无。
