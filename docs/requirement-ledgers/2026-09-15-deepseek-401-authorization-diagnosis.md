# 2026-09-15 DeepSeek 401 授权失败：需求账本

> 当前为讨论/诊断阶段；用户尚未说“开始”，不修改产品代码、配置或 API 密钥。

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

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明 DeepSeek 连接测试为何返回 `401 Authorization Required`。 | 设置页 DeepSeek 连接状态、`electron/main/deepseekService.ts:656`、`electron/main/deepseekService.ts:659`。 | 保存并测试后服务端返回 401 时显示。 | 未点击保存、重置或复制密钥。 | 未修改密钥、本机配置、B 站数据或远端内容。 | 未因 401 自动重置、覆盖或删除已有密钥，也未修改 DeepSeek 功能。 | 当前服务地址、密钥来源与权限、模型、请求头、DeepSeek/第三方服务端响应。 | 已诊断 | 代码向 `${baseUrl}/chat/completions` 发出带 `Authorization: Bearer <key>` 的请求；截图显示官方 `https://api.deepseek.com` 返回 401，证明网络和路径可达但该服务端拒绝该密钥。该地址的默认值自 2026-07-03 起未变，本轮没有自动改写。截图同时显示云格智元的第三方令牌/地址说明和 `deepseek-v4-flash`，最可能是第三方令牌误配给官方地址；另一可能是官方密钥已失效、被撤销或余额/权限已被服务端禁用。模型不匹配通常会在鉴权成功后返回模型类错误，不会导致 401。密钥本身未读取或输出。 |
| I002 | R002 | 查明当前 DeepSeek 设置页“复制”与“保存”都失败的实际原因。 | DeepSeek 设置页推荐配置复制按钮、API 密钥与服务地址保存/测试按钮、对应 renderer IPC。 | 用户在当前开发版点击复制或保存时失败；精确提示和复现步骤待现场读取。 | 仅读取按钮事件、剪贴板调用、IPC 返回与日志；不点击重置或保存来覆盖用户输入。 | 不修改密钥、服务地址、模型、本机配置或远端数据。 | 不把连接测试的 401 误判为保存失败；不更改已有设置功能。 | 运行中开发版、前端设置组件、preload IPC、主进程设置持久化与剪贴板权限。 | 核查中 | `FloatingAssistantApp.tsx:4484` 的复制先调用 Web Clipboard，失败后再调用 preload 的 `clipboard:write-text`；`electron/main/index.ts:1745` 直接使用 Electron `clipboard.writeText`。运行终端未记录这两个 IPC 处理器的异常。`FloatingAssistantApp.tsx:4358` 先执行保存，只有保存返回成功后才会测试连接；截图的“配置已保存，但连接测试失败”只能由该成功保存分支产生。当前截图的 `deepseek-v4-flash` 与云枢智元推荐地址 `https://api.yunshulink.com/v1` 配套，而已保存的服务地址为官方 `https://api.deepseek.com`，故 401 是保存完成后将不被官方接受的令牌送至官方地址的鉴权失败。未为了验证复制而覆盖用户剪贴板，仍待现场可观察证据确认复制提示/剪贴板内容。 |
| I003 | R003 | 重置 DeepSeek 后，界面与已持久化的官方默认服务地址必须一致，不能显示重置前的云枢地址。 | 设置页 DeepSeek 服务地址输入框；`resetDeepSeekSettings`、清除密钥 IPC 的偏好广播和 renderer 偏好同步。 | 用户确认“确认重置”后显示重置成功时。 | 重置清除密钥、关闭 DeepSeek、恢复默认模型和官方服务地址；后到的旧偏好广播不得反写界面。 | 实际 `bilimi-dev` 持久化数据已为 `https://api.deepseek.com`；不涉及 B 站副作用。 | 不改变云枢推荐区内容，也不自动替用户选择第三方服务。 | reset 的清密钥和保存顺序、主进程偏好广播、renderer 本地保存调度与跨进程消息顺序。 | 已实施，待开发版界面验收 | `electron/main/index.ts:2135` 的 `deepseek:clear-key` 现在仅广播 `{ deepseekApiKeyStored: status.configured }`，不再发送旧的完整偏好快照；重置后唯一完整快照来自随后的设置保存，包含官方默认地址。新增 `electron/main/index.deepSeekIpcWiring.test.ts` 先在旧实现下失败，再在新实现下通过。针对性回归 181 项通过；机器可读完整回归报告 `.codex-artifacts/deepseek-reset-full-test.json` 记录 `542/542` 文件、`4704/4704` 测试通过、0 失败；`npm run build` 通过并确认产物含该补丁。当前 Electron 开发版的主进程未自动重启，且桌面自动化因认证方式不可用，未能在真实窗口点击“确认重置”取得新截图；此项界面验收待开发版重启后执行。 |
