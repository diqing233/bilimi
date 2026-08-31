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

## 逐项索引

| ID | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002、R003 | 删除成功且弹窗关闭后，保留的已保存 bilimi 收藏夹卡片及底部提示立即显示`未备册`，与截图二一致；已备册的正常删除路径保持正常，重点修正“清空远端数据后变为未绑定”的删除收尾。正常已备册删除不回归；从远端清空后投影为未绑定/未备册的规则也必须被删除流程识别并正确刷新。 | 右侧助手“收藏夹”卡片与底部未备册提醒。 | 已删除正式远端分册、规则保留且无正式 `physicalShards` 时显示`未备册`；存在任一未备册规则时显示底部`部分 Bilimi 收藏夹尚未备册。`。 | 远端删除成功回执收尾后，页面消费同一权威账号快照；不要求重启或再次进入页面。已备册和未绑定/未备册删除均完成同一即时刷新。 | 不执行真实 B 站删除、创建、绑定、同步或视频写入；只修正已确认删除结果的本地权威投影。 | 不改变删除确认语义、精确 folder ID 范围、未绑定知情同意、备册/绑定、整理收藏、DeepSeek、转写或视频同步。 | 删除收尾、`physicalShards` 投影、账号偏好快照广播、`FavoriteLedgerOverview` 实际状态输入。 | 已实施待验证 | 代码：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1233-1264`；回归：`FavoriteLedgerOverview.test.tsx` 新增“无精确 ID且远端已确认缺失后显示未备册”用例并通过。开发版只读验收截图：`.codex-artifacts/2026-09-01-main-window-after-click.png`；未执行真实 B 站删除，远端回执和安装版真实删除副作用仍待人工验收。 |
| I002 | R001、R003 | 小咪窗口在后台完成创建、加载、Windows 原生修补与鼠标恢复后才显示；启动期间主窗口和系统鼠标不发生卡顿。 | Windows 开发/预览/安装版启动阶段，小咪伴随窗口。 | 主窗口首帧和交互区域就绪后启动后台预热；小咪自身 renderer、DWM/标题栏修补和鼠标恢复均已完成时才显示。 | 小咪显示延后但显式唤醒、拖动、透明点击穿透、白条修补、控件交互语义不变；主窗口优先可操作。 | 不涉及 B 站写入、账号数据迁移或收藏夹副作用。 | 不移除小咪，不以整窗遮罩、忙碌指针、同步等待或禁用主窗口换取表面速度。 | 主窗口交互就绪信号、`floatingSealWakeController`、`BrowserWindow` 创建、页面加载、DWM/标题栏修补、鼠标恢复控制器。 | 已实施待验证 | 代码：`src/renderer/src/App.tsx:3703-3731`、`electron/main/index.mainWindowPetStartup.test.ts:22-29`；开发版只读验收：主窗口首帧后点击/滚动响应，小咪在空闲阶段出现，截图`.codex-artifacts/2026-09-01-main-window-startup.png`与`.codex-artifacts/2026-09-01-pet-after-idle.png`。自动化无法测量安装版物理鼠标延迟、缩放/最小化/关闭过程，需人工验收。 |
| I003 | R004 | 查明安装向导完成页右上角窗口控制按键不可点击的原因；只有在用户确认需要改变该向导行为后才实施界面改动。 | Windows NSIS 安装向导“正在完成 bilimi 安装向导”页面的标题栏控制区。 | 当前完成页显示可用的底部`完成(F)`，最大化与关闭呈禁用态；需区分安装向导设计与 bilimi 主窗口、小咪窗口行为。 | 本轮先给出代码与安装器模板层面的根因及可选改法，不擅自改变安装/退出路径。 | 不安装、发布、删除用户数据或修改 B 站状态。 | 不把 NSIS 向导控件问题改到 Electron `BrowserWindow`、小咪或收藏夹逻辑中。 | `electron-builder` 生成的 NSIS 模板、`package.json` NSIS 配置、`electron/installer/installer.nsh` 自定义页面。 | 待用户决定 | 只读核查：自定义 `installer.nsh` 未定义窗口样式或完成页窗口控制逻辑；需要继续对照 electron-builder 生成模板后确认是否修改。 |

## 待用户决定

- I003 仅要求解释“为什么不可点击”，尚未明确要求启用安装向导的右上角按键；在用户明确“开始”并确认目标行为前不改安装器。

## 被明确替代 / 明确不做

- 无。

## 本轮实施计划与证据（2026-09-01）

| 步骤 | 覆盖条目 | 允许修改范围 | 预期结果与回归风险 | 测试/验收 |
| --- | --- | --- | --- | --- |
| P1 | I001 | `electron/main/managedFavoriteLedgerDeletionPersistence.ts`、`electron/main/oldFavoriteWorkspaceCoordinator.ts`、`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`及对应测试 | 将“无精确 ID且目录确认缺失”作为 `unbacked` 的同一权威投影；渲染器不得以旧 `unbound` 草稿覆盖；保留已备册删除、未绑定候选确认和本地删除语义。 | 先新增未绑定默认规则删除回归并确认 RED，再 GREEN；聚焦 Vitest 与开发版只读删除收尾验收。 |
| P2 | I002 | `electron/main/index.ts`、`electron/main/floatingSealWakeController.ts`及启动测试 | 交互就绪后用可取消空闲任务启动小咪，各阶段让出事件循环；主窗口首帧和鼠标输入不被原生修补争用。 | 先新增调度时序 RED，再 GREEN；启动 Electron 做主窗口、鼠标、滚动和小咪延后显示只读验收。 |
| P3 | I003 | 不修改安装器文件 | 维持 NSIS 完成页固定尺寸行为，仅在最终报告说明右上角按钮不可用的模板原因。 | 只读核对 `package.json` 与 `installer.nsh`；不执行安装器行为改动。 |

## 本轮完成证据（2026-09-01）

- 聚焦 Vitest：`FavoriteLedgerOverview.test.tsx` 124/124、`favoriteRepositorySyncService.test.ts` 69/69、删除/启动主流程回归均通过；新增未备册收尾回归和空闲调度回归均通过。
- 全量 Vitest：244 个测试文件、4199 个用例通过。
- 构建与静态检查：`npm run build` 通过；`git diff --check` 通过。
- Electron 开发版只读验收：主窗口首帧可见后点击、滚动响应；小咪在主窗口交互就绪后的空闲任务中显示。截图：`.codex-artifacts/2026-09-01-main-window-startup.png`、`.codex-artifacts/2026-09-01-main-window-after-click.png`、`.codex-artifacts/2026-09-01-pet-after-idle.png`。
- 未验证项：未执行真实 B 站删除/创建/绑定/同步；无法以自动化替代安装版物理鼠标、窗口缩放/最小化/关闭过程的人工验收；I003 安装器完成页按钮行为保持只读未改。
