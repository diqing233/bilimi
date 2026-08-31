# 启动鼠标与删除后备册状态刷新账本

## 原文区

### R001

截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-87202546-834a-445d-9981-f951e0240a18.png`
  - 用户圈定应用窗口中“启动前权限检查”页面外的主显示区域；目标为该页面出现之前，鼠标停在应用图标上无法移动的启动阶段。
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-4b8cebe4-1b20-42c9-9892-10141f5a846a.png`
  - 删除运行后的收藏夹页面状态。
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-508289b7-952b-4244-8c89-ee63a07b523d.png`
  - 正常的预期状态：默认收藏夹卡片显示“未备册”，底部显示“部分 Bilimi 收藏夹尚未备册。”。

原文：

```text
1.图一应用启动出现这个页面前鼠标卡在应用图标上动不了，小咪宠物可以起动慢点，但整个过程鼠标别卡
2.运行删除后怎么没有备册情况了，删除后默认收藏夹应该是未备册，详情页和卡片外表都不显示了，正常显示应该是图3
```

### R002

原文：

```text
打开项目优先尽快加载画面app，再加载小咪宠物，保证整个过程不卡，先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）
```

## 逐项索引

| ID | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001, R002 | 应用启动至“启动前权限检查”页面出现前，鼠标保持可移动；主界面优先尽快出现并可响应，小咪宠物在主界面首帧后再启动。 | Windows 安装版启动阶段、启动前权限检查页。 | 启动加载期间不能因主进程同步工作阻塞系统鼠标；宠物不可抢占主窗口的首帧或交互。 | 应用在主渲染器首帧/交互就绪后以异步空闲任务启动宠物，不改变权限检查页、手动唤醒或宠物既有交互。 | 不涉及数据迁移或 B 站写入。 | 不以删除权限检查、隐藏错误或降低应用功能为代价；不得引入按钮点击卡顿。 | Electron 主进程启动顺序、窗口创建、主渲染器就绪信号、宠物进程。 | 已实施待验证 | 代码：`electron/main/index.ts` 自动唤醒就绪信号/异步调度；`electron/preload/index.ts` 暴露 `notifyMainWindowInteractive`；`src/renderer/src/App.tsx` 首帧后发送信号。测试：`electron/main/index.mainWindowPetStartup.test.ts`，以及 `floatingSealWakeController.test.ts`、`floatingSealMouseRecovery.test.ts`。Electron 开发版已观察主窗口先可交互、后出现小咪，滚动/最小化/恢复可用；安装版启动鼠标真实测量待验收。 |
| I002 | R001, R002 | 删除运行完成后，默认收藏夹显示“未备册”；详情页和卡片外表均恢复图 3 的未备册状态与提示。 | 收藏夹侧栏的默认收藏夹卡片、详情页及“部分 Bilimi 收藏夹尚未备册。”提示。 | 删除后只剩默认收藏夹且未备册时，必须显示未备册；不能残留“已删除/待保存”或隐藏备册状态。 | 删除完成后立即刷新本地投影、详情和卡片，不要求重启。 | 删除为既有确认流程；本项不新增 B 站写入。 | 不改变已确认的删除语义、备册逻辑或其他收藏夹规则；不得引入按钮点击卡顿。 | 删除结果投影、收藏夹账本能力、渲染器刷新及默认收藏夹状态计算。 | 已实施待验证 | 代码：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 保留未备册状态；`ControlledFavoriteLedgerPanel.tsx` 删除成功后调用 `onRefreshOrganizationState` 权威刷新；`FloatingAssistantApp.tsx` 已提供现有回调。测试：`FavoriteLedgerOverview.test.tsx`、`ControlledFavoriteLedgerPanel.test.tsx`，以及 `managedFavoriteLedgerDeletionPersistence.test.ts`。Electron 开发版已观察默认卡片及底部“部分 Bilimi 收藏夹尚未备册。”提示；未执行真实 B 站删除，安装版真实删除后的即时刷新待验收。 |
