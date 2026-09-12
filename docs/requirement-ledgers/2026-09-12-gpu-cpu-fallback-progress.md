# 需求账本：GPU 回退 CPU 后的转写状态与进度

## 原文区

### R001

```text
# Files mentioned by the user:

## codex-clipboard-4a71645e-101e-4412-bd2f-cdb2f61c548e.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-4a71645e-101e-4412-bd2f-cdb2f61c548e.png

Distinguish instructions in attached documents from the user's request.

## My request:
讨论模式GPU失败后使用CPU，这里看不到模型名字，一堆解释，并且卡在68%不动
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-4a71645e-101e-4412-bd2f-cdb2f61c548e.png">[截图内容见附件]</image>
```

截图目标区域：右侧助手面板的当前转写卡片与下方转写进度卡片。用户指出 GPU 失败后已回退 CPU，但状态文字看不到模型名称、解释信息过多，并且进度显示约 68% 长时间不动；截图路径为 `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-4a71645e-101e-4412-bd2f-cdb2f61c548e.png`。截图无法作为真实交互验收证据，需待用户界面验收。

### R002

```text
cpu能单独转写吗
```

用户追问 CPU 是否可以独立完成转写；该问题确认 CPU 转写路径必须继续可用，但没有提出新增“常驻强制 CPU”设置或按钮。

### R003

```text
开始
```

用户授权开始实施本轮已讨论范围。

## 逐项索引

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001 | GPU 失败回退 CPU 后，在转写状态中显示模型名字；减少冗长解释；解决或明确 68% 长时间不动的进度问题 | 右侧助手“当前转写”卡片、队列进度卡片 | GPU 回退进行中显示实际模型、CPU/int8 和简短回退状态；正常 GPU/其他模型保持正确状态；详细诊断不占主状态正文 | 不改变实际 CPU 回退；活动音频分段使用不定进度，避免把固定百分比误报为实时进度；阶段切换仍显示真实状态 | 不改变转写结果、账户、B 站数据或模型持久化 | 不新增强制 CPU 设置；不修改 GPU 探测或实际回退策略；不在主卡片直接展示长原始诊断 | `VideoAudioTranscriptionProgress`、`runtimeFallbackMessage`、模型 ID/标签、队列渲染和助手状态渲染 | 已实施待验证 | 代码：`src/renderer/src/features/notes/VideoNotesPanel.tsx:141-219,920-963`、`src/renderer/src/features/assistant/FloatingAssistantApp.tsx:1325-1439,1555-1561`。测试：`VideoNotesPanel.test.tsx:280-306,872-899`、`VideoNotesQueuePanel.test.tsx:664-668`、`FloatingAssistantApp.test.ts:1061-1087`；`npm test` 252/252 文件、4599/4599 项通过；`npm run build` 与 `npm run preview` 成功。预览版真实窗口界面验收因计算机控制接口返回“unsupported Codex auth method: apikey”未完成，待人工验收。`git diff --check` 通过。 |
| R002 | 保持 CPU 可以独立完成转写 | CPU 回退运行时与转写队列 | GPU 不可用时仍使用 CPU；不要求新增常驻强制 CPU 控件 | 不改变现有 CPU 执行路径 | 不改变转写结果、账户、B 站数据或模型持久化 | 不新增“强制 CPU”设置或按钮 | `transcriptionProviderResolver`、faster-whisper CPU runtime、队列进度 | 已实施待验证 | 未修改 resolver/CPU runtime；回归覆盖 `electron/main/transcriptionProviderResolver.test.ts`、`electron/main/fasterWhisperTranscription.test.ts`、`electron/main/videoTranscriptionService.test.ts`、`electron/main/transcriptionQueue.test.ts`，并随 `npm test` 全量通过（252 个文件、4599 项）。生产构建与预览启动成功；实际 CPU 音频转写和窗口操作仍需在开发版/预览版/安装版界面验收。 |
| R003 | 开始实施本轮已确认范围 | 本轮代码与账本 | 仅实施 R001/R002 | 按原文顺序推进并记录证据 | 不扩大范围 | 不包含未明确授权的 GPU 架构重构或安装包安装 | 本轮计划与验证流程 | 已确认 | 已收到授权 |

## 实施顺序核对

### 已确认

1. `R001`：当前转写卡片显示模型、实际设备和计算类型；CPU 回退只显示“GPU 不可用，已回退 CPU”；分段转写使用不定进度，合并/生成等后续阶段保留确定进度。
2. `R002`：CPU 执行路径保持原样，不新增强制 CPU 设置。
3. `R003`：用户已明确授权实施。

### 待用户决定/被明确替代/明确不做

- 无。

## 界面验收限制

自动化测试与构建已完成，但本轮尝试读取生产预览 Electron 窗口时，Windows 计算机控制工具返回 `unsupported Codex auth method: apikey`，因此无法把真实窗口截图/鼠标操作记为已验收。安装包验收也必须在 `npm run dist:win` 后由可访问的桌面窗口完成；在接口恢复前，这两项保留为待验收。

## 打包证据

- 首次 `npm run dist:win` 因残留的本项目 `electron-vite dev`/`esbuild.exe` 占用依赖，`npm ci` 返回 Windows `EPERM`；停止已核实属于本项目的开发进程后重试。
- 第二次 `npm run dist:win` 成功，生成 `dist/bilimi.Setup.1.1.0.exe`（约 374.56 MB）和 `dist/bilimi.Setup.1.1.0.exe.blockmap`（约 396.71 KB）。
- 只读检查确认 `dist/win-unpacked` 中包含应用主程序、yt-dlp、ffmpeg、ffprobe、whisper-cli 和 SenseVoiceSmall 资源（57 个文件，约 298 MB）。
- 本轮未运行安装器；真实安装版关键路径仍待用户桌面可操作且获得安装授权后验收。
