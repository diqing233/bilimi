# 2026-09-15 faster-whisper 下载来源与失败：需求账本

> 用户已在 R008 前明确说“开始”。本轮仅修改转写下载 IPC、模型管理器与设置面板；不修改模型文件、用户数据、转写队列或 B 站数据。

## 原文区（不可改写、合并、删除或重排）

### R001（2026-09-15）

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-7780dc64-52b5-4fd0-9808-e64a63519814.png`

截图目标区域：右侧“设置 > 视频转写与模型与 CPU 占用”面板。所选模型为 `faster-whisper large-v3-turbo`；下载中区域显示“当前来源：GitHub Release”和取消下载按钮。

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ddf4d91f-fd52-430d-ac29-9d7fb68d3ab1.png`

截图目标区域：同一右侧设置面板的下载失败状态。错误文字可读为：`Shared faster-whisper runtime download failed. Attempted sources: ModelScope: Model download failed: 404; GitHub Release: fetch failed`；下方另显示相同的失败摘要。

用户原文：

```text
下载为什么失败，首选来源怎么不是魔搭
```

### R002（2026-09-15）

用户原文：

```text
为什么返回404
```

### R003（2026-09-15）

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8139b6e3-0e88-4f5c-893a-bb4d660483aa.png`

截图目标区域：开发版右侧“设置 > 视频转写与模型与 CPU 占用”面板。所选模型为 `faster-whisper large-v3`，按钮为“继续下载”“重新下载”“手动导入对应模型文件夹”，下方显示 `Error invoking remote method 'video-audio:transcription-model-install': AbortError: The operation was aborted`。

用户原文：

```text
开发版怎么下载成功了，只是取消的时候会报错，正常能下载
```

### R004（2026-09-15）

用户原文：

```text
ModelScope为什么返回404，我在网页上下载是正常的呀
```

### R005（2026-09-15）

用户原文：

```text
[https://www.modelscope.cn/models/bilimi/transcription-models/files](https://www.modelscope.cn/models/bilimi/transcription-models/files)
```

### R006（2026-09-15）

用户原文：

```text
要重新上传吗
```

### R007（2026-09-15）

用户原文：

```text
可以你来做，并且下载时始终显示下载来源，方便确认，取消的时候不要报错
```

### R008（2026-09-15）

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-188c32af-78e8-4a88-a761-b5fad8615c68.png`

截图目标区域：右侧开发版“设置 > 视频转写模型与 CPU 占用”面板。模型下拉框显示 `Whisper small`；红框圈定模型操作区，其中“设为当前模型”按钮不可用、仅“迁移到应用模型目录”可点，下方仍显示先前取消下载的 `AbortError` 错误。

用户原文：

```text
补充一个bug，切换另一个模型后没有可操作按钮，页面没更新，
文件上传不了的话可以发我，把详细位置告诉我，我来操作
```

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002、R003 | 查清 faster-whisper large-v3-turbo 下载失败的根因，并确认实际首选来源及 UI 来源文案是否准确。 | 模型下载设置、`electron/main/transcriptionModelManager.ts`、`electron/main/transcriptionModelManifest.ts`、`src/renderer/src/features/assistant/TranscriptionModelSettings.tsx`。 | 下载、回退和失败期间显示来源；失败后显示各来源错误。 | 仅诊断下载顺序、URL 与显示状态；不自动下载、重试、删除部分文件或更改模型选择。 | 不改模型文件、偏好、转写队列、B站数据或远端状态。 | 不将最终回退来源误称为首选来源；不因诊断操作覆盖用户下载进度。 | ModelScope 仓库与对象路径、GitHub Release 可达性、共享 faster-whisper 运行时下载、渲染层进度状态。 | 已实施，待远端运行时上传验证 | R003 证明开发版可正常下载模型文件。模型管理器固定使用 `%LOCALAPPDATA%\\bilimi\\transcription-models`，开发版虽使用独立的 Electron 用户数据目录，仍复用该共享模型目录；本机已存在 `faster-whisper-runtime\\bilimi-faster-whisper.exe`，所以不会进入安装版首次下载 1.23GB 运行时的 ModelScope 404 / GitHub 失败路径。取消时，主进程已发布 `canceled`，但随后继续抛出同一个 `AbortError`，令 `ipcRenderer.invoke` 拒绝并被界面显示为下载错误。当前远端精确对象仍返回 `404`；其补传后才可验证首次安装全流程。 |
| I002 | R003、R007 | 用户取消模型下载后，仅显示已取消状态，不显示 `AbortError` 下载失败。 | 模型下载设置、转写模型安装 IPC、下载进度状态。 | 用户主动点击取消时显示；网络、校验或磁盘错误时仍须显示真实失败原因。 | 取消请求中止下载，进度转为 `canceled`，调用方正常结束并刷新模型状态。 | 保留已下载的可续传部分；不修改已完成模型、偏好、转写队列或 B站数据。 | 不吞掉非取消错误；不改变正常下载与断点续传行为。 | 安装 IPC、renderer 下载调用、进度订阅与取消控制器。 | 已实施 | 根因已定位：`electron/main/transcriptionModelIpc.ts` 对取消先发布 `canceled`，再 `throw error`。现改为发布 `canceled` 后正常返回 `manager.list()`；非取消异常仍发布 `failed` 并拒绝 IPC。 |
| I003 | R004、R005 | 查清浏览器手动下载成功与客户端 ModelScope 请求 404 的差异。 | ModelScope 网页下载入口、`electron/main/transcriptionModelManifest.ts` 的运行时镜像 URL。 | 浏览器手动下载与客户端运行时首次下载时分别核对。 | 仅比较请求 URL、身份/权限和下载对象；不自动使用浏览器 Cookie 或账户凭据。 | 不改变模型文件、登录状态、偏好、转写队列或 B站数据。 | 不将网页页面 HTTP `200` 当作文件对象存在的证据；不复制用户登录凭据到客户端。 | 精确模型页/文件链接、ModelScope 登录权限、仓库和对象存在性。 | 已确认 | 用户给出的仓库页对应公开仓库，模型元数据、`faster-whisper-large-v3/config.json` 与 `faster-whisper-large-v3-turbo/config.json` 均返回 `200`，`faster-whisper-large-v3/model.bin` 的 Range 请求返回 `206`。但同仓库的 `manifest.json` 没有任何 `faster-whisper-runtime/bilimi-faster-whisper.exe` 条目，且该精确对象 URL 返回 `404` 和“获取模型文件失败，文件内容为空”。根因是 ModelScope 镜像漏传共享运行时，不是登录、域名、分支或反盗链问题。 |
| I004 | R006、R007、R008 | 恢复 ModelScope 首选来源的共享 faster-whisper 运行时。 | ModelScope 仓库 `bilimi/transcription-models`。 | 安装版首次下载任意 faster-whisper 模型时需要；本地已有运行时不触发。 | 只补传缺失运行时到 `faster-whisper-runtime/bilimi-faster-whisper.exe`，随后以程序清单内的文件大小与 SHA-256 验证。 | 远端对象新增；不更改本地模型、用户偏好、转写队列或 B站数据。 | 不重新上传已有模型文件；不更改客户端来源优先级；不上传未经校验的二进制。 | 已发布运行时二进制、ModelScope 上传权限、`FASTER_WHISPER_RUNTIME` 的精确哈希。 | 待用户手动上传，已提供精确文件位置 | 本机候选文件已核验：大小 `1230066949` 字节，SHA-256 `79922ca2a61918bad0447d9327316f013072d7a7d8e07a0d3a75a29cc26c06ac`。本机 Git LFS 推送因 Credential Manager 未提供 ModelScope 写入凭据而失败，远端 `master` 仍为 `8cf0948`、公网精确路径仍返回 `404`；未上传任何对象。 |
| I005 | R007 | 下载期间始终显示当前下载来源，供用户确认。 | 转写模型下载设置和模型下载进度。 | 连接、下载、校验、安装以及来源回退期间显示；无下载时隐藏。 | 连接首个来源时立即显示；回退时更新为当前来源并说明回退；进入校验、安装等无网络阶段仍保留最近一次实际下载来源。 | 不改变下载顺序、文件、偏好、转写队列或 B站数据。 | 不把“当前来源”写成“首选来源”；不遮挡取消控件或改变点击范围。 | 主进程进度事件、renderer 下载状态和来源回退消息。 | 已实施 | 现有运行时回退循环未携带 `sourceFallbackMessage`；renderer 仅在存在 `progress.source` 时展示来源，故阶段切换时可能丢失。现由 IPC 保存最近一次实际来源，进入校验、安装、运行时校验及可用阶段都保留该来源；运行时从 ModelScope 回退 GitHub Release 时发送简明回退说明。 |
| I006 | R008 | 切换转写模型后立即显示该模型真实可执行操作，不能保留前一模型错误或处于无操作的陈旧状态。 | 开发版右侧“设置 > 视频转写模型与 CPU 占用”面板中的模型下拉框、操作区和安装错误提示。 | 用户切换任一模型后显示；无 B站登录、已安装、可迁移、可下载等状态应分别准确反映。 | 下拉切换后基于新模型安装/可用/迁移状态重新计算按钮与错误；前一模型的取消错误不得显示在另一模型下。 | 不改变模型安装文件、当前账号偏好、转写队列、GPU 检测或 B站数据。 | 不因切换自动下载、迁移、设为当前模型或清理断点文件。 | 模型列表刷新、候选模型 state、模型安装错误 state、账号登录状态与旧版 Whisper 迁移状态。 | 已实施，待真实开发版界面复验 | 根因是面板本地 `installationError` 未随候选模型重置，并非 `Whisper small` 没有可操作动作。截图中的 `Whisper small` 是旧版可迁移模型，正确操作为“迁移到应用模型目录”。 |

## 实施记录（2026-09-15）

- I001：`electron/main/transcriptionModelManager.ts:475-485` 在共享运行时的 ModelScope 失败后报告实际的 GitHub Release 回退；`electron/main/transcriptionModelIpc.ts:53-60` 保存实际来源。`electron/main/transcriptionModelManager.test.ts:500-521` 与 `electron/main/transcriptionModelIpc.test.ts:95-121` 已覆盖。公网 Range 请求仍得 `404`，因此首次安装下载成功待远端文件补传后验收。
- I002：`electron/main/transcriptionModelIpc.ts:91-94` 把用户取消转为正常 IPC 返回；`electron/main/transcriptionModelIpc.test.ts:149-168` 覆盖。旧生产逻辑下该测试稳定得到 `AbortError`；恢复修复后通过。
- I003：未改客户端 URL；精确远端对象仍为 `404`，保持 I004 的外部依赖，不使用网页 Cookie 或账户凭据绕过问题。
- I004：待用户向 ModelScope 仓库 `bilimi/transcription-models` 上传 `faster-whisper-runtime/bilimi-faster-whisper.exe`。本机源文件为 `C:\Users\diqing\AppData\Local\bilimi\transcription-models\faster-whisper-runtime\bilimi-faster-whisper.exe`；大小 `1230066949` 字节，SHA-256 `79922ca2a61918bad0447d9327316f013072d7a7d8e07a0d3a75a29cc26c06ac`。
- I005：`electron/main/transcriptionModelIpc.ts:53-60` 和 `electron/main/transcriptionModelManager.ts:475-485` 已实施；旧生产逻辑下来源保留和回退测试稳定失败，恢复修复后通过。渲染层既有 `TranscriptionModelSettings.tsx:172` 继续显示该进度快照。
- I006：`src/renderer/src/features/assistant/TranscriptionModelSettings.tsx:105-110,150` 在受控当前模型更新和下拉候选切换时清除本地安装错误。`TranscriptionModelSettings.test.tsx:422-445` 复现“一个模型下载失败，再切换至可迁移 Whisper small”；旧生产逻辑稳定失败，恢复修复后通过。因自动化窗口服务报 `unsupported Codex auth method: apikey`，真实 Electron 可见界面待手动复验。

### 验证汇总

- 定向红绿验证：旧生产逻辑下 3 个测试文件共 4 项断言失败，分别对应取消、来源保留、运行时回退说明和模型切换错误隔离；恢复最小修复后 3 个文件、88 项测试通过。
- 全量自动化：`npm test` 通过，260 个测试文件、4715 项测试。
- 构建：`npm run build` 通过。`npm run dev` 与 `npm run preview` 都完成构建并启动 Electron 入口；二者均仅产生既有的动态导入分包警告。
- 真实界面：尝试自动验证时，Computer Use 服务无法枚举窗口，错误为 `unsupported Codex auth method: apikey`；未在该环境执行界面点击、下载、迁移或模型文件写入。
