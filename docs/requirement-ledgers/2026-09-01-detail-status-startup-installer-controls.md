# 整理详情备册状态、启动响应与安装向导控件账本

## 原文需求

### R001

三个问题一个没解决
1.整理收藏不显示未备册，但是详情页要展示呀，我让你看项目书你看哪去了
2.鼠标还是卡，继续分析整个启动过程怎么优化
3.安装向导  `×` 不可用

### R002

先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）做完提交打包

## 逐项索引

| 编号 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 整理收藏期间卡片/列表可按项目书隐藏远端生命周期状态，但当前详情编辑区仍必须显示真实`未备册`等状态。 | `FavoriteLedgerOverview` 上方收藏夹卡片与右侧/下方当前收藏夹详情。 | 整理期间仅卡片/列表投影及整理区提示隐藏；详情标题状态、绑定摘要和远端草稿事实保持可见。整理结束/关闭后全部恢复真实状态。 | 仅修正显示门控，不改变勾选、分类、预览或同步资格。 | 不写 B 站、不创建/绑定/删除/备册，不改规则和分类持久化。 | 不改变推荐取消删除、删除模式、DeepSeek、转写、视频同步和统一弹窗。 | `FavoriteLedgerOverview` 状态标签与项目书 5.5。 | 已确认 | 待实施；需 Vitest 与 Electron 只读截图。 |
| I002 | R001 | 启动全过程主窗口首帧和交互先可用；小咪及其原生修补、鼠标恢复在后台分段执行，鼠标移动/点击/滚动/窗口操作不被阻塞或卡住。 | `electron/main/index.ts`、`App.tsx`、小咪调度/原生修补模块；开发版和安装版。 | 主窗口创建、首帧、renderer 交互就绪后才有资格创建小咪；每个阶段让出事件循环；小咪显示前不启动鼠标恢复轮询。 | 保留现有小咪显示、拖动、透明穿透和显式唤醒语义；增加阶段诊断和可取消空闲调度，失败不阻塞主窗口。 | 不涉及 B 站、账号数据、收藏夹或远端写入。 | 不改首页 URL/Cookie/代理、浏览器标签、收藏流程和已有小咪交互。 | 启动时序、`floatingSealIdleTask`、`floatingSealWakeController`、鼠标恢复控制器。 | 已确认 | 待实施；需启动日志/测试及开发版、安装版过程验收。 |
| I003 | R001 | 安装向导完成页右上角最小化、最大化、关闭三个系统按钮可用；隐藏无效的`上一步(P)`和`取消(C)`，保留`完成(F)`与运行复选框。 | Windows NSIS 完成页。 | 仅完成页启用系统按钮；其它安装页、卸载页和主窗口不变。 | 点击`×`只关闭安装向导，不回滚安装；最大化可调整窗口；完成按钮行为保持。 | 不回滚安装、不删除用户数据、不触发 B 站副作用。 | 不修改 Electron 主窗口、小咪或收藏夹逻辑。 | `electron/installer/installer.nsh`、NSIS Finish 宏、安装包。 | 已确认 | 已构建 `C:\Users\diqing\bilimi\dist\bilimi.Setup.1.1.0.exe`；需真实点击完成页控件。 |

## 实施计划与边界

1. I001：更新项目书 5.5 的显示门控表述；增加详情显示未备册回归测试；仅修改 `FavoriteLedgerOverview.tsx` 对应标签门控和测试。
2. I002：先补充启动阶段埋点/顺序测试，确认主窗口初始化与小咪原生修补的阻塞边界；仅在 `electron/main/index.ts`、启动调度/小咪模块及对应测试中做最小分段改动，不触碰业务数据。
3. I003：补充 NSIS 完成页系统菜单/关闭消息验证；仅修改 `electron/installer/installer.nsh` 和安装器测试，完成后构建并人工验收安装包。

所有步骤均保留整理收藏、删除、备册、绑定、同步、DeepSeek、转写及其它既有功能；不执行任何真实 B 站写入。

## 验收记录

### 实施验收记录

| 编号 | 代码位置 | 自动化测试 | 界面/安装验收 | 结果与未验证条件 |
| --- | --- | --- | --- | --- |
| I001 | `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`：卡片使用整理期门控，详情编辑器使用真实 `combinedStatusLabel`；项目书 5.5 同步更新。 | `FavoriteLedgerOverview.test.tsx` 125/125；`ControlledFavoriteLedgerPanel.test.tsx` 170/170。 | Electron 详情真实操作截图待补。 | 详情在整理期间显示真实`未备册`/`已备册`，卡片仍隐藏；未执行 B 站副作用。 |
| I002 | `electron/main/index.ts`：`mainRendererInteractiveReady` + `startupServicesReady` 双门控、`yieldStartupEventLoop` 分段让步、`traceStartupPhase` 诊断；小咪创建/renderer/原生修补/显示保持后台顺序。 | `index.mainWindowPetStartup.test.ts` 6/6；全量 `npm test` 245 文件、4204 用例通过。 | 开发版启动诊断已记录：主窗口约 329ms 就绪，小咪 renderer/原生修补在其后；物理鼠标移动/点击过程截图待补。 | 主窗口不再等待小咪；真实安装版鼠标延迟仍需人工验收，诊断日志不等同于“鼠标不卡”。 |
| I003 | `electron/installer/installer.nsh`：完成页恢复系统样式、启用 `SC_CLOSE`，显式重新启用外层窗口并隐藏底部 Back/Cancel。 | `installer.finishPage.test.ts` 2/2；`npm run build` 已通过。 | 新安装包完成页物理点击 `×` 的截图待补。 | 关闭仅结束安装向导；NSIS 完成页标题栏行为尚缺人工点击证据，未触发安装回滚或 B 站副作用。 |

### 发布构建

- `npm test`：245 个测试文件、4204 个用例通过。
- `npm run build`：通过。
- `npm run dist:win`：通过，生成 `dist/bilimi.Setup.1.1.0.exe`。
- `git diff --check`：通过；未执行任何真实 B 站写入。
