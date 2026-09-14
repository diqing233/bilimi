# 2026-09-15 DeepSeek 401 授权失败：需求账本

> R004-R006 已在用户明确说“开始”后实施；未读取、输出或改写 API 密钥，未操作 B 站数据。真实 Electron 界面验收因本机桌面自动化认证错误待补。

## 原文区（不可改写、合并、删除或重排）

### R001（2026-09-15）

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-21d4873d-7cef-49be-8430-ca0e14fce66a.png`

截图目标区域：右侧“设置 > DeepSeek”面板顶部的失败提示，以及 DeepSeek API 密钥、模型、服务地址与“保存并测试”区域。截图可读取；可见失败文案为“配置已保存，但连接测试失败：DeepSeek API 请求失败：401 Authorization Required”。服务地址显示为 `https://api.deepseek.com`，模型显示为 `deepseek-v4-flash`，密钥输入框显示“已保存·系统加密保护”。

用户原文：

```text
DeepSeek怎么突然链接失败了
```

### R002（2026-09-15）

用户原文：

```text
你直接检查一下，我现在复制保存都会失败
```

### R003（2026-09-15）

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-7878bda1-c453-4ec2-a5fe-fa86ec6eee26.png`

截图目标区域：右侧“设置 > DeepSeek”面板。顶部显示“DeepSeek 设置已重置。”；API 密钥显示“尚未保存”，模型显示 `deepseek-v4-flash`，但“DeepSeek 服务地址”输入框显示 `https://api.yunshulink.com`，用户以红箭头标出该输入框。截图可读取。

用户原文：

```text
我重置了之后怎么是云枢的地址不是官网的
```

### R004（2026-09-15）

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-33816e65-bdd8-42a3-ad30-839214acc379.png`

截图目标区域：右侧“设置 > DeepSeek”中的 API 密钥、模型和服务地址输入区域，用户用红框标出。

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-53efe47c-c438-4f73-a8a0-7da1d321d26c.png`

截图目标区域：嵌入 B 站页面顶部搜索输入框，用户用红箭头标出。

用户原文：

```text
输入区域不能鼠标右键粘贴文本，
```

