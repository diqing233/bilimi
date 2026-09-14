# 2026-09-15 转写进度测试修复与打包：需求账本

> 当前为讨论阶段；在用户明确说“开始”前，不修改产品代码、测试或执行发布打包。

## 原文区（不可改写、合并、删除或重排）

### R001（2026-09-15）

用户原文：

```text
可以修复并打包
```

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 修复 `npm test` 中两项转写进度条无障碍标签断言与当前界面的不一致。 | `src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx:668`、`src/renderer/src/features/notes/VideoNotesQueuePanel.test.tsx:804`；生产实现保持在 `src/renderer/src/features/notes/VideoNotesPanel.tsx:193`。 | 仅测试中转写中、DeepSeek 总结预留进度两种状态。 | 进度条仍为不确定状态，百分比文本仍显示；断言现验证 `正在本地转写音频` 且无 `value`。 | 不写入用户数据，不触发 B 站操作。 | 未修改备册状态刷新问题、转写队列业务流程或安装版功能。 | 转写队列组件、现有无障碍标签、Vitest。 | 已实施 | 定向测试 `38/38` 通过；全量测试 `256` 文件、`4703` 测试通过；开发版与预览版 Electron 均启动。图形自动化因 Codex 鉴权限制无法操作；预览版 B 站接口因当前登录会话返回 HTML，已验证其错误降级路径。 |
| I002 | R001 | 在修复通过发布门槛后，构建 Windows NSIS 安装包。 | `dist/bilimi.Setup.1.2.0.exe`。 | 仅在工作树干净、全量测试、开发版与预览版关键启动检查通过后。 | 已生成版本 `1.2.0` 的安装包；未发布或推送。 | 仅生成本地构建产物；安装验收使用本机已有的隔离 NSIS 安装目录，未触发 B 站同步、备册或转写。 | 未绕过失败测试，未推送或发布。 | `npm test`、`npm run build`、`npm run preview`、`npm run dist:win`。 | 已实施 | `npm run dist:win` 退出码为 `0`；安装包与 blockmap 存在；静默安装退出码为 `0`；安装版稳定启动，且 `ffmpeg`、`ffprobe`、`whisper-cli`、SenseVoiceSmall 运行程序存在。图形交互受 Codex 鉴权限制未自动验收。 |
