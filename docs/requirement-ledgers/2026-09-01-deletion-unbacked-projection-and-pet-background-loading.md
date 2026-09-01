# 删除后未备册投影与小咪后台加载账本

## 原文区

### R001

截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-f23967b5-80f6-45f0-a119-ec4e080cbd98.png`
  - 用户圈定右侧“收藏夹”区域：删除弹窗已消失，但各收藏夹卡片只显示勾选状态，未显示备册状态。
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-5e77ce0f-6b4e-41ee-a5a1-8903c49e5db6.png`
  - 用户圈定正常预期：每个收藏夹卡片显示红色`未备册`，底部显示`部分 Bilimi 收藏夹尚未备册。`。

原文：

```text
继续检查弹窗消失，但是备册信息没有了，正常情况是提示图二未备册
启动应用，宠物加载过程中鼠标还是会卡，可以考虑现在后台加载，完成后显示出来
```

### R002

原文：

```text
补充一下正常备册在删除会正常，现在是删除清空数据后，变成未绑定，删除未绑定不正常
```

### R003

原文：

```text
还有没考虑到的吗，两个问题都检查清楚了，可以修好吗
```

### R004

截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-f2c64b63-6477-451e-aee5-a06d23d577ca.png`
  - 用户反馈应用启动后的主窗口仍出现鼠标卡顿；截图本身未圈定额外控件。
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-826778de-f80c-461e-8b8f-29686f14cdb5.png`
  - 用户圈定安装向导完成页右上角窗口控制区域，询问其中按键为何不可点击。

原文：

```text
图一还是这样你不是检查了好久吗
鼠标仍然卡
图二右上角按键为什么不可点击
```

### R005

原文：

```text
一共是三个问题，还有之前说的删除后不能正常显示未备册，为什么正常备册删除是可以的，而清空数据后，变成未绑定，删除未绑定不正常
```

### R006

原文：

```text
右上角 三个按钮都需要，缩小功能正常呀，还有下边的上一步和取消按钮有用吗，没用可以删掉
```

用户明确确认：NSIS 安装向导完成页右上角最小化、最大化、关闭三个按钮都需要；底部`上一步(P)`和`取消(C)`若无实际作用可以移除，保留有效完成操作。

### R007

原文：

```text
还有上面其他的讨论，启动鼠标卡顿很难做吗，为什么宠物小咪会让鼠标卡主
```

用户要求继续处理前述启动阶段鼠标卡顿问题，并查明小咪与卡顿的实际关系。

### R008

原文：

```text
先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）做完提交打包
```

用户授权按项目书和本账本实施 R006、R007 所确认的安装向导与启动响应性改动，完成提交和 Windows 安装包构建；要求按钮点击不卡且既有功能不失效。

## 逐项索引

