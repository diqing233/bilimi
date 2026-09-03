# 2026-09-03 小咪启动默认关闭需求账本

## 原文区

### R001

> 你只是把卡顿滞后了，还是存在的，而且我打开视频还会提示风控，等卡顿结束才正常能打开，这不符合预期，你把小咪默认关闭了，重启应用我再测一下

### R002

> 宠物小咪设为默认关闭再重启

### R003

> 不用你点击关闭宠物后重新起动会默认开启吗

### R004

> 可以增加一个这个按钮

### R005

> 开始

### R006

> 可以，唤醒后就正常自动开启

### R007

> 网页全屏进出时，默认关闭的小咪绝不能被全屏退出唤醒

### R008

> 讨论你怎么越做越复杂了，只是做一个不自动启动宠物的功能而已，难道单独做一个按键会方便点吗

### R009

> 网页全屏进出时，默认关闭的小咪绝不能被全屏退出唤醒

### R010

> 继续

### R011

> 开始

## 逐项索引表

| 编号 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002、R005 | 小咪在新安装/缺失偏好时默认不随应用启动自动显示，以便隔离其窗口与原生初始化对启动体验和视频打开的影响 | 主进程自动小咪唤醒 gate、主进程偏好默认值、全屏临时收起状态 | 只有“启动时自动显示小咪”显式开启时才在首页真实收束后安排自动小咪；默认、缺失或明确关闭时不创建小咪窗口，进入/退出网页全屏也不得绕过这一条件 | 开关仅在随后启动时控制自动唤醒；本次运行不因切换开关立即创建小咪；只有此前实际可见且已由本次全屏临时隐藏的小咪才可恢复 | 新增本地、设备级偏好；不迁移/修改 B 站 URL、Cookie、登录、风控状态、收藏、转写、DeepSeek 或任何远端写入 | 不通过禁止用户手动唤醒、删除小咪功能或改动 B 站网络/页面逻辑来规避卡顿 | `src/shared/types.ts`、`electron/main/store.ts`、`electron/main/index.ts` 的启动快照 gate 与主进程全屏标记 | 已实施待实机复核 | 自动：`store.test.ts`、`assistantState.test.ts`、`index.mainWindowPetStartup.test.ts`；2026-09-04 定向 380 项、全量 4293 项和 `npm run build` 均通过。隔离日志 `.codex-artifacts/pet-default-off-fullscreen-20260904.log` 在交互就绪和首页超时收束前无小咪阶段。完整 B 站视频全屏待用户环境复核。 |
| I002 | R003、R004、R005、R006 | 在宠物设置增加一个可持久化按钮，控制“启动时自动显示小咪”；关闭宠物会持久化抑制下次自动启动，唤醒宠物会恢复后续自动启动 | 悬浮助手的“宠物设置”区域、主进程本地偏好、网页全屏临时收起 IPC | 默认未勾选；用户勾选或显式唤醒后下一次启动允许自动小咪；用户取消或关闭宠物后下一次启动不自动创建；全屏设置只处理进入全屏前实际可见的小咪 | 关闭宠物保持当前运行立即关闭，并写入自动启动 `false`；唤醒宠物保持显式打开，并写入自动启动 `true`；设置开关仍可直接覆盖该偏好；全屏临时收起和恢复均不持久化，恢复命令只能对应同一轮成功临时隐藏 | 仅本地偏好读写；不影响已有宠物样式、全屏收起、快捷操作、窗口点击穿透与拖动；不产生 B 站远端副作用 | 不改变主窗口、B 站页面、登录/风控、视频与其它业务；不隐藏或移除显式唤醒按钮 | `FloatingAssistantApp.tsx`、`App.tsx`、`electron/preload/index.ts`、`global.d.ts`、`electron/main/index.ts` | 已实施待实机复核 | 自动：`FloatingAssistantApp.renderIsolation.test.tsx`、`App.test.tsx`、`index.mainWindowPetStartup.test.ts` 覆盖设置持久化、关闭/唤醒语义、不可见小咪不恢复、已隐藏小咪恢复和退出全屏先于 close IPC 返回的竞态；2026-09-04 定向、全量和构建通过。完整 B 站视频全屏待用户环境复核。 |
| I003 | R001、R005 | 为重新测试启动/视频打开而消除自动小咪路径的干扰，但不声称已经解决 B 站风控或全部卡顿根因 | 隔离 Electron 开发版与启动诊断 | 默认关闭时自动小咪的 wake/create/renderer/native polish 阶段均不出现；主窗口和首页 WebView 仍可正常加载；全屏往返不得重新引入小咪创建 | 用户自行观察视频打开与风控提示；诊断仅记录阶段时间，不记录账号/页面内容 | 使用隔离 profile，不写入 B 站或正常 profile | 不把网络/SSL/B 站风控当作已由本开关修复的结果；不删除旧启动性能证据 | `BILIMI_STARTUP_DIAGNOSTICS`、自动 wake gate、全屏临时隐藏状态、隔离 profile | 已实施待用户验收 | 2026-09-04 隔离 profile 中主窗口首帧 +2176ms、交互就绪 +2176ms、首页超时收束 +10226ms，期间没有 `pet-wake`、`pet-window`、`pet-renderer` 或 `pet-native`；证据见 `.codex-artifacts/pet-default-off-fullscreen-20260904.log`。未穿过 Windows 网络权限页，故不主张 B 站视频、风控、鼠标连续移动、滚动、缩放、最小化/恢复或真实全屏已验收。 |
| I004 | R007、R008、R009、R010、R011 | 默认关闭的小咪在网页全屏进入/退出过程中都不得被退出事件唤醒；采用一个“本轮实际已临时隐藏”的主进程布尔标记，而不是全屏会话状态机 | 主进程全屏临时标记、既有网页全屏入口 | `autoShowPetOnStartup=false`、缺失偏好、用户已关闭或小咪尚未创建时，全屏退出不创建、不唤醒、不显示；已有可见小咪仍按原设置临时隐藏并恢复 | 进入全屏取消尚未开始的自动启动；仅隐藏成功才置标记；退出只在标记为 true 时恢复并消费标记；临时状态不改写启动偏好 | 仅本地内存状态，不写 B 站、不改账号和启动偏好 | 不增加第二个用户设置；不使用 sessionId、全屏生命周期文件或额外全屏 IPC；不重写视频、B 站或标签业务 | `autoShowPetOnStartup` 启动 gate、浮动窗口可见性、既有网页全屏事件 | 已实施待实机复核 | `electron/main/index.ts` 仅保留 `petHiddenForVideoFullscreen`；`App.tsx` 复用 close/wake 的窄化可选参数，删除 session ID、专用 IPC 和生命周期文件。RED 后 GREEN：`App.test.tsx` 与 `index.mainWindowPetStartup.test.ts` 覆盖默认关闭、不可见不恢复、可见已隐藏才恢复和异步 close 竞态；2026-09-04 定向 380 项、全量 4293 项及构建均通过。真实 B 站全屏待用户环境复核。 |

