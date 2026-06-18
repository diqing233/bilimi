# Bilimi 系统级悬浮菜单设计

- 日期：2026-05-16
- 状态：历史方案，已被 `2026-05-16-system-floating-assistant-workspace-design.md` 替代
- 范围：系统级悬浮印章、系统级展开菜单、菜单动作桥接主窗口

## 1. 背景

Bilimi 当前已有独立的系统级悬浮印章窗口、主应用窗口内的助手面板，以及主进程到渲染进程的打开信号。新的目标是让悬浮入口更像一个桌面助手，而不是主窗口内的普通按钮：

1. 悬浮印章能自然跟随鼠标拖动。
2. 点击印章后，其他按钮以系统级悬浮菜单形式出现在印章附近。
3. 菜单动作仍复用主窗口里的当前 active webview 自动化能力。

用户已选择方案 B：系统级透明小奏折菜单。它不是主窗口内面板，也不是围绕印章的扇形按钮，而是贴近印章展开的纵向紧凑菜单。

## 2. 体验目标

系统悬浮印章始终是第一入口。用户可以拖动它到屏幕任意合适位置，拖动过程顺滑，释放后停在当前位置。点击印章时，印章旁边出现一个透明无边框的小菜单窗口，菜单以小奏折或签条方式排列 `赞 / 藏 / 赐 / 评` 四个动作。

菜单默认贴着印章上方或侧边出现。若印章靠近屏幕边缘，菜单自动翻转到可见区域内。菜单不应挡住印章本身，也不应跑出当前显示器工作区。

动作执行时，菜单负责收集用户意图，主窗口负责承载 Bilibili 页面和执行自动化。需要主窗口上下文时，主进程先确保主窗口存在、可见、聚焦，再把动作请求发送到主窗口的渲染层。

## 3. 备选方案

### 3.1 推荐实现：独立系统级菜单窗口

主进程保留现有 `floatingSealWindow`，新增 `floatingMenuWindow`。点击印章后，主进程根据印章 bounds 和当前显示器 workArea 计算菜单窗口 bounds，并加载同一个 React 入口的 `window=floating-menu` 路由。

优点：

- 真正系统级，主窗口未聚焦时也能展示。
- 菜单生命周期、位置、样式与主应用解耦。
- 可以用纯函数测试菜单几何，不依赖 DOM。

代价：

- 主进程需要管理两个浮窗的同步关闭、拖动和边缘翻转。
- 动作需要经过 IPC 桥接到主窗口，不能在菜单窗口直接操作 webview。

### 3.2 保守实现：主窗口内模拟菜单

点击系统印章后只打开主窗口内的助手面板，并用印章投影位置定位。

优点是改动少，缺点是不满足系统级悬浮菜单的体验目标，因此不采用。

### 3.3 扇形系统菜单

按钮以半环或扇形围绕印章展开。

视觉更活跃，但边缘适配和点击目标更复杂，也不如纵向签条适合中文动作文本。当前不采用，后续可作为动效升级。

## 4. 架构设计

### 4.1 Electron 主进程

新增职责：

- 创建、显示、隐藏和销毁 `floatingMenuWindow`。
- 监听悬浮印章点击，切换菜单显示状态。
- 在印章拖动开始时关闭菜单，或在拖动结束后按新位置重新计算菜单位置。
- 根据屏幕 workArea 计算菜单窗口位置。
- 接收菜单动作请求，将动作转发给主窗口渲染层。

主进程保留现有主窗口职责：

- 管理 Bilibili webview 所在的主应用窗口。
- 接收 `assistant:open`、`browser:open-in-tab` 等现有信号。
- 持久化偏好、视频笔记等本地数据。

### 4.2 React 渲染层

同一个 `src/renderer/src/main.tsx` 根据 URL query 选择渲染：

- 默认：主应用 `App`。
- `window=floating-seal`：系统悬浮印章 `FloatingSealApp`。
- `window=floating-menu`：新增系统菜单 `FloatingMenuApp`。

`FloatingMenuApp` 只负责菜单 UI 和用户点击，不直接读取 webview，不执行业务自动化。它通过 preload 暴露的 `runFloatingMenuAction(action)` 把动作传给主进程。

### 4.3 Preload API

在现有 `window.bilimiDesktop` 上补充：

