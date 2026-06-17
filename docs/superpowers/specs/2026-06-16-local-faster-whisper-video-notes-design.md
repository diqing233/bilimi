# Bilimi 本地 faster-whisper 视频札记设计

## 背景

当前札记功能优先从 B 站页面读取字幕或文稿，再用本地规则生成札记；缺少字幕时可通过 OpenAI `whisper-1` 转写音频。新的目标是去掉默认的页面字幕/文稿整理路径，去掉 OpenAI Key 和 OpenAI 转写依赖，改为直接下载当前视频音频并使用本地免费的 `faster-whisper` 完成转写。

## 目标

1. 用户点击整理札记时，默认执行本地音频转写流程。
2. 札记仍绑定当前 B 站视频的标题、BV 号、URL、作者等来源信息。
3. 音频转写使用本机 `faster-whisper`，不需要 OpenAI API Key。
4. 手动粘贴文稿整理继续保留，作为用户主动兜底。
5. 生成结果继续复用现有札记结构、批注、跳转时间、Markdown 导出和本地保存能力。
6. 速览输出面向复习，包含一句话、核心要点、值得复看和待查问题。
7. 时间线条目和文稿段落可以直接发起带时间点的批注草稿。

## 非目标

1. 不在本阶段接入 DeepSeek 或其他大模型总结。
2. 不在本阶段做模型选择 UI、GPU/CPU 高级配置 UI 或批量队列。
3. 不完全移除页面元信息读取；URL、标题、BV 号等仍是下载和归档所需。
4. 不删除手动粘贴文稿能力。

## 用户流程

1. 用户打开一个 B 站视频。
2. 用户进入札记页并点击整理札记。
3. 系统读取当前页面元信息，只用于定位视频和归档。
4. 主进程导出当前 B 站登录 Cookie。
5. `yt-dlp` 下载当前视频最佳音频。
6. `ffmpeg` 将音频切成可转写片段。
7. 本地 Python 脚本调用 `faster-whisper` 转写每个片段，并输出 JSON 文稿段。
8. 渲染进程将文稿段交给现有本地札记整理器，生成速览、时间线、关键词和高光。
9. 用户可保存、批注、跳转时间点或导出 Markdown。
10. 用户也可从时间线或文稿段落点击 `加批注`，直接进入批注页并带入该时间点。

手动粘贴文稿流程保持不变：用户主动粘贴文本时，系统不下载音频，直接解析粘贴内容并生成札记。

## 架构

### 渲染进程

- `VideoNotesPanel` 不再展示 OpenAI API Key 输入、保存或清除入口。
- 默认整理按钮调用音频转写生成札记。
- 手动粘贴文稿按钮继续调用手动文稿生成路径。
- 进度展示继续使用现有 `VideoAudioTranscriptionProgress`。
- 时间线和文稿段落提供 `加批注` 动作，预填时间点和简短标题后切到批注页。

### 本地札记整理器

- `createLocalVideoNoteDraft` 继续输出现有 `VideoNoteOverview` 结构。
- `shortSummary` 采用学习型条目：`一句话`、最多两个 `核心要点`、一个 `值得复看` 和一个 `待查问题`。
- `timeline` 保持按章节输出，`highlights` 选取前两个带时间点的章节作为复看片段。

### 主窗口运行时

- 保留 `readVideoNoteSource`，但它只负责来源信息和当前 URL，不再把自动字幕作为默认文稿。
- `generateRuntimeVideoNote` 的默认路径改为调用音频转写。
- `manualTranscript` 存在时继续走 `parseManualTranscript`。

### 主进程

- `video-audio:transcribe-current` 不再读取 OpenAI Key。
- `videoTranscriptionService` 继续负责 Cookie 导出、下载音频、切段、汇总转写结果和清理临时目录。
- 转写依赖从 `openAiTranscription` 替换为新的本地 `fasterWhisperTranscription`。

### Python 转写脚本

新增 `tools/transcribe_faster_whisper.py`：

- 参数接收音频文件路径、模型名称、运行设备和 compute type。
- 默认模型为 `small`，兼顾中文识别质量和本地速度。
- 默认运行参数为 `device=cpu`、`compute_type=int8`，避免普通 Windows 开发环境因为缺少 CUDA DLL 而失败。
- 使用 `faster_whisper.WhisperModel` 转写音频。
- 输出 UTF-8 JSON，格式包含 `segments: [{ start, end, text }]`。
- Node 层负责把片段内时间加上 offset，形成全视频时间轴。

## 依赖发现

系统按以下顺序寻找 Python：

1. 环境变量 `BILIMI_PYTHON_PATH`。
2. `python`。
3. `python3`。
4. Windows `py -3` 启动器。

如果无法启动 Python 或缺少 `faster_whisper`，错误提示应说明需要安装依赖，例如：

```bash
python -m pip install faster-whisper
```

`yt-dlp`、`ffmpeg` 和 `ffprobe` 继续使用现有 `mediaToolPaths` 发现逻辑；`ffprobe` 与 `ffmpeg` 同目录，用于读取音频时长。

Node 启动 Python 子进程时设置 `PYTHONUTF8=1` 和 `PYTHONIOENCODING=utf-8`，Python 脚本也会把 `stdout`/`stderr` 配置为 UTF-8，避免中文文稿在 Windows 本地编码下变成乱码。

浮窗触发的 `generate-video-note-from-audio` 是长任务运行时请求，主进程等待时间应长于普通快请求；普通快请求保持短超时，音频札记请求使用长超时。

## 数据流

```text
VideoNotesPanel
  -> generateVideoNoteFromAudio
  -> App.generateRuntimeVideoNoteFromAudio
  -> bilimiDesktop.transcribeCurrentVideoAudio
  -> videoTranscriptionService
  -> yt-dlp download
  -> ffmpeg segment
  -> fasterWhisperTranscription
  -> TranscriptSegment[]
  -> createLocalVideoNoteDraft
  -> VideoNote
```

## 错误处理

1. 当前页面没有 URL：返回无法定位视频。
2. `yt-dlp` 下载失败：显示下载失败原因，并隐藏原始 URL 中敏感信息。
3. `ffmpeg` 处理失败：提示音频格式可能不支持或工具不可用。
4. Python 不可用：提示安装 Python 或配置 `BILIMI_PYTHON_PATH`。
5. `faster_whisper` 不可用：提示安装 `faster-whisper`。
6. 模型下载失败：提示检查网络或手动准备模型缓存。
7. 转写结果为空：生成无文稿札记，并提示可粘贴文稿后重新整理。

## 测试范围

1. `VideoNotesPanel` 不再展示 OpenAI Key UI，默认整理触发音频转写。
2. 手动粘贴文稿仍触发手动生成路径。
3. `videoTranscriptionService` 调用本地转写依赖，不需要 API Key。
4. `fasterWhisperTranscription` 能把 JSON 输出映射为 `TranscriptSegment[]`。
5. Python 缺失、`faster_whisper` 缺失、转写进程失败时返回可读错误。
6. 本地札记整理器输出学习型速览和复看片段。
7. 时间线和文稿段落的 `加批注` 能打开批注草稿并带入时间点。
8. 现有札记保存、批注、Markdown 导出测试继续通过。
