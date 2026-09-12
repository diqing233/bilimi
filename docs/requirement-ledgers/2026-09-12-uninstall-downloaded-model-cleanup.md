# 需求账本：卸载已下载转写模型清理

## 原文区

### R001

```text
卸载软件的时候好像没有吧下载的模型也删掉
```

截图目标区域：无截图。

## 逐项索引

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001 | 勾选卸载器“同时删除 bilimi 用户数据”时，也删除已下载的转写模型 | NSIS 卸载器用户数据页与 `%LOCALAPPDATA%\\bilimi\\transcription-models` | 仅在勾选“同时删除 bilimi 用户数据”时删除；未勾选则保留以支持重装复用 | 清理下载模型、faster-whisper 共享运行时、未完成下载和 `runtime-validation.json` 所在受控模型根目录 | 只删除本机模型数据；不修改 B 站远端数据，不触碰安装包自带 SenseVoice 资源或其他应用目录 | 不改变默认未勾选策略；不删除 `%LOCALAPPDATA%\\bilimi` 下非 `transcription-models` 的内容 | `transcriptionModelManager.ts` 的模型根目录、NSIS `$LOCALAPPDATA`、`customUnInstall` 执行顺序 | 已实施待验证 | 根因：模型管理器默认根目录为 `electron/main/transcriptionModelManager.ts:197` 的 `%LOCALAPPDATA%\\bilimi\\transcription-models`，旧卸载逻辑只删除 `$APPDATA\\bilimi`。已在 `electron/installer/installer.nsh:260-272` 的勾选分支增加 `RMDir /r "$LOCALAPPDATA\\bilimi\\transcription-models"`，并在卸载说明 `:291` 明示“已下载的转写模型和运行时”。自动化证据：`electron/installer/nsisInstallDirectory.test.ts` 14/14 通过；全量 `npm test` 252 文件/4597 项通过；`npm run build` 通过。新的 NSIS 安装包尚未生成，需下次执行 `npm run dist:win` 后补充包哈希；未安装验证。 |