- `toggleFloatingMenu()`：印章点击时切换系统菜单。
- `runFloatingMenuAction(action)`：菜单按钮点击时请求主窗口执行动作。
- `closeFloatingMenu()`：点击关闭、失焦或动作完成后关闭菜单。

保留已有拖动 API：

- `startFloatingSealDrag(screenX, screenY)`
- `moveFloatingSealTo(screenX, screenY)`
- `finishFloatingSealDrag()`

## 5. 菜单布局规则

新增纯函数 `createFloatingMenuBounds`，输入：

- 当前印章 bounds。
- 菜单 size。
- 当前显示器 workArea。
- 间距 gap。

输出菜单窗口 bounds。

布局优先级：

1. 优先在印章上方展开，底部与印章上缘保持 gap。
2. 上方空间不足时，放到印章下方。
3. 垂直方向仍不足时，放到印章左侧或右侧。
4. 最终结果必须 clamp 到当前显示器 workArea 内。

菜单窗口尺寸先用固定值，例如 `156 x 214`，后续可根据按钮数量和字体做自适应，但必须维持可测试的外部尺寸契约。

## 6. 动作数据流

1. 用户点击系统悬浮印章。
2. `FloatingSealApp` 调用 `toggleFloatingMenu()`。
3. 主进程创建或隐藏 `floatingMenuWindow`。
4. 用户点击菜单动作。
5. `FloatingMenuApp` 调用 `runFloatingMenuAction(action)`。
6. 主进程确保主窗口存在、可见、聚焦。
7. 主进程向主窗口发送 `assistant:run-action`，payload 包含 action。
8. 主窗口渲染层复用现有 active webview、推荐分类、偏好记录和自动化执行能力。
9. 动作请求发出后，系统菜单关闭；主窗口内可继续显示二次确认或执行反馈。

## 7. 错误处理

- 主窗口不存在：创建主窗口后等待加载完成，再发送动作。
- 主窗口加载中：复用现有 ready signal 模式，延迟发送动作。
- 菜单窗口已销毁：忽略关闭请求，不抛出错误。
- 动作需要二次确认：关闭系统菜单，主窗口打开对应确认面板，例如投币数量或评论候选。
- 无 active webview：主窗口显示可恢复错误，不在系统菜单里吞掉失败。
- 屏幕边缘计算异常：回退到当前显示器 workArea 右下附近的安全位置。

## 8. 测试策略

单元测试：

- `createFloatingMenuBounds` 覆盖上方展开、下方翻转、左右翻转、workArea clamp。
- 悬浮印章点击调用 `toggleFloatingMenu`，拖动不触发打开。
- `FloatingMenuApp` 点击 `赞 / 藏 / 赐 / 评` 分别调用 `runFloatingMenuAction`。
- 主进程动作桥接函数在主窗口加载中时延迟发送。

集成测试：

- `main.tsx` 根据 `window=floating-menu` 渲染菜单而不是主应用。
- 主窗口收到 `assistant:run-action` 后复用现有 `AssistantOverlay` 动作路径。

人工验证：

- Windows 桌面上拖动印章，确认移动自然。
- 在屏幕四角点击印章，菜单不出屏。
- 主窗口最小化时点击菜单动作，主窗口能恢复并执行或进入确认。
- Bilibili active tab 中的 `赞 / 藏 / 赐 / 评` 仍走现有自动化路径。

## 9. 后续优化建议

1. 抽出 `FloatingAssistantController` 管理印章窗口、菜单窗口、主窗口动作桥接，减少 `electron/main/index.ts` 膨胀。
2. 将悬浮交互建成显式状态机：idle、dragging、menu-open、action-dispatching、confirming。
3. 统一中文文案和文件编码，修复当前部分源码与测试输出里的乱码。
4. 给系统浮窗加可访问性标签、键盘关闭、Esc 关闭和失焦关闭。
5. 增加多显示器测试夹具，覆盖 DPI 缩放和负坐标显示器。
6. 把 Bilibili 自动化动作继续拆成 DOM、API、视觉兜底三层，并让每层失败原因可观测。

## 10. 当前不做

- 不实现扇形菜单动画。
- 不重写现有 Bilibili 自动化脚本。
- 不改变专用收藏夹和偏好记录的数据结构。
- 不处理安装包、开机自启、托盘图标等桌面分发能力。
