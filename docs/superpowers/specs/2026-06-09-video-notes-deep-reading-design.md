# Bilimi 视频札记深度研读设计规格

- 日期：2026-06-09
- 状态：已确认设计稿，等待实现计划
- 范围：当前视频札记的时间点批注、跳转、Markdown 导出和保存整合
- 不包含：全局札记库、历史札记搜索、外部大模型、OCR、后台批量抓取

## 1. 背景

Bilimi 已有第一版视频札记能力：用户可以在助手工作区生成当前视频札记，查看速览、文稿和归档信息，并保存到本地。当前版本更像“自动整理结果”，还缺少用户边看边记、回到具体视频片段、把结果带走的深度研读能力。

本次完善采用“当前视频深度研读版”。它只增强当前视频札记工作流，不扩展为全局资料库。这样可以让札记从静态摘要变成可操作的学习记录，同时避免第一版范围过大。

## 2. 目标

1. 在札记 UI 中新增 `批注` 和 `导出` 能力。
2. 用户可以读取当前视频播放时间，一键创建时间点批注。
3. 每条批注包含时间点、标题和正文。
4. 用户可以编辑、删除批注。
5. 用户可以点击批注跳转回视频对应时间点。
6. 保存札记时同步保存批注和用户备注。
7. 导出 Markdown，内容包含来源、速览、时间线、批注、文稿和备注。
8. Markdown 至少支持复制到剪贴板。

## 3. 非目标

1. 不做全局札记列表、搜索和历史札记库 UI。
2. 不新增外部大模型 API。
3. 不上传文稿、批注、备注或账号信息。
4. 不做 OCR 或音频转写。
5. 不做文件保存对话框；第一版导出以复制 Markdown 为准。
6. 不改变收藏、点赞、投币、评论等动作逻辑。

## 4. 核心体验

用户打开一个 B 站视频，进入系统浮窗或主窗口助手的 `札记` 页。整理札记后，页签扩展为：

1. `速览`：保留当前摘要、关键词、时间线和高光片段。
2. `文稿`：保留完整文稿展示。
3. `批注`：管理时间点批注。
4. `导出`：预览并复制 Markdown。
5. `归档`：展示来源信息、保存状态和用户备注。

在 `批注` 页，用户点击“取当前时间”后，Bilimi 从当前视频 webview 读取播放秒数，填入批注表单。用户补充标题和正文后保存。已保存批注按时间升序排列。点击某条批注的时间按钮，Bilimi 将当前视频跳转到该秒数。

在 `导出` 页，Bilimi 根据当前札记生成 Markdown 预览。用户点击“复制 Markdown”后，内容写入剪贴板，并显示复制成功状态。

## 5. 数据模型

现有 `VideoNote` 需要扩展批注字段：

```ts
export type VideoNoteAnnotation = {
  id: string
  start: number | null
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type VideoNote = {
  id: string
  source: VideoNoteSourceMetadata
  transcriptSource: 'auto' | 'manual'
  transcript: TranscriptSegment[]
  chapters: TranscriptChapter[]
  overview: VideoNoteOverview
  annotations: VideoNoteAnnotation[]
  userMemo: string
  createdAt: string
  updatedAt: string
}
```

兼容旧札记时，缺少 `annotations` 的记录视为空数组。批注 `id` 使用本地生成的稳定字符串即可，不需要和 B 站数据绑定。

## 6. 组件与边界

### 6.1 共享模型

`src/shared/types.ts` 增加 `VideoNoteAnnotation`。`src/shared/videoNotes.ts` 负责兼容旧札记、合并保存和按更新时间维护数据。

### 6.2 札记 Markdown

新增纯函数模块 `src/renderer/src/features/notes/videoNoteMarkdown.ts`。它接收 `VideoNote`，输出 Markdown 字符串。该模块不依赖 React、Electron 或 DOM，便于单元测试。

Markdown 结构：

```md
# 视频标题

- UP：作者
- BV：BV 号
- 链接：URL
- 整理时间：updatedAt

## 速览

## 时间线

## 批注

## 文稿

## 备注
```

时间点使用 `mm:ss` 格式。无时间点批注显示为“--:--”。

### 6.3 播放器时间桥

主窗口和系统浮窗都通过现有 runtime 边界发起能力请求。需要新增两个操作：

1. `get-current-video-time`：从 active webview 读取 `document.querySelector('video')?.currentTime`。
2. `seek-video-time`：在 active webview 中把视频 currentTime 设置到目标秒数，并尽量调用 `play()`。

如果当前页面没有视频元素，返回明确错误：“未找到当前视频播放器，无法读取时间点。”

### 6.4 札记 UI

`VideoNotesPanel` 继续作为札记主组件，新增：

1. `annotations` 状态展示。
2. 批注新增表单。
3. 批注编辑和删除。
4. 时间点跳转按钮。
5. Markdown 预览和复制按钮。
6. 归档页中的用户备注编辑。

表单规则：

1. 标题为空时，保存为“未命名批注”。
2. 正文可以为空，但标题和正文不能同时为空。
3. 删除批注不需要二次确认；它只影响当前未保存或当前本地札记，后续可通过重新保存覆盖。

## 7. 数据流

1. 用户整理札记，得到 `VideoNote`。
2. UI 读取 `note.annotations ?? []`。
3. 用户取当前时间，renderer 通过 runtime 请求主窗口读取 active webview 播放时间。
4. 用户保存批注，UI 生成新的 `VideoNote` 副本并调用上层 `onUpdateNote`。
5. 用户点击保存札记，现有 `saveVideoNote` 保存包含批注和备注的新 `VideoNote`。
6. 用户导出 Markdown，UI 调用 `videoNoteMarkdown` 生成字符串并复制到剪贴板。
7. 用户点击批注时间，renderer 通过 runtime 请求主窗口 seek active webview。

## 8. 错误处理

1. 读取当前时间失败：保留表单内容，显示错误提示。
2. 跳转失败：不修改批注，显示错误提示。
3. 复制失败：保留 Markdown 预览，显示错误提示。
4. 保存失败：保留当前札记状态，允许用户重试保存。
5. 旧札记缺少批注字段：正常展示为空批注列表。

错误提示需要直接说明问题和下一步，不使用含糊文案。

## 9. 测试策略

### 9.1 单元测试

1. `videoNoteMarkdown` 输出完整标题、来源、速览、时间线、批注、文稿和备注。
2. 无批注、无作者、无 BV 号时仍能生成可读 Markdown。
3. `videoNotes` helpers 对旧札记补齐 `annotations: []`。

### 9.2 组件测试

1. `VideoNotesPanel` 渲染 `批注` 和 `导出` 页签。
2. 点击“取当前时间”后填入当前播放时间。
3. 新增批注后列表按时间升序展示。
4. 编辑批注会更新当前札记。
5. 删除批注会从当前札记移除。
6. 点击批注时间会调用跳转回调。
7. 导出页能复制 Markdown 并显示成功状态。
8. 备注编辑后保存札记会带上最新备注。

### 9.3 集成测试

1. 主窗口生成札记后，批注保存会进入本地 store。
2. 系统浮窗通过 desktop bridge 调用读取当前时间和跳转时间。
3. 未找到视频元素时返回明确错误，不破坏札记 UI。

## 10. 验收标准

1. 用户可以在当前视频札记中添加、编辑、删除时间点批注。
2. 用户可以从批注跳回视频对应时间点。
3. 用户可以复制包含批注的 Markdown。
4. 用户备注会随札记保存。
5. 旧札记不会因为缺少 `annotations` 字段而崩溃。
6. 全量测试通过，构建通过。