| ID | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002、R003 | 删除成功且弹窗关闭后，保留的已保存 bilimi 收藏夹卡片及底部提示立即显示`未备册`，与截图二一致；已备册的正常删除路径保持正常，重点修正“清空远端数据后变为未绑定”的删除收尾。正常已备册删除不回归；从远端清空后投影为未绑定/未备册的规则也必须被删除流程识别并正确刷新。 | 右侧助手“收藏夹”卡片与底部未备册提醒。 | 已删除正式远端分册、规则保留且无正式 `physicalShards` 时显示`未备册`；存在任一未备册规则时显示底部`部分 Bilimi 收藏夹尚未备册。`。 | 远端删除成功回执收尾后，页面消费同一权威账号快照；不要求重启或再次进入页面。已备册和未绑定/未备册删除均完成同一即时刷新。 | 不执行真实 B 站删除、创建、绑定、同步或视频写入；只修正已确认删除结果的本地权威投影。 | 不改变删除确认语义、精确 folder ID 范围、未绑定知情同意、备册/绑定、整理收藏、DeepSeek、转写或视频同步。 | 删除收尾、`physicalShards` 投影、账号偏好快照广播、`FavoriteLedgerOverview` 实际状态输入。 | 已实施待验证 | 代码：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1233-1264`；回归：`FavoriteLedgerOverview.test.tsx` 新增“无精确 ID且远端已确认缺失后显示未备册”用例并通过。开发版只读验收截图：`.codex-artifacts/2026-09-01-main-window-after-click.png`；未执行真实 B 站删除，远端回执和安装版真实删除副作用仍待人工验收。 |
| I002 | R001、R003、R007、R008 | 小咪窗口在后台完成创建、加载、Windows 原生修补与鼠标恢复后才显示；启动期间主窗口和系统鼠标不发生卡顿。 | Windows 开发/预览/安装版启动阶段，小咪伴随窗口。 | 主窗口首帧和交互区域就绪后启动后台预热；小咪自身 renderer、DWM/标题栏修补和鼠标恢复均已完成时才显示。 | 小咪显示延后但显式唤醒、拖动、透明点击穿透、白条修补、控件交互语义不变；主窗口优先可操作；调度可取消且每阶段让出事件循环；首页 guest WebView 不再用启动定时器自动挂载，只在用户明确浏览动作后挂载。 | 不涉及 B 站写入、账号数据迁移或收藏夹副作用。 | 不移除小咪，不以整窗遮罩、忙碌指针、同步等待或禁用主窗口换取表面速度。 | 主窗口交互就绪信号、`floatingSealWakeController`、`floatingSealIdleTask.ts`、`BrowserWindow` 创建、页面加载、DWM/标题栏修补、鼠标恢复控制器、首页 guest WebView 初始挂载。 | 已实施待安装版验收 | 代码：`electron/main/index.ts` 的 `scheduleAutomaticFloatingSealWake`、`electron/main/floatingSealIdleTask.ts`、`src/renderer/src/App.tsx` 的首页显式激活门控；回归：`electron/main/index.mainWindowPetStartup.test.ts` 6 项、`floatingSealWakeController.test.ts` 6 项、`App.test.tsx` 130 项通过。全量 Vitest 245 文件/4203 项通过，`npm run build` 通过。开发版只读证据沿用 `.codex-artifacts/2026-09-01-main-window-startup.png` 与 `.codex-artifacts/2026-09-01-pet-after-idle.png`；本轮未能在安装版量化物理鼠标延迟、缩放/最小化/关闭过程，需安装包验收。 |
| I003 | R004、R006、R008 | 安装向导完成页右上角最小化、最大化、关闭三个按钮可用；隐藏无效的底部`上一步(P)`与`取消(C)`，保留`完成(F)`和`运行 bilimi`行为。 | Windows NSIS 安装向导“正在完成 bilimi 安装向导”页面的标题栏控制区和底部导航区。 | 仅完成页启用三个系统按钮；其它安装页、卸载页和主窗口不变。 | 最大化可调整完成页窗口，关闭只结束安装向导；底部完成按钮继续执行原有收束和运行复选框。 | 不回滚已完成安装，不安装、删除用户数据或修改 B 站状态。 | 不把 NSIS 向导控件问题改到 Electron `BrowserWindow`、小咪或收藏夹逻辑中；不改变安装目录和卸载流程。 | `electron-builder` 生成的 NSIS 模板、`package.json` NSIS 配置、`electron/installer/installer.nsh` 自定义完成页。 | 已实施待安装验收 | 代码：`electron/installer/installer.nsh` 的 `customFinishPage`/`bilimiFinishPageShow`；回归：`electron/installer/installer.finishPage.test.ts` 2 项通过，包含样式、系统菜单启用及隐藏底部按钮断言。NSIS 安装向导完成页三个按钮、完成按钮和运行复选框仍需在本轮生成的安装包中人工验收。 |

## 待用户决定

- 无。

## 被明确替代 / 明确不做

- 无。

## 本轮实施计划与证据（2026-09-01）

| 步骤 | 覆盖条目 | 允许修改范围 | 预期结果与回归风险 | 测试/验收 |
| --- | --- | --- | --- | --- |
| P1 | I001 | `electron/main/managedFavoriteLedgerDeletionPersistence.ts`、`electron/main/oldFavoriteWorkspaceCoordinator.ts`、`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`及对应测试 | 将“无精确 ID且目录确认缺失”作为 `unbacked` 的同一权威投影；渲染器不得以旧 `unbound` 草稿覆盖；保留已备册删除、未绑定候选确认和本地删除语义。 | 先新增未绑定默认规则删除回归并确认 RED，再 GREEN；聚焦 Vitest 与开发版只读删除收尾验收。 |
| P2 | I002 | `electron/main/index.ts`、`electron/main/floatingSealWakeController.ts`及启动测试 | 交互就绪后用可取消空闲任务启动小咪，各阶段让出事件循环；主窗口首帧和鼠标输入不被原生修补争用。 | 先新增调度时序 RED，再 GREEN；启动 Electron 做主窗口、鼠标、滚动和小咪延后显示只读验收。 |
| P3 | I003 | `electron/installer/installer.nsh`及必要的 NSIS 完成页宏/测试 | 仅完成页启用最小化、最大化、关闭，隐藏无效的`上一步(P)`和`取消(C)`，保留`完成(F)`和运行 bilimi；安装与卸载流程不变。 | NSIS 编译检查；安装包完成页人工验证三个标题栏按钮、完成按钮和运行复选框。 |

## 本轮完成证据（2026-09-01）

- 聚焦 Vitest：`FavoriteLedgerOverview.test.tsx` 124/124、`favoriteRepositorySyncService.test.ts` 69/69、`App.test.tsx` 130/130、`floatingSealWakeController.test.ts` 6/6、`index.mainWindowPetStartup.test.ts` 6/6、`installer.finishPage.test.ts` 2/2；删除/启动主流程回归均通过。
- 全量 Vitest：245 个测试文件、4203 个用例通过。
- 构建与静态检查：`npm run build` 通过；`git diff --check` 通过。
- Electron 开发版只读验收：主窗口首帧可见后点击、滚动响应；小咪在主窗口交互就绪后的空闲任务中显示。截图：`.codex-artifacts/2026-09-01-main-window-startup.png`、`.codex-artifacts/2026-09-01-main-window-after-click.png`、`.codex-artifacts/2026-09-01-pet-after-idle.png`。
- 未验证项：未执行真实 B 站删除/创建/绑定/同步；无法以自动化替代安装版物理鼠标、窗口缩放/最小化/关闭过程的人工验收；I003 需在本轮新生成安装包的完成页验证标题栏三个按钮和底部按钮隐藏效果。

## 本轮安装包证据（2026-09-01）

- `npm run dist:win` 从最终提交 `3c48ed86` 完成：`dist/bilimi.Setup.1.1.0.exe`，392,691,612 字节；SHA-256 `A6ACF6677394C7E5E34182061D745E64A7D191319383E224353FF1BB20CBE7C7`。
- NSIS 安装器编译阶段已执行 `customFinishPage`，未出现脚本或链接错误；安装包同时生成 `dist/bilimi.Setup.1.1.0.exe.blockmap`（406,419 字节）。
- 安装版启动鼠标时序、小咪出现前后的移动/点击/滚动/缩放/最小化/关闭，以及完成页三个标题栏按钮和底部导航隐藏，仍需在本机安装后人工验收；本轮未点击任何 B 站写入或破坏性操作。
