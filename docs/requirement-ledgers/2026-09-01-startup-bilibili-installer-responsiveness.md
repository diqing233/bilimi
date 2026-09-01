# 启动 B 站优先、鼠标响应与安装完成页关闭账本

## 原文需求

### R001

1. I002：鼠标还是卡，不管哪里有问题，检查整个启动过程，别让它卡，优先刷新b站页面
2. I003：图一点x没反应

### R002

讨论模式

### R003

你有多少把握改好

### R004

鼠标卡顿怎么才有99以上把握

### R005

以上讨论先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）做完提交打包

## 逐项索引

| 编号 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I002 | R001、R004、R005 | 启动全过程中主窗口和 B 站页面优先保持可操作；鼠标移动、点击、滚动、最小化、恢复、关闭不被小咪及其原生修补阻塞。小咪为可取消、分段、后台任务，任何阶段超出响应预算都让路；B 站首次加载失败不能阻塞主窗口。 | `electron/main/index.ts`、`src/renderer/src/App.tsx`、`electron/main/floatingSealIdleTask.ts`、小咪调度/原生修补模块；开发版和安装版。 | 主窗口 shell 首帧和 renderer 交互先就绪；随后独立发起 B 站首页首次加载/刷新；B 站加载收束或失败兜底后才释放小咪创建资格。小咪显示前不启动鼠标恢复轮询。 | 启动阶段不显示忙碌光标或整窗遮罩；保留小咪显式唤醒、透明、点击穿透、拖动和显示语义；所有阶段可取消并在关闭时收束。 | 不写本地业务数据以外的远端状态；不执行 B 站创建、绑定、删除、备册、同步或视频写入。 | 不改网页 URL、Cookie、代理、标签语义、收藏夹/整理流程、DeepSeek、转写、删除确认和视频同步；不牺牲已有小咪交互。 | 主窗口交互 gate、首页 WebView 挂载/加载事件、小咪 idle 调度、renderer/native polish、鼠标恢复控制器。 | 已实施待验证 | 自动化已通过；开发版/预览版截图已保存；安装版鼠标逐项验收待打包。 |
| I003 | R001、R005 | Windows NSIS 安装向导完成页右上角最小化、最大化、关闭三个系统按钮可用；关闭 `×` 只结束安装向导，不回滚已完成安装；底部 Back/Cancel 继续隐藏，Finish 与运行复选框保持原行为。 | `electron/installer/installer.nsh`、NSIS 完成页、生成的 Windows 安装包。 | 仅完成页启用系统按钮和关闭通道；其他安装页、卸载页、Electron 主窗口不变。 | 完成页显示并响应三个标题栏按钮；点击 `×` 走 NSIS 正常 abort/quit 路径。 | 不回滚安装、不删除用户数据、不触发 B 站副作用。 | 不修改 Electron 主窗口、小咪、收藏夹或同步逻辑。 | NSIS MUI2 Finish page、真实完成页子控件句柄、`SC_MINIMIZE`/`SC_MAXIMIZE`/`SC_CLOSE` 系统菜单。 | 已实施待验证 | 源码回归已通过；旧包实测发现最大化菜单仍置灰，已补显式系统菜单启用；新包需重复安装并实际点击三个标题栏按钮后才能转为已验收。 |

## 讨论结论与实施计划

### 已确认

1. I002（R001、R004、R005）：主窗口与 B 站页面优先，小咪后台分段启动，启动全过程鼠标保持可响应；需以真实开发版和安装版验收，不以日志或单元测试替代。
2. I003（R001、R005）：NSIS 完成页三个系统按钮可用，`×` 关闭安装向导，底部 Back/Cancel 隐藏，Finish/运行复选框不变。

### 待用户决定

无。

### 被明确替代 / 明确不做

- 本轮不重新实现 I001（整理收藏卡片/详情备册状态）；该项沿用 `2026-09-01-detail-status-startup-installer-controls.md` 的已确认设计和已有代码，避免扩大范围。
- 不执行任何真实 B 站创建、绑定、删除、备册、同步或视频写入。

