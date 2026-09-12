# GPU 回退 CPU 转写状态与进度设计

## 目标

修正 GPU 自检失败后 CPU 转写时的状态可读性：当前转写卡片显示实际模型和简洁的 CPU 回退状态，隐藏冗长诊断；转写音频分段期间不再显示无依据的 68% 固定百分比；保持现有 CPU 转写和 GPU 回退执行路径不变。

## 现状与根因

队列的活动卡片只拼接 `actualDevice`、`actualComputeType` 和 `runtimeFallbackMessage`，没有拼接 `transcriptionModelId`，因此模型名缺失。回退原因是面向诊断的长文本，直接放进活动卡片会挤占主要信息。

音频默认按 600 秒切段。渲染器把 `transcribing-segment` 的第 `index/count` 映射到 30% 到 68%（无 DeepSeek）或 30% 到 78%（有 DeepSeek）。当只有一个分段时，刚进入推理就显示 68%，而主进程在单段推理完成前不会再发事件，故形成假性“卡在 68%”。

## 设计

1. 在队列当前卡片的运行时标签中加入模型标签，格式为 `模型：<标签> · CPU（int8）` 或对应 GPU；GPU 回退时追加一行简短的 `GPU 不可用，已回退 CPU`，不直接渲染 `runtimeFallbackMessage`。
2. 让进度格式化结果支持不定进度。`transcribing-segment` 且存在分段信息时显示“正在转写第 x / y 段”，进度条使用不定状态，不呈现 68%/78% 的伪百分比；队列其它准备、合并、生成、保存阶段继续使用现有确定性阶段进度。
3. 全局助手状态灯同步显示模型、CPU/int8 和简短回退状态；详细原因仍保留在队列数据中供诊断路径使用，但不改变其持久化格式。
4. 不新增强制 CPU 设置，不修改 runtime resolver、GPU probe、转写结果、账户、B 站数据或模型下载。

## 验收

- 运行中的 faster-whisper CPU 回退项显示实际模型、CPU/int8 和简短回退状态，不显示长 CUDA 解释。
- 正常 GPU 运行仍显示模型和 GPU 已就绪/实际 GPU，不出现 CPU 回退文案。
- `transcribing-segment` 的 `<progress>` 没有伪造 `value=68`，且可访问文本仍包含段号；后续阶段继续有确定进度。
- CPU 转写 resolver/队列现有测试通过，证明执行路径未改。