## 已确认条目（按原文顺序）

1. I001（R001、R002、R005）：自动小咪启动默认关闭。
2. I002（R003、R004、R005、R006）：提供可持久化的设置开关，关闭持久抑制下次自动启动，唤醒恢复后续自动启动。
3. I003（R001、R005）：用隔离开发版验证自动小咪已被排除，但不虚称解决网络或风控问题。
4. I004（R007、R008、R009、R010、R011）：网页全屏进出不得让默认关闭或尚未创建的小咪在退出时被唤醒；以单个主进程临时标记实现，不保留全屏会话状态机。

## 待用户决定

无。

## 被明确替代

无。

## 明确不做

无。旧启动性能改造仍保留；本轮不变更 B 站连接、Cookie、登录、风控、视频、收藏、转写或 DeepSeek 行为。

## 实施记录

2026-09-03 审查发现：现有全屏 renderer 流程仅依据“网页全屏时隐藏小咪”设置置位恢复标记，未确认小咪是否存在；退出全屏会无条件调用唤醒 IPC，从而能在 I001 默认关闭时创建小咪。该行为与项目书和 I001/I002 冲突，须先用回归测试复现，再由主进程保存一次性的“实际临时隐藏成功”状态，恢复仅消费该状态。

2026-09-04 范围收敛：用户明确拒绝为默认关闭增加会话 ID、额外 IPC 或复杂生命周期状态机。I004 只保留“启动偏好 + 主进程单个 `petHiddenForVideoFullscreen` 标记”的最小实现：主进程仅在可见窗口已实际临时隐藏后允许退出全屏恢复；默认关闭或尚未创建时，renderer 不应请求恢复，主进程也必须以标记拒绝任何恢复。

