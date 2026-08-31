# 删除刷新与小咪启动响应账本

## 原文区

### R001

截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-87202546-834a-445d-9981-f951e0240a18.png`
  - 用户圈定应用启动前权限检查页面出现之前的阶段，目标是鼠标停在应用图标上无法移动的问题。
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-4b8cebe4-1b20-42c9-9892-10141f5a846a.png`
  - 用户圈定删除运行后的收藏夹页面状态。
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-508289b7-952b-4244-8c89-ee63a07b523d.png`
  - 用户圈定正常预期状态：默认收藏夹显示“未备册”，底部显示“部分 Bilimi 收藏夹尚未备册。”。

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

### R003

原文：

```text
你没检查吗，还是没有备册状态
```

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-d7bdb545-962b-4100-9edc-143bcf3b0f57.png`。用户目标区域为右侧收藏夹工作区的备册状态。

### R004

原文：

```text
鼠标也还是卡，跟之前没有任何区别
```

### R005

原文：

```text
备册情况呢，你没查吗
```

### R006

原文：

```text
备册还是不符合预期，弹窗不关闭，页面没刷新，必须重启才行，我删除的是未绑定的数据，但这个流程早都解决了呀
```

截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-7b29beff-c82a-4bf4-a58e-dec66c35957d.png`
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-73c7ac63-7908-4858-8afc-9338734eb09d.png`

目标为删除成功后的弹窗和页面备册状态，截图细节待界面验收。

### R007

原文：

```text
实际删除页面却没刷新
```

### R008

原文：

```text
你说的1.2.3是已有功能吗，别把已有功能做坏了
```

### R009

原文：

```text
先提交一下再继续，一定要保留好效果
```

### R010

原文：

```text
开始，做完休眠电脑
```

### R011

原文：

```text
继续先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）做完提交打包
```

## 逐项索引

| ID | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001, R002, R004, R005, R011 | 主窗口首帧和交互优先；小咪创建、标题栏/白条处理和鼠标恢复分段异步，整个启动过程鼠标可移动、点击、滚动、最小化、恢复和关闭不被阻塞。 | Windows 开发/安装版启动阶段、主窗口和小咪窗口。 | 主窗口交互就绪前小咪保持隐藏且点击穿透；就绪后分段启动伴随窗口。 | 主窗口 renderer 发出交互就绪信号后，自动唤醒仍要跨多个事件循环任务；重复唤醒合并，显式唤醒语义不变。 | 不涉及 B 站写入和用户数据迁移。 | 不移除小咪、透明点击穿透、拖动、白条/DWM 修补、鼠标恢复或权限检查流程；不以整窗遮罩和忙碌光标换取表面速度。 | `electron/main/index.ts` 的 `scheduleFloatingSealNativePolish` 与加载完成后的鼠标恢复调度；`floatingSealWakeController.ts`、`floatingSealCaptionStrip.ts`、主窗口 preload/renderer 就绪信号。 | 已实施，待真实 Electron 验收 | 自动化：`index.mainWindowPetStartup.test.ts`、`floatingSealWakeController.test.ts`、`floatingSealMouseRecovery.test.ts`、`floatingSealWhiteStripFix.test.ts`、`floatingSealCaptionStrip.test.ts` 共 45/45 通过（2026-09-01）。开发版已启动并观察到主进程标题栏修补日志，但当前全屏游戏阻止激活 bilimi 主窗口，未生成截图，也未能实际验收鼠标移动、点击、滚动、缩放、最小化、恢复和关闭；安装版待验收。 |
| I002 | R001, R003, R005, R006, R007, R008, R011 | 精确远端删除成功后弹窗立即关闭、页面立即从权威快照刷新；保留默认规则显示“未备册”和底部未备册提示，不因重复本地保存失败变为“本地状态待保存”。 | `FavoriteLedgerOverview` 删除弹窗、默认收藏夹卡片/详情、掌库和收藏库投影。 | 远端成功回执后，已删远端夹消失；默认规则没有正式 `physicalShards` 时显示`未备册`；只有本地收尾和权威重读均失败才保留错误检查点。 | 渲染器不再重复保存已由主进程确认的删除结果；立即采用确认结果、关闭弹窗，并发起一次非阻塞权威刷新。 | 保留精确 `folderId` 删除范围、未绑定知情同意、删除模式与已有备册/绑定流程；`managedFolderDeletedByUser` 仅由正式新绑定清除；本轮不执行真实 B 站删除。 | 不修改 DeepSeek、转写、视频同步、整理收藏、删除确认语义和未绑定候选识别。 | `FavoriteLedgerOverview.tsx` 的 `confirmManagedDeletion` 本地收尾；`electron/main/index.ts` 的 `reconcileFavoriteLedgerBindingProjection`；仓库 `physicalShards` 与权威快照广播。 | 已实施，待真实 Electron 验收 | 自动化：`FavoriteLedgerOverview.test.tsx` 122/122、`favoriteLedgerConfigurationRefreshIpc.test.ts` 7/7 通过（2026-09-01）。覆盖远端默认规则删除成功后不重复 renderer 保存、弹窗关闭、默认规则显示`未备册`、以及普通投影不清除删除标记。未执行真实 B 站删除；开发版页面截图被当前全屏游戏阻止，安装版待验收。 |

## 待用户决定

- 无。

## 被明确替代 / 明确不做

- 不执行真实 B 站删除、创建、绑定、同步或视频写入；依据 R011 的“不要影响已有功能”及本轮安全边界，仅做自动化和只读界面验收。