### 实施步骤

1. 先更新 `docs/项目功能项目书.md` 第 1.1 节及首页 WebView/安装向导相关条款，明确“主窗口交互 → B 站首次加载阶段 → 小咪后台分段启动”的顺序、可取消 gate、失败兜底和响应预算；保留现有小咪与网页语义。
2. 为 I002 增加失败回归测试：B 站加载 settled/failed 后才允许小咪 wake；主窗口交互不等待网络；空闲任务可取消；启动阶段不启动鼠标轮询。
3. 为 I003 增加失败回归测试：完成页 SHOW 中重新启用 `$mui.Button.Cancel`、系统菜单 `SC_CLOSE`，并继续隐藏 Back/Cancel。
4. 以最小改动实现 I002/I003，运行相关 Vitest 和全量测试，检查 `git diff --check`。
5. 启动开发版进行真实鼠标移动、点击、滚动、最小化、恢复、关闭验收，并保存 `.codex-artifacts/` 证据；构建安装包后重复关键路径和完成页 `×` 点击验收。
6. 按 I002/I003 逐项填写代码位置、自动化测试、真实界面验收和未验证条件；确认无无关文件后创建一个本轮提交，再执行 `npm run dist:win`。

## 实施验收记录

| 编号 | 代码位置 | 自动化测试 | 界面/安装验收 | 结果与未验证条件 |
| --- | --- | --- | --- | --- |
| I002 | `src/renderer/src/App.tsx:99,835-839,3682-3748,3926`；`src/renderer/src/features/browser/BiliWebview.tsx:20,133-171,307-323`；`electron/preload/index.ts:86-90`；`electron/main/index.ts:549-568,1136-1138,1379-1393`；`electron/main/floatingSealIdleTask.ts:4-16` | `electron/main/index.mainWindowPetStartup.test.ts`（11 项）；`src/renderer/src/features/browser/BiliWebview.test.tsx`（26 项）；全量 `npm test`：245 文件 / 4210 用例通过；`npm run build` 通过 | 开发版首次启动截图：[startup-dev-final.png](../../.codex-artifacts/startup-dev-final.png)；预览版截图：[startup-preview-final.png](../../.codex-artifacts/startup-preview-final.png)。两次均验证主窗口可见、B 站首页已加载、小咪在后续任务出现；诊断重启时 `localhost` 在当前环境仅监听 `::1`，出现空白窗口，已记录为本机 dev host 复现条件，未作为代码成功证据。尚缺安装版过程中的逐项鼠标移动/点击/滚动/最小化/恢复/关闭人工记录。 | 已实施待安装版验收；首页 settled/失败事件和 8 秒网络兜底均幂等、可清理；小咪自动唤醒仍受主窗口交互、首页收束和可取消空闲任务 gate 保护；不触发任何 B 站写入。 |
| I003 | `electron/installer/installer.nsh:49-73`（完成页窗口样式、`SC_MINIMIZE`/`SC_MAXIMIZE`/`SC_CLOSE` 菜单启用、真实 Cancel 句柄）；`electron/installer/installer.finishPage.test.ts:15-20` | `electron/installer/installer.finishPage.test.ts`（2 项）；全量 `npm test`：245 文件 / 4210 用例通过；`npm run build` 通过 | 安装包完成页已实测：标题栏最小化、最大化、关闭均显示；完成页保留`完成(F)`和`运行 bilimi(R)`，底部 Back/Cancel 隐藏。完成页截图将在重新打包后保存到 `.codex-artifacts/installer-finish-page.png`；安装时曾因已有 bilimi 进程出现运行提示，取消该提示后正常到达完成页。 | 发现并修复首个安装包中最大化仍置灰的根因：仅加入窗口样式不足，NSIS 系统菜单项默认仍为禁用；现对 `SC_MINIMIZE`、`SC_MAXIMIZE`、`SC_CLOSE` 显式启用。已实施待新包重复点击三项按钮并保存截图；不回滚安装、不触发 B 站副作用。 |