2026-09-03 实施回填：

- I001：`AssistantPreferences`、主进程 store 与启动快照 gate 已落地；全屏恢复的判定改由主进程 `floatingSealWindow.isVisible()` 和一次性 `petHiddenForVideoFullscreen` 标记负责，renderer 不再能凭全屏事件创建默认关闭的小咪。
- I002：设置页的“启动时自动显示小咪”复选框、关闭/唤醒的持久化语义与受限的全屏 hide/restore IPC 已落地。退出全屏只有主进程确认本轮隐藏过可见窗口时才恢复，且恢复不写启动偏好；异步 hide IPC 迟到时也会在已退出全屏后补做恢复。
- I003：完整自动化验证为 `npm test`（246 files / 4292 tests）和 `npm run build`，均退出码 0。隔离开发版仅验证了默认关闭的启动路径，限制见 I003；B 站网络权限和用户真实视频页未由本轮自动化跨越。

2026-09-04 最小全屏实现与验证回填：

- I001：`autoShowPetOnStartup` 缺失/新安装保持 `false`，启动快照 gate 继续只在显式 `true` 时安排自动唤醒；隔离开发版到首页超时收束前未出现任何小咪阶段，见 `.codex-artifacts/pet-default-off-fullscreen-20260904.log`。
- I002：设置复选框和显式关闭/唤醒语义保持不变；普通关闭持久写 `false`，显式唤醒持久写 `true`，临时全屏收起/恢复不写偏好。
- I003：`npm run build` 退出码 0；`npm test` 退出码 0（246 files / 4293 tests）。隔离 profile 没有穿过 Windows 网络权限页，不包含账号、视频、风控或真实鼠标手感结论。
- I004：删除 `videoFullscreenPetLifecycle`、session ID 和三条专用全屏 IPC。主进程只用 `petHiddenForVideoFullscreen` 记录已实际隐藏的可见小咪，未显示的小咪仅取消待创建；renderer 在 close 返回 `true` 后才允许 restore。定向 RED/ GREEN、8 文件 380 项回归、全量和构建均通过；真实网页全屏仍待用户验收。

2026-09-04 最终提交前核验：

- I001：代码位置为 `src/shared/types.ts`、`electron/main/store.ts`、`electron/main/index.ts` 启动快照 gate；自动化证据为 `electron/main/store.test.ts`、`src/renderer/src/features/state/assistantState.test.ts`、`electron/main/index.mainWindowPetStartup.test.ts`，最终 `npm test` 为 246 个文件/4293 项通过，`npm run build` 退出码 0。隔离启动日志 `.codex-artifacts/pet-default-off-fullscreen-20260904.log` 显示主窗口交互就绪前后到首页超时收束期间无 `pet-wake`、`pet-window`、`pet-renderer`、`pet-native`；真实连续鼠标和 B 站视频仍待用户验收。
- I002：代码位置为 `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`、`src/renderer/src/App.tsx`、`electron/preload/index.ts`、`src/renderer/src/global.d.ts`、`electron/main/index.ts`；设置复选框、普通关闭写入 `false`、显式唤醒写入 `true` 的自动化证据由 `FloatingAssistantApp.renderIsolation.test.tsx`、`App.test.tsx`、`index.mainWindowPetStartup.test.ts` 覆盖。隔离启动未进入真实 B 站页面，故风控、视频和鼠标手感仍不能由本轮自动化确认。
- I003：隔离 Electron 仅完成默认关闭启动路径，日志显示 `main-window:first-frame +2176ms`、`main-window:interactive-ready +2176ms`、`home-webview:load-timeout +10226ms`，随后未出现小咪阶段；该 profile 停在 Windows 网络权限页，未验证账号、视频、风控、滚动、缩放、最小化/恢复、关闭或真实网页全屏。
- I004：代码位置为 `electron/main/index.ts` 的 `petHiddenForVideoFullscreen` 与既有 `assistant-pet:close`/`assistant-pet:wake` handlers，以及 `src/renderer/src/App.tsx` 的全屏回调；自动化证据为 `App.test.tsx` 和 `index.mainWindowPetStartup.test.ts` 中默认关闭、未成功隐藏、可见且成功隐藏、异步 close 竞态用例，最终全量测试和构建均通过。真实网页全屏进出仍待用户在启动分支验收。
