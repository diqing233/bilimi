# 整理期间状态隐藏、启动响应与安装向导控制账本

## 原文区

### R001

截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-ace8c160-5770-4795-b48a-3afd8cd62cd7.png`
  - 用户圈定整理收藏期间右侧掌库收藏夹卡片中的红色`未备册`提示。

原文：

```text
整理收藏期间未备册不应该提示你忘了吗，项目书看哪去了，之前的设计复原你不会吗
```

### R002

原文：

```text
所有讨论的你都规划清楚了吗
```

### R003

原文：

```text
先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）做完提交打包
```

## 逐项索引

| ID | 原文编号/关联 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001；关联历史账本 `2026-08-14-deleted-ledger-binding-state-recovery.md` I013 | 整理收藏草稿打开且可编辑期间，不显示远端备册/绑定生命周期状态；仅保留本地草稿状态；整理结束、关闭或隐藏后恢复真实状态。 | `FavoriteLedgerOverview` 收藏夹卡片、详情区域和整理期间底部状态提示。 | `organizationActive` 或整理指南打开时隐藏`已备册`、`未备册`、`未绑定`、`待绑定`及“部分 Bilimi 收藏夹尚未备册”；允许显示`未保存`等本地状态。非整理状态恢复原有真实投影。 | 只改变显示门控，不改变规则 ID、上/下方勾选联动、分类、归档预览或同步预检。 | 不创建、绑定、删除、备册或写入 B 站；不改本地规则和分类持久化。 | 不改变删除确认、备册/绑定资格、推荐取消删除、DeepSeek、转写和视频同步。 | `FavoriteLedgerOverview` 的工作区快照、整理生命周期状态、`combinedStatusLabel`。 | 已实施待验证 | `FavoriteLedgerOverview.tsx:597-607,1550-1562`；`FavoriteLedgerOverview.test.tsx` 整理中、指南打开时隐藏/结束恢复用例通过（125/125）；相关面板回归 295/295 通过；Electron 整理中/结束状态截图待验收。 |
| I002 | R002、R003；关联历史账本 `2026-09-01-deletion-unbacked-projection-and-pet-background-loading.md` I002 | 主页面先完成首帧和交互，再以可取消空闲任务后台加载小咪；首页 WebView 延后激活但不能空白；启动及小咪加载期间鼠标和窗口操作保持响应。 | Electron 开发版、预览版、安装版启动阶段。 | 主窗口交互就绪后才调度小咪；小咪完成 renderer/DWM/鼠标控制器初始化后才显示；首页在后续让出事件循环的任务挂载。 | 不使用固定延时、同步等待、整窗遮罩或忙碌光标；小咪显示和既有拖动/穿透行为保持。 | 不涉及 B 站写入、账号数据或收藏夹副作用。 | 不删除小咪，不改网页 URL、Cookie、代理、登录和既有标签语义。 | `App.tsx` 首页挂载门控、`floatingSealIdleTask`、`floatingSealWakeController`、主进程启动时序。 | 已实施待验证 | `App.tsx` 交互空闲任务恢复首页激活；`index.mainWindowPetStartup.test.ts` 6/6、`App.test.tsx` 130/130、启动相关回归通过；Electron 开发版和安装版鼠标移动/点击/滚动/缩放/最小化/关闭证据待补。 |
| I003 | R002、R003；关联历史账本 `2026-09-01-deletion-unbacked-projection-and-pet-background-loading.md` I003 | NSIS 完成页右上角最小化、最大化、关闭三个按钮可用；隐藏无效的`上一步(P)`和`取消(C)`；保留`完成(F)`与运行复选框。 | Windows NSIS 安装向导完成页。 | 仅完成页启用三个系统按钮；其它安装页、卸载页和主窗口不变。 | `×` 关闭安装向导，最大化可调整窗口；完成按钮和运行 bilimi 行为保持。 | 不回滚安装、不删除用户数据、不触发 B 站副作用。 | 不把 NSIS 问题改到 Electron 主窗口、小咪或收藏夹逻辑。 | `electron/installer/installer.nsh`、NSIS Finish 宏、安装包构建。 | 已实施待验证 | `installer.nsh` 定义 `MUI_FINISHPAGE_CANCEL_ENABLED` 并保留样式/隐藏按钮；`installer.finishPage.test.ts` 2/2、NSIS 构建待安装页人工验收。 |

## 待用户决定

- 无。

## 被明确替代 / 明确不做

- 无。

## 实施计划与证据

| 步骤 | 覆盖条目 | 允许修改范围 | 预期结果与回归风险 | 测试/验收 |
| --- | --- | --- | --- | --- |
| P1 | I001 | 本项目书、当前账本、`FavoriteLedgerOverview.tsx`及对应测试 | 恢复整理期间隐藏远端备册状态的既有设计，不触碰分类和同步数据；风险是非整理状态误隐藏。 | 先增加整理期间显示回归，再运行聚焦 Vitest；Electron 只读检查整理中/结束两种状态。 |
| P2 | I002 | `App.tsx`、`electron/main/index.ts`、小咪调度模块及启动测试 | 修复首页空白并保持后台小咪加载不阻塞输入；风险是首帧/显式唤醒时序回归。 | 启动时序测试、构建、Electron 开发版和安装版响应性验收。 |
| P3 | I003 | `electron/installer/installer.nsh`及 Finish 页测试 | 真正启用完成页关闭通道，保留三个标题栏按钮并隐藏无效底部按钮；风险是影响其它 NSIS 页面。 | NSIS 编译及安装包完成页人工验收。 |

## 完成记录

已完成代码与测试，待安装版和 Electron 真实交互验收。

- 聚焦回归：`FavoriteLedgerOverview.test.tsx` 125/125（含整理指南打开时隐藏未备册提示）、`ControlledFavoriteLedgerPanel.test.tsx` 170/170、`App.test.tsx` 130/130、`index.mainWindowPetStartup.test.ts` 6/6、`installer.finishPage.test.ts` 2/2。
- 全量 `npm test`：245 个测试文件、4204 个用例全部通过（本次 fresh run，退出码 0）。
- `npm run build`：通过。
- `git diff --check`：通过。
- 未执行真实 B 站创建、绑定、删除、备册、同步或视频写入。
- Electron 开发版首页首帧截图：`.codex-artifacts/2026-09-01-startup-main-window.jpg`；已确认首页非空白。整理期间/结束状态、启动鼠标过程及安装版 NSIS 完成页仍需本机人工验收并保存 `.codex-artifacts/` 截图。
- 安装检查：`dist/bilimi.Setup.1.1.0.exe` 静默安装到 `.codex-artifacts/install-check-20260901-1707` 返回退出码 0；`bilimi.exe`、`yt-dlp.exe`、`ffmpeg.exe`、`ffprobe.exe`、`whisper-cli.exe` 和 SenseVoice 资源均存在；隔离用户数据启动 8 秒后主进程仍存活且取得窗口句柄，随后已结束检查进程。
- 仍未验证安装版物理鼠标延迟、整理真实操作和 NSIS 完成页三个按钮；这些条件不能以自动化测试替代，安装包行为证据仅覆盖安装完整性与可启动性。
