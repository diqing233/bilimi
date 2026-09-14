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

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明 DeepSeek 连接测试为何返回 `401 Authorization Required`。 | 设置页 DeepSeek 连接状态、`electron/main/deepseekService.ts:656`、`electron/main/deepseekService.ts:659`。 | 保存并测试后服务端返回 401 时显示。 | 未点击保存、重置或复制密钥。 | 未修改密钥、本机配置、B 站数据或远端内容。 | 未因 401 自动重置、覆盖或删除已有密钥，也未修改 DeepSeek 功能。 | 当前服务地址、密钥来源与权限、模型、请求头、DeepSeek/第三方服务端响应。 | 已诊断 | 代码向 `${baseUrl}/chat/completions` 发出带 `Authorization: Bearer <key>` 的请求；截图显示官方 `https://api.deepseek.com` 返回 401，证明网络和路径可达但该服务端拒绝该密钥。该地址的默认值自 2026-07-03 起未变，本轮没有自动改写。截图同时显示云格智元的第三方令牌/地址说明和 `deepseek-v4-flash`，最可能是第三方令牌误配给官方地址；另一可能是官方密钥已失效、被撤销或余额/权限已被服务端禁用。模型不匹配通常会在鉴权成功后返回模型类错误，不会导致 401。密钥本身未读取或输出。 |