### R005（2026-09-15）

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-eff20029-a397-4b93-9b0e-299332547632.png`

截图目标区域：右侧“设置 > DeepSeek”面板。顶部状态显示“DeepSeek 验证中”，底部按钮显示“保存测试中”；服务地址为云枢智元推荐地址，模型为 `deepseek-v4-flash`，API 密钥已填写。截图可读取。

用户原文：

```text
DeepSeek验证时间是多久，一直没成功
```

### R006（2026-09-15）

用户原文：

```text
准备怎么优化
```

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明 DeepSeek 连接测试为何返回 `401 Authorization Required`。 | 设置页 DeepSeek 连接状态、`electron/main/deepseekService.ts:656`、`electron/main/deepseekService.ts:659`。 | 保存并测试后服务端返回 401 时显示。 | 未点击保存、重置或复制密钥。 | 未修改密钥、本机配置、B 站数据或远端内容。 | 未因 401 自动重置、覆盖或删除已有密钥，也未修改 DeepSeek 功能。 | 当前服务地址、密钥来源与权限、模型、请求头、DeepSeek/第三方服务端响应。 | 已诊断 | 代码向 `${baseUrl}/chat/completions` 发出带 `Authorization: Bearer <key>` 的请求；截图显示官方 `https://api.deepseek.com` 返回 401，证明网络和路径可达但该服务端拒绝该密钥。该地址的默认值自 2026-07-03 起未变，本轮没有自动改写。截图同时显示云格智元的第三方令牌/地址说明和 `deepseek-v4-flash`，最可能是第三方令牌误配给官方地址；另一可能是官方密钥已失效、被撤销或余额/权限已被服务端禁用。模型不匹配通常会在鉴权成功后返回模型类错误，不会导致 401。密钥本身未读取或输出。 |
| I002 | R002 | 查明当前 DeepSeek 设置页“复制”与“保存”都失败的实际原因。 | DeepSeek 设置页推荐配置复制按钮、API 密钥与服务地址保存/测试按钮、对应 renderer IPC。 | 用户在当前开发版点击复制或保存时失败；精确提示和复现步骤待现场读取。 | 仅读取按钮事件、剪贴板调用、IPC 返回与日志；不点击重置或保存来覆盖用户输入。 | 不修改密钥、服务地址、模型、本机配置或远端数据。 | 不把连接测试的 401 误判为保存失败；不更改已有设置功能。 | 运行中开发版、前端设置组件、preload IPC、主进程设置持久化与剪贴板权限。 | 核查中 | `FloatingAssistantApp.tsx:4484` 的复制先调用 Web Clipboard，失败后再调用 preload 的 `clipboard:write-text`；`electron/main/index.ts:1745` 直接使用 Electron `clipboard.writeText`。运行终端未记录这两个 IPC 处理器的异常。`FloatingAssistantApp.tsx:4358` 先执行保存，只有保存返回成功后才会测试连接；截图的“配置已保存，但连接测试失败”只能由该成功保存分支产生。当前截图的 `deepseek-v4-flash` 与云枢智元推荐地址 `https://api.yunshulink.com/v1` 配套，而已保存的服务地址为官方 `https://api.deepseek.com`，故 401 是保存完成后将不被官方接受的令牌送至官方地址的鉴权失败。未为了验证复制而覆盖用户剪贴板，仍待现场可观察证据确认复制提示/剪贴板内容。 |
| I003 | R003 | 重置 DeepSeek 后，界面与已持久化的官方默认服务地址必须一致，不能显示重置前的云枢地址。 | 设置页 DeepSeek 服务地址输入框；`resetDeepSeekSettings`、清除密钥 IPC 的偏好广播和 renderer 偏好同步。 | 用户确认“确认重置”后显示重置成功时。 | 重置清除密钥、关闭 DeepSeek、恢复默认模型和官方服务地址；后到的旧偏好广播不得反写界面。 | 实际 `bilimi-dev` 持久化数据已为 `https://api.deepseek.com`；不涉及 B 站副作用。 | 不改变云枢推荐区内容，也不自动替用户选择第三方服务。 | reset 的清密钥和保存顺序、主进程偏好广播、renderer 本地保存调度与跨进程消息顺序。 | 已实施，待开发版界面验收 | `electron/main/index.ts:2135` 的 `deepseek:clear-key` 现在仅广播 `{ deepseekApiKeyStored: status.configured }`，不再发送旧的完整偏好快照；重置后唯一完整快照来自随后的设置保存，包含官方默认地址。新增 `electron/main/index.deepSeekIpcWiring.test.ts` 先在旧实现下失败，再在新实现下通过。针对性回归 181 项通过；机器可读完整回归报告 `.codex-artifacts/deepseek-reset-full-test.json` 记录 `542/542` 文件、`4704/4704` 测试通过、0 失败；`npm run build` 通过并确认产物含该补丁。当前 Electron 开发版的主进程未自动重启，且桌面自动化因认证方式不可用，未能在真实窗口点击“确认重置”取得新截图；此项界面验收待开发版重启后执行。 |
| I004 | R004 | 查明并恢复输入区域的鼠标右键粘贴文本能力。 | 本应用设置页 DeepSeek 输入框；嵌入 B 站 WebView 的顶部搜索框。 | 用户在可编辑输入框上右键时；非可编辑页面区域不应出现不相关的编辑命令。 | 右键菜单在可编辑元素上提供可用的粘贴命令，且不干扰键盘粘贴、普通链接/页面右键行为或 B 站搜索输入。 | 不读取、保存、上传或输出剪贴板文本；不产生 B 站远端副作用。 | 不修改 DeepSeek 配置值、搜索关键词或既有复制按钮语义。 | Electron 主窗口/WebView 的 `context-menu` 处理、preload、B 站页面的嵌入策略和 Windows 剪贴板可用性。 | 已实施，待真实界面验收 | `electron/main/editableContextMenu.ts:30-50` 只在 `isEditable` 时用 `editFlags` 构建撤销、重做、剪切、复制、粘贴和全选的 Electron 原生角色菜单；未使用剪贴板 API。`electron/main/index.ts:334` 为主窗口挂接，`:339` 为每个 WebView guest 挂接。`editableContextMenu.test.ts` 覆盖可编辑、非可编辑和双挂接点；聚焦测试与 `npm test`（260 文件、4712 测试）通过，`npm run build` 通过。开发版 Electron 进程和 Vite `http://[::1]:5173` 可用；桌面自动化因 `unsupported Codex auth method: apikey` 无法附着，尚未取得真实右键/Paste 截图。 |
| I005 | R005 | 明确 DeepSeek 连接验证的正常时长、重试边界和何时可判定为异常卡住。 | 设置页 DeepSeek 验证状态和“保存测试中”按钮；`deepseekService.ts` 请求/重试逻辑。 | 点击“保存并测试”后至请求结算。 | 验证完成后显示成功或失败并恢复按钮；连接测试单次最多 20 秒，仅对 `429`、`502`、`503`、`504` 重试一次并等待 2 秒，最坏约 42 秒。 | 不读取或改变 API 密钥、服务地址、模型和远端数据。 | 不因等待现象自动重置配置、取消请求或更换服务商；正式 DeepSeek 生成仍保留原有 90 秒及两次重试默认策略。 | 服务端响应、网络请求超时、仅限暂态 HTTP 响应的重试。 | 已实施，待真实界面验收 | `deepseekConnectionTest.ts:5-6` 定义连接测试专用 `20_000` 与 `[2_000]`；`:19-54` 保持原有结果契约。`deepseekService.ts:653-698` 和 `:1017-1040` 通过超时竞速保证不响应 AbortSignal 的 provider 也会返回 `network-error`，而非让 IPC 永久 pending。`deepseekService.test.ts` 覆盖不响应 AbortSignal 的请求，`deepseekRetry.test.ts` 覆盖调用方空重试策略，`deepseekConnectionTest.test.ts` 覆盖专用配置；聚焦、完整 260/4712 测试和构建通过。真实窗口的时间边界因桌面自动化认证错误待补。 |
| I006 | R006 | 讨论并确定 DeepSeek 连接验证的优化方案。 | 设置页验证状态、“保存并测试”按钮，主进程连接测试请求。 | 点击“保存并测试”后。 | 保留明确失败结果和必要的暂态重试，验证专用策略为 20 秒单次限时、一次 2 秒重试；重试发生时显示“DeepSeek 服务暂时繁忙，正在重试（2/2）”。 | 不读取、输出或改写 API 密钥；不自行切换服务地址/服务商；不产生 B 站副作用。 | 不修改 DeepSeek 正式生成、转写总结或已有配置保存语义。 | 连接测试主进程重试回调、preload 窄事件、设置页全局反馈与既有 `finally` 清理。 | 已实施，待真实界面验收 | `index.ts:1294` 将连接测试路由到专用适配器，并只广播尝试序号、总次数和等待时间；`preload/index.ts:796-800` 暴露可取消的只读回调，`global.d.ts:391` 声明其类型，`FloatingAssistantApp.tsx:2988-2990` 显示重试文案；原有 `saveAndTestDeepSeekConnection` 的 `finally { finishDeepSeekTask() }` 未改。`deepseekConnectionTestProgress.test.ts` 和 `FloatingAssistantApp.test.ts` 覆盖 IPC/反馈/清理契约。完整测试和构建通过；真实界面验收待桌面自动化恢复。 |
